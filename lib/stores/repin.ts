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

import { readJob, setJob } from "./jobState";
import { presignGet, readCatalogue, readMastersText, readWalks, webObjectExists, writeMastersJson, writeWalks } from "@/lib/splats/r2";
import { MAX_ITEMS, phoneKeyOf, type ItemPin, type WalkItem } from "@/lib/splats/walks";
import { grayFrames, probe } from "./media";
import { FOLLOW_FPS, FOLLOW_SPAN, FOLLOW_W, MIN_PINS, PIN_VERSION, capTracks, follow, itemOf, keepTracks, lookPlan, type Track } from "./tagging";

const PENDING = "repin/pending.json";
let busy = false;
/** For `/operator/agents`: the walks waiting to be re-pinned, and whether one is being done now. */
export async function repinStatus(): Promise<{ busy: boolean; waiting: string[]; current?: string }> {
  const j = await readJob("repin");
  return { busy: Boolean(j?.busy && Date.now() - Date.parse(j.at) < 6 * 3600_000), waiting: await readPending(), ...(j?.busy && j.key ? { current: j.key } : {}) };
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
      await setJob("repin", { busy: true, key });
      try { console.log("[repin]", key, await repinWalk(key)); } catch (e) { console.error("[repin]", key, e); }
      await setJob("repin", { busy: false, key: null });
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
  // With Claude's sightings kept (`saveSightings` in crew.ts), every light is made again from them:
  // a product the cap left without a light may get one now. Else each light is followed again.
  const slug = /^scenes\/store-([a-z0-9-]+)\//.exec(walkKey)?.[1];
  const sightings = slug ? await readSightings(slug) : null;
  if (sightings?.length) return rebuildFromSightings(walkKey, slug!, sightings, src);
  const fresh = new Map<string, ItemPin[]>();
  for (const [t, list] of [...byMoment].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(0, t - FOLLOW_SPAN);
    const { frames, W, H } = await grayFrames(src, FOLLOW_FPS, FOLLOW_W, start, FOLLOW_SPAN * 2 + 0.2);
    if (!frames.length) continue;
    const grey = frames;
    const i0 = Math.min(grey.length - 1, Math.round((t - start) * FOLLOW_FPS));
    for (const { item, seed } of list) {
      const pins = follow(grey, W, H, start, i0, { lon: seed.x, lat: seed.y }, item.size);
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

type Sighting = { n: number; t: number; lon: number; lat: number; size: { w: number; h: number }; confidence: number };
async function readSightings(slug: string): Promise<Sighting[] | null> {
  try { const t = await readMastersText(`stores/${slug}/sightings.json`); const v = t ? JSON.parse(t) : null; return Array.isArray(v) ? (v as Sighting[]) : null; } catch { return null; }
}

/** Every crew light of a walk made again from Claude's sightings, with this follow and the fair cap. Hand lights and specials stay. */
async function rebuildFromSightings(walkKey: string, slug: string, sightings: Sighting[], src: string): Promise<string> {
  const c = await readCatalogue(`store-${slug}`);
  if (!c?.products.length) return "No product list to rebuild from.";
  const byN = new Map(c.products.map((p) => [p.n, p]));
  const tracks: Track[] = [];
  for (const t of [...new Set(sightings.map((x) => x.t))].sort((a, b) => a - b)) {
    const start = Math.max(0, t - FOLLOW_SPAN);
    const { frames, W, H } = await grayFrames(src, FOLLOW_FPS, FOLLOW_W, start, FOLLOW_SPAN * 2 + 0.2);
    if (!frames.length) continue;
    const i0 = Math.min(frames.length - 1, Math.round((t - start) * FOLLOW_FPS));
    for (const x of sightings.filter((y) => y.t === t && byN.has(y.n))) {
      tracks.push({ n: x.n, confidence: x.confidence, size: x.size, pins: follow(frames, W, H, start, i0, { lon: x.lon, lat: x.lat }, x.size) });
    }
  }
  const walks = await readWalks();
  const w = walks.walks[walkKey];
  if (!w) return "The walk is gone.";
  const hand = (w.items ?? []).filter((it) => !it.id.startsWith("auto-"));
  const specials = new Map((w.items ?? []).filter((it) => it.special && it.n).map((it) => [it.n!, it.special!]));
  const count = new Map<number, number>();
  const items = capTracks(keepTracks(tracks), MAX_ITEMS - hand.length).map((t) => {
    const k = count.get(t.n) ?? 0;
    count.set(t.n, k + 1);
    const it = itemOf(t, byN.get(t.n)!, k);
    return specials.has(t.n) ? { ...it, special: specials.get(t.n) } : it;
  });
  await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, items: [...hand, ...items], pinned: PIN_VERSION } } }, walks);
  return `Rebuilt ${items.length} lights for ${count.size} of ${c.products.length} products from ${sightings.length} sightings.`;
}
