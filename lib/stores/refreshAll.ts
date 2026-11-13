// ONE KEY FOR EVERY AGENT (owner, 2026-11-06: "going forward add ONE KEY for me to initiate all agent
// refreshment"). The operator's «Refresh all agents» runs the store's agents in the order each needs the last:
//
//   0  Door photo                the store's door photo opens both tours (free)
//   1  Shelf finder, gaps mode   the bookcases no shelf picture holds yet (Opus, at most 30 pictures ~$2)
//   2  Store map                 the shelves on the floor plan, ids kept (free)
//   3  Shelf Tour                filmed shelf by shelf in the map's order (free; the camera's-path tour if
//                                 there are no shelf pictures at all)
//   4  Title reader              every found book not read yet (Haiku, a fraction of a cent a book)
//   5  Spine reader              the shelf photos not read yet, if any (Haiku, a few cents a photo)
//   6  Zoom photos               each shelf's three phone photos stitched into its zoom photo and cut into tiles
//                                 (free; `gigapan.ts`; owner, 2026-11-11: "add the integration as part of
//                                 Refresh all agents"); only the shelves not stitched yet, or whose photos changed;
//                                 then each shelf is found in the walk and bordered in green (free)
//   …  Photo improver            queued by step 1 when it found new books; it runs on its own
//
// ⚠️ AUTOMATIC FOR EVERY STORE (owner, 2026-11-06: "what ever we built for saraye-bamdad need to apply and work
// automatically for all stores"). The run is queued by the crew the moment a store's «tag» step finishes (its
// products are found and their lights pinned), and at server start for any store whose products are tagged but
// that has never been refreshed and has no Shelf Tour. The queue is kept in R2 (`stores/refresh-pending.json`),
// so a restart carries on; stores run one after another, never side by side. The AI it spends (the Shelf finder,
// the readers) comes out of the store's own budget (`BUDGET_CENTS`), which stops it.
//
// In the background; one run at a time per server. Each step's sentence is kept in
// `stores/<slug>/refresh.json` (the card shows it), so a step that stops (the budget, an error) is said, and the
// next steps still run: each one stands on what is there. A restart mid-run leaves the record as it was (the
// card shows the steps done); press the key again to finish.
import { REFRESH_STEPS, SKIPPED_NOTE, skipList } from "./refreshSteps";
import { readMastersText, writeMastersJson } from "@/lib/splats/r2";
import { readStore } from "./bucket";
import { prepareDoorPhoto } from "./crew";
import { findShelves } from "./shelfFinder";
import { buildStoreMap } from "./mapJob";
import { buildShelfFilm } from "./shelfFilm";
import { buildTour } from "./tourJob";
import { readTitles } from "./titles";
import { readShelfPhotos, readShelfTitles } from "./shelfTitles";
import { readIndex } from "./bucket";
import { readTour } from "./tourJob";
import { refreshZooms } from "./gigapan";

export type RefreshStep = { name: string; note: string; at: string };
/** `skip`: the steps the operator left out of this run, before it started or while it ran (`refreshSteps.ts`). */
export type RefreshRun = { store: string; started: string; finished: string | null; steps: RefreshStep[]; running: boolean; version?: number; skip?: string[] };
/** Raised when the run's code changes in a way that should reach stores already run without a tour (2: lights with
 *  no box size count, so stores tagged before 2026-11-04 get a tour). One retry per version, never every restart. */
export const REFRESH_VERSION = 2;
export const refreshKey = (slug: string) => `stores/${slug}/refresh.json`;
export { REFRESH_STEPS };
let busy: string | null = null;

// ── SKIPPING A STEP (owner, 2026-11-13: "allow operator to skip a step in Refresh all agents even in the middle of
// execution or before"). Before: the card's ticks come as `skip` with the start. During: «Skip» on a step not
// reached yet leaves it out; on the step being worked on, the run stops waiting for it and goes on to the next.
// ⚠️ That agent is not killed (its job has no off switch): what it has in hand finishes behind the run, and an AI
// step still spends what its picture in hand costs. The note on the step says so.
const skips = new Map<string, Set<string>>();
let working: { slug: string; name: string; release: () => void } | null = null;
/** Leave `name` out of the run of `slug` now going; a sentence back. */
export async function skipRefreshStep(slug: string, name: unknown): Promise<string> {
  const [step] = skipList([name]);
  if (!step) return "No such step.";
  if (busy !== slug) return "No run is going for this store: untick the step before starting one.";
  const set = skips.get(slug) ?? new Set<string>();
  set.add(step);
  skips.set(slug, set);
  if (working?.slug === slug && working.name === step) { working.release(); return `«${step}» is skipped: the run goes on to the next step. What that agent had in hand finishes behind it.`; }
  const run = await readRefresh(slug);
  if (run?.steps.some((s) => s.name === step && s.note !== "working…")) return `«${step}» is already done in this run.`;
  if (run) await writeMastersJson(refreshKey(slug), { ...run, skip: [...set] }).catch(() => undefined);
  return `«${step}» will be skipped.`;
}

export async function readRefresh(slug: string): Promise<RefreshRun | null> {
  try { const t = await readMastersText(refreshKey(slug)); return t ? (JSON.parse(t) as RefreshRun) : null; } catch { return null; }
}

const REFRESH_PENDING = "stores/refresh-pending.json";
let draining = false;
async function readQueue(): Promise<string[]> {
  try { const t = await readMastersText(REFRESH_PENDING); const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; } catch { return []; }
}
/** Queue stores for an automatic run (each once); drained in the background, one store at a time. */
export async function queueRefresh(slugs: string[]): Promise<void> {
  if (!slugs.length) return;
  await writeMastersJson(REFRESH_PENDING, [...new Set([...(await readQueue()), ...slugs])]);
  void drainRefresh();
}
export async function drainRefresh(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const [slug] = await readQueue();
      if (!slug) return;
      // A run the operator started by hand finishes first.
      while (busy) await new Promise((r) => setTimeout(r, 30_000));
      busy = slug;
      try { await refreshAll(slug); } catch (e) { console.error("[refresh]", slug, e); } finally { busy = null; }
      await writeMastersJson(REFRESH_PENDING, (await readQueue()).filter((k) => k !== slug));
    }
  } finally {
    draining = false;
  }
}
/** At start-up: stores whose products are tagged, with no Shelf Tour, not yet run by this version of the run. */
export async function storesToRefresh(): Promise<string[]> {
  const out: string[] = [];
  for (const { slug } of await readIndex()) {
    const s = await readStore(slug).catch(() => null);
    if (!s?.out.walk || s.steps.tag.state !== "done") continue;
    if (await readTour(slug)) continue;
    const last = await readRefresh(slug);
    if (last && (last.version ?? 1) >= REFRESH_VERSION) continue;
    out.push(slug);
  }
  return out;
}

/** Start the run in the background; a sentence back (started, or why not). */
export function startRefreshAll(slug: string, skip: unknown = []): string {
  if (busy) return busy === slug ? "Already refreshing this store." : `Busy refreshing «${busy}»; try again when it is done.`;
  busy = slug;
  skips.set(slug, new Set(skipList(skip)));
  void refreshAll(slug).catch((e) => console.error("[refresh]", slug, e)).finally(() => { busy = null; });
  return "Started.";
}

async function refreshAll(slug: string): Promise<void> {
  const run: RefreshRun = { store: slug, started: new Date().toISOString(), finished: null, steps: [], running: true, version: REFRESH_VERSION };
  const skip = skips.get(slug) ?? new Set<string>();
  skips.set(slug, skip);
  const save = () => { run.skip = [...skip]; return writeMastersJson(refreshKey(slug), run).catch((e) => console.error("[refresh] save", slug, e)); };
  const step = async (name: string, f: () => Promise<string>) => {
    if (skip.has(name)) {
      run.steps.push({ name, note: SKIPPED_NOTE, at: new Date().toISOString() });
      await save();
      console.log("[refresh]", slug, name, "skipped");
      return;
    }
    run.steps.push({ name, note: "working…", at: new Date().toISOString() });
    await save();
    let note: string;
    // The step, or the operator's «Skip» while it works, whichever comes first.
    const skipped = new Promise<string>((res) => { working = { slug, name, release: () => res(`${SKIPPED_NOTE} What this agent had in hand finishes behind the run.`) }; });
    try { note = await Promise.race([f(), skipped]); } catch (e) { note = `Failed: ${(e as Error).message.slice(0, 300)}`; }
    working = null;
    run.steps[run.steps.length - 1] = { name, note, at: new Date().toISOString() };
    await save();
    console.log("[refresh]", slug, name, note);
  };
  await save();
  // 1: wait for this one (its usual follow-ups are run here in order instead: no tour built behind our back).
  await step(REFRESH_STEPS[0], async () => {
    const st = await readStore(slug);
    if (!st?.files.door) return "No door photo uploaded.";
    return (await prepareDoorPhoto(st)) ? "The door photo opens both tours (7 s)." : "No door photo.";
  });
  await step(REFRESH_STEPS[1], () => findShelves(slug, { mode: "gaps", rebuild: false }));
  await step(REFRESH_STEPS[2], () => buildStoreMap(slug));
  await step(REFRESH_STEPS[3], async () => {
    const filmed = await buildShelfFilm(slug);
    return /^No shelf pictures/.test(filmed) ? `${filmed} → ${await buildTour(slug)}` : filmed;
  });
  await step(REFRESH_STEPS[4], () => readTitles(slug));
  const s = await readStore(slug);
  const unread = (s?.files.shelf ?? []).length - ((await readShelfTitles(slug))?.done.length ?? 0);
  await step(REFRESH_STEPS[5], async () => (unread > 0 ? readShelfPhotos(slug) : "No shelf photos waiting to be read."));
  // Last: it is free and stands on nothing above, and a long stitch never holds the tour back.
  await step(REFRESH_STEPS[6], () => refreshZooms(slug));
  run.running = false;
  run.finished = new Date().toISOString();
  await save();
  skips.delete(slug);
}
