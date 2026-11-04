// RE-PINNING A WALK WITH THE FINE FOLLOW (owner, 2026-11-04: "The tag or now
// the small circle light still tends to move a bit … try to do that"; and
// "for all new and existing stores").
//
// A product the crew found is a track of pins, and one of them is the moment
// Claude saw it (a look of `lookPlan`), kept exactly. Followed again from
// there with the fine follow (`follow` in `tagging.ts`, `PIN_VERSION`), its
// pins stand four times stiller — and nothing is asked of Claude, so nothing
// is spent. Each walk is done once (`Walk.pinned`); a product the owner or
// anyone changed meanwhile is left as it is. Walks wait in a list in the
// masters bucket, so a restart (every push to main) carries on with the rest.

import { presignGet, readMastersText, readWalks, webObjectExists, writeMastersJson, writeWalks } from "@/lib/splats/r2";
import { phoneKeyOf, type ItemPin, type WalkItem } from "@/lib/splats/walks";
import { grayFrames, probe } from "./media";
import { FOLLOW_FPS, FOLLOW_SPAN, FOLLOW_W, MIN_PINS, PIN_VERSION, follow, lookPlan } from "./tagging";

const PENDING = "repin/pending.json";
let busy = false;
/** For `/operator/agents`: the walks waiting to be re-pinned, and whether one is being done now. */
export async function repinStatus(): Promise<{ busy: boolean; waiting: string[] }> {
  return { busy, waiting: await readPending() };
}

const isAuto = (it: WalkItem) => it.id.startsWith("auto-") && it.pins.length >= 2;

/** Every 360° walk with crew-found products not yet pinned by this follow. */
export async function walksToRepin(): Promise<string[]> {
  const all = (await readWalks()).walks;
  return Object.keys(all).filter((k) => {
    const w = all[k];
    return w.projection !== "flat" && w.projection !== "eac" && (w.pinned ?? 1) < PIN_VERSION && (w.items ?? []).some(isAuto);
  });
}

export async function queueRepin(keys: string[]): Promise<void> {
  const old = await readPending();
  await writeMastersJson(PENDING, [...new Set([...old, ...keys])]);
  void drainRepin();
}
async function readPending(): Promise<string[]> {
  try { const t = await readMastersText(PENDING); const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; } catch { return []; }
}
/** Re-pin the queued walks one by one (also called when the server starts, after queueing what needs it). */
export async function drainRepin(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const [key, ...rest] = await readPending();
      if (!key) return;
      try { console.log("[repin]", key, await repinWalk(key)); } catch (e) { console.error("[repin]", key, e); }
      await writeMastersJson(PENDING, rest);
    }
  } finally {
    busy = false;
  }
}

/** Where to follow an item from: its pin at one of Claude's looks (the sighting), else its middle pin. */
export function seedOf(pins: ItemPin[], looks: number[]): ItemPin {
  for (const p of pins) if (looks.some((t) => Math.abs(t - p.t) < 0.06)) return p;
  return pins[Math.floor(pins.length / 2)];
}

/** One walk followed again: each crew product from its sighting, with the fine follow. */
export async function repinWalk(walkKey: string): Promise<string> {
  const before = (await readWalks()).walks[walkKey];
  if (!before) return "No such walk.";
  const auto = (before.items ?? []).filter(isAuto);
  if (!auto.length) return "No crew-found products on this walk.";
  const src = (await webObjectExists(phoneKeyOf(walkKey))) ? await presignGet(phoneKeyOf(walkKey), "web", 6 * 3600) : await presignGet(walkKey, "web", 6 * 3600);
  const { seconds } = await probe(src);
  const looks = lookPlan(seconds, before.tagsFrom ?? 0).map((m) => m.t);
  const byMoment = new Map<number, Array<{ item: WalkItem; seed: ItemPin }>>();
  for (const item of auto) {
    const seed = seedOf(item.pins, looks);
    const t = Math.round(seed.t * 100) / 100;
    byMoment.set(t, [...(byMoment.get(t) ?? []), { item, seed }]);
  }
  const fresh = new Map<string, ItemPin[]>();
  for (const [t, list] of [...byMoment].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(0, t - FOLLOW_SPAN);
    const { frames, W, H } = await grayFrames(src, FOLLOW_FPS, FOLLOW_W, start, FOLLOW_SPAN * 2 + 0.2);
    if (!frames.length) continue;
    const grey = frames.map((f) => Float32Array.from(f));
    const i0 = Math.min(grey.length - 1, Math.round((t - start) * FOLLOW_FPS));
    for (const { item, seed } of list) {
      const pins = follow(grey, W, H, start, i0, { lon: seed.x, lat: seed.y });
      if (pins.length >= MIN_PINS) fresh.set(item.id, pins);
    }
  }
  // Written over the walk as it is now: only products still as they were, so nobody's change is lost.
  const walks = await readWalks();
  const w = walks.walks[walkKey];
  if (!w) return "The walk is gone.";
  const was = new Map(auto.map((it) => [it.id, JSON.stringify(it.pins)]));
  let moved = 0;
  const items = (w.items ?? []).map((it) => {
    const pins = fresh.get(it.id);
    if (!pins || was.get(it.id) !== JSON.stringify(it.pins)) return it;
    moved++;
    return { ...it, pins };
  });
  await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, items, pinned: PIN_VERSION } } }, walks);
  return `Followed ${moved} of ${auto.length} products again with the fine follow (${auto.length - moved} kept as they were).`;
}
