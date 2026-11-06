// ONE KEY FOR EVERY AGENT (owner, 2026-11-06: "going forward add ONE KEY for me to initiate all agent
// refreshment"). The operator's «Refresh all agents» runs the store's agents in the order each needs the last:
//
//   1  Shelf finder, gaps mode   the bookcases no shelf picture holds yet (Opus, at most 30 pictures ~$2)
//   2  Store map                 the shelves on the floor plan, ids kept (free)
//   3  Shelf Tour                filmed shelf by shelf in the map's order (free; the camera's-path tour if
//                                 there are no shelf pictures at all)
//   4  Title reader              every found book not read yet (Haiku, a fraction of a cent a book)
//   5  Spine reader              the shelf photos not read yet, if any (Haiku, a few cents a photo)
//   …  Photo improver            queued by step 1 when it found new books; it runs on its own
//
// In the background; one run at a time per server. Each step's sentence is kept in
// `stores/<slug>/refresh.json` (the card shows it), so a step that stops (the budget, an error) is said, and the
// next steps still run: each one stands on what is there. A restart mid-run leaves the record as it was (the
// card shows the steps done); press the key again to finish.
import { readMastersText, writeMastersJson } from "@/lib/splats/r2";
import { readStore } from "./bucket";
import { findShelves } from "./shelfFinder";
import { buildStoreMap } from "./mapJob";
import { buildShelfFilm } from "./shelfFilm";
import { buildTour } from "./tourJob";
import { readTitles } from "./titles";
import { readShelfPhotos, readShelfTitles } from "./shelfTitles";

export type RefreshStep = { name: string; note: string; at: string };
export type RefreshRun = { store: string; started: string; finished: string | null; steps: RefreshStep[]; running: boolean };
export const refreshKey = (slug: string) => `stores/${slug}/refresh.json`;
export const REFRESH_STEPS = ["Shelf finder (new shelves)", "Store map", "Shelf Tour", "Title reader", "Spine reader"] as const;
let busy: string | null = null;

export async function readRefresh(slug: string): Promise<RefreshRun | null> {
  try { const t = await readMastersText(refreshKey(slug)); return t ? (JSON.parse(t) as RefreshRun) : null; } catch { return null; }
}

/** Start the run in the background; a sentence back (started, or why not). */
export function startRefreshAll(slug: string): string {
  if (busy) return busy === slug ? "Already refreshing this store." : `Busy refreshing «${busy}»; try again when it is done.`;
  busy = slug;
  void refreshAll(slug).catch((e) => console.error("[refresh]", slug, e)).finally(() => { busy = null; });
  return "Started.";
}

async function refreshAll(slug: string): Promise<void> {
  const run: RefreshRun = { store: slug, started: new Date().toISOString(), finished: null, steps: [], running: true };
  const save = () => writeMastersJson(refreshKey(slug), run).catch((e) => console.error("[refresh] save", slug, e));
  const step = async (name: string, f: () => Promise<string>) => {
    run.steps.push({ name, note: "working…", at: new Date().toISOString() });
    await save();
    let note: string;
    try { note = await f(); } catch (e) { note = `Failed: ${(e as Error).message.slice(0, 300)}`; }
    run.steps[run.steps.length - 1] = { name, note, at: new Date().toISOString() };
    await save();
    console.log("[refresh]", slug, name, note);
  };
  await save();
  // 1: wait for this one (its usual follow-ups are run here in order instead: no tour built behind our back).
  await step(REFRESH_STEPS[0], () => findShelves(slug, { mode: "gaps", rebuild: false }));
  await step(REFRESH_STEPS[1], () => buildStoreMap(slug));
  await step(REFRESH_STEPS[2], async () => {
    const filmed = await buildShelfFilm(slug);
    return /^No shelf pictures/.test(filmed) ? `${filmed} → ${await buildTour(slug)}` : filmed;
  });
  await step(REFRESH_STEPS[3], () => readTitles(slug));
  const s = await readStore(slug);
  const unread = (s?.files.shelf ?? []).length - ((await readShelfTitles(slug))?.done.length ?? 0);
  await step(REFRESH_STEPS[4], async () => (unread > 0 ? readShelfPhotos(slug) : "No shelf photos waiting to be read."));
  run.running = false;
  run.finished = new Date().toISOString();
  await save();
}
