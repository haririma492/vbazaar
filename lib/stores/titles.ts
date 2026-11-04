// THE TITLE READER (owner, 2026-11-04: "how much it costs to get all titles
// OCRed from recording and compiled to a list and searchable?"; the shop's
// owner wants a credible result before letting the team film again).
//
// From the walk already filmed: each product the crew found is a light with
// an outline, followed through many frames. Up to 8 of those moments are
// measured for sharpness (`sharpnessAt`), the 3 sharpest are cut as close-ups
// from the full-size upload, each with the yellow box round the product
// (`productPhoto`), and Claude reads what is printed on it (`readTitle`), or
// says it cannot.
//
// The readings are a LIST, kept beside the products (`stores/<slug>/titles.json`,
// masters bucket), never written over a product's name: the owner names
// products (owner, 2026-11-01). The list is what search will use.
//
// Spending: one request a product (3 small pictures, effort low), from the
// store's own budget (`purseOf`). A run can be limited to the first N products
// (a pilot), and products already read are not read again.

import { presignGet, readCatalogue, readMastersText, readWalks, writeMastersJson } from "@/lib/splats/r2";
import { phoneKeyOf, type WalkItem } from "@/lib/splats/walks";
import { readStore } from "./bucket";
import { sceneOf } from "./store";
import { productPhoto, sharpnessAt } from "./media";
import { readTitle, OverBudget, type ReadTitle } from "./ai";
import { purseOf } from "./crew";

export type TitleRow = ReadTitle & { n: number; t: number; photo?: string; seen?: string; at: string };
export type TitleList = { store: string; rows: TitleRow[]; spentCents: number; updated: string };

const keyOf = (slug: string) => `stores/${slug}/titles.json`;
/** Moments looked at along a product's path, and how many of the sharpest are sent to Claude. */
const CANDIDATES = 8, READ_CROPS = 3;

export async function readTitleList(slug: string): Promise<TitleList | null> {
  try { const t = await readMastersText(keyOf(slug)); return t ? (JSON.parse(t) as TitleList) : null; } catch { return null; }
}

let busy = false;

/** Read the titles of up to `limit` products not read yet (all when no limit). Returns what it did, in a sentence. */
export async function readTitles(slug: string, limit?: number): Promise<string> {
  if (busy) return "The title reader is busy with another store.";
  busy = true;
  try {
    const s = await readStore(slug);
    if (!s?.out.walk) return "No walk.";
    const walkKey = s.out.walk;
    const c = await readCatalogue(sceneOf(slug));
    if (!c?.products.length) return "No products.";
    const walk = (await readWalks()).walks[walkKey];
    const firstLight = new Map<number, WalkItem>();
    for (const it of walk?.items ?? []) if (it.n && it.size && it.pins.length >= 3 && !firstLight.has(it.n)) firstLight.set(it.n, it);
    // The sharpest source: the upload itself, else the full-size walk, else the phone copy.
    let src: string;
    try { src = s.files.video ? await presignGet(s.files.video.key, "master", 6 * 3600) : await presignGet(walkKey, "web", 6 * 3600); }
    catch { src = await presignGet(phoneKeyOf(walkKey), "web", 6 * 3600); }
    const list: TitleList = (await readTitleList(slug)) ?? { store: slug, rows: [], spentCents: 0, updated: "" };
    const done = new Set(list.rows.map((r) => r.n));
    const todo = c.products.filter((p) => firstLight.has(p.n) && !done.has(p.n)).slice(0, limit ?? Infinity);
    const purse = purseOf(s);
    const before = purse.spent();
    let read = 0, stopped = "";
    for (const p of todo) {
      const it = firstLight.get(p.n)!;
      // ⚠️ THE BEST THIS RECORDING CAN GIVE (owner, 2026-11-04: "we have to do the best possible with
      // this recording"): up to 8 moments along the product's path, and the 3 sharpest are read.
      const step = Math.max(1, Math.floor(it.pins.length / CANDIDATES));
      const candidates = it.pins.filter((_, i) => i % step === 0).slice(0, CANDIDATES);
      const scored: Array<{ q: (typeof it.pins)[number]; score: number }> = [];
      for (const q of candidates) {
        try { scored.push({ q, score: await sharpnessAt(src, q.t, q.x, q.y, it.size!) }); } catch { /* that moment is skipped */ }
      }
      const pick = scored.sort((a, b) => b.score - a.score).slice(0, READ_CROPS).map((x) => x.q).sort((a, b) => a.t - b.t);
      if (!pick.length) continue;
      const crops: Uint8Array[] = [];
      for (const q of pick) {
        try { crops.push(await productPhoto(src, q.t, q.x, q.y, it.size!, 768)); } catch (e) { console.error("[titles] crop", slug, p.n, e); }
      }
      if (!crops.length) continue;
      try {
        const r = await readTitle(purse, crops);
        list.rows.push({ ...r, n: p.n, t: pick[0].t, ...(p.photo ? { photo: p.photo } : {}), ...(p.seen ? { seen: p.seen } : {}), at: new Date().toISOString() });
        read++;
      } catch (e) {
        if (e instanceof OverBudget) { stopped = " Stopped: the store's AI budget is used up."; break; }
        console.error("[titles] read", slug, p.n, e);
      }
      // Kept as it goes: a restart loses at most one product.
      if (read % 5 === 0) await writeMastersJson(keyOf(slug), { ...list, spentCents: Math.round((list.spentCents + purse.spent() - before) * 100) / 100, updated: new Date().toISOString() });
    }
    list.spentCents = Math.round((list.spentCents + purse.spent() - before) * 100) / 100;
    list.updated = new Date().toISOString();
    list.rows.sort((a, b) => a.n - b.n);
    await writeMastersJson(keyOf(slug), list);
    const full = list.rows.filter((r) => r.readable === "full").length, partial = list.rows.filter((r) => r.readable === "partial").length;
    return `Read ${read} products ($${((purse.spent() - before) / 100).toFixed(2)}): of ${list.rows.length} read so far, ${full} titles read in full, ${partial} in part, ${list.rows.length - full - partial} not readable.${stopped}`;
  } finally {
    busy = false;
  }
}
