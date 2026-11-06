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

import { presignGet, readCatalogue, readMastersText, readWalks, writeCatalogue, writeMastersJson } from "@/lib/splats/r2";
import { phoneKeyOf, type WalkItem } from "@/lib/splats/walks";
import { readStore } from "./bucket";
import { cutInfo } from "@/lib/splats/cut-job";
import { sceneOf } from "./store";
import { productPhoto, sharpnessAt } from "./media";
import { readTitle, OverBudget, MODEL, CHEAP_MODEL, type ReadTitle } from "./ai";
import { purseOf } from "./crew";
import { tourInputs } from "./tourJob";

export type TitleRow = ReadTitle & { n: number; t: number; photo?: string; seen?: string; at: string; /** Which model read it (absent: Opus 5.5, before 2026-11-06). */ model?: string };
export type TitleList = { store: string; rows: TitleRow[]; spentCents: number; updated: string };

const keyOf = (slug: string) => `stores/${slug}/titles.json`;
/** Moments looked at along a product's path, and how many of the sharpest are sent to Claude. */
// Claude Haiku 5.5 reads (owner, 2026-11-06: "Make the best use of Haiku … lets call it often"): more moments are
// measured and more close-ups, larger, go into each reading; a title read only in part can be re-read by Opus
// (`escalate`, the operator's choice).
const CANDIDATES = 12, READ_CROPS = 5, CROP_PX = 1024;

export async function readTitleList(slug: string): Promise<TitleList | null> {
  try { const t = await readMastersText(keyOf(slug)); return t ? (JSON.parse(t) as TitleList) : null; } catch { return null; }
}

let busy = false;

/** Read the titles of up to `limit` products not read yet (all when no limit). Returns what it did, in a sentence. */
/**
 * `escalate`: instead of new books, re-read the titles Haiku read only in part or not at all, with Opus 5.5 (~40x the
 * cost a book, so only those, and only on the operator's press). A re-read replaces the row only when it is surer.
 */
export async function readTitles(slug: string, limit?: number, opts: { escalate?: boolean } = {}): Promise<string> {
  const model = opts.escalate ? MODEL : CHEAP_MODEL;
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
    // After a cut the lights are in the cut walk's times: the cut walk then, not the upload (in the original's).
    const cut = (await cutInfo(walkKey).catch(() => null))?.original ?? false;
    try { src = s.files.video && !cut ? await presignGet(s.files.video.key, "master", 6 * 3600) : await presignGet(walkKey, "web", 6 * 3600); }
    catch { src = await presignGet(phoneKeyOf(walkKey), "web", 6 * 3600); }
    const list: TitleList = (await readTitleList(slug)) ?? { store: slug, rows: [], spentCents: 0, updated: "" };
    // A new run reads the books not read yet; an escalation, those read by Haiku and not in full.
    const done = new Set(opts.escalate ? list.rows.filter((r) => r.readable === "full" || r.model !== CHEAP_MODEL).map((r) => r.n) : list.rows.map((r) => r.n));
    const again = opts.escalate ? new Set(list.rows.filter((r) => !done.has(r.n)).map((r) => r.n)) : null;
    // ⚠️ EVERY BOOK FOUND, NOT ONLY THE LIT ONES (owner, 2026-11-05: "only 76 titles are typed, there are in excess
    // of 700 titles in this store"): 160 of the bookshop's 425 found books had no light and were never read. Those are
    // read from the moments the finder saw them (its sightings and the Shelf finder's, in the ORIGINAL recording's
    // times, so from the upload / the walk before any cut).
    const fromSeen = new Map<number, { pins: Array<{ t: number; x: number; y: number }>; size: { w: number; h: number } }>();
    let srcSeen: string | null = null;
    const inp = await tourInputs(slug).catch(() => "no inputs");
    if (typeof inp !== "string") {
      srcSeen = inp.src;
      for (const x of inp.seen) {
        if (firstLight.has(x.n)) continue;
        const f = fromSeen.get(x.n) ?? { pins: [], size: x.size };
        f.pins.push({ t: x.t, x: x.lon, y: x.lat });
        // The biggest view's size: the camera closest.
        if (x.size.w * x.size.h > f.size.w * f.size.h) f.size = x.size;
        fromSeen.set(x.n, f);
      }
    }
    const todo = c.products.filter((p) => (firstLight.has(p.n) || fromSeen.has(p.n)) && !done.has(p.n) && (!again || again.has(p.n))).slice(0, limit ?? Infinity);
    const purse = purseOf(s);
    const before = purse.spent();
    let read = 0, stopped = "";
    for (const p of todo) {
      const light = firstLight.get(p.n);
      const it = light ? { pins: light.pins, size: light.size } : fromSeen.get(p.n)!;
      const from = light ? src : srcSeen!;
      // ⚠️ THE BEST THIS RECORDING CAN GIVE (owner, 2026-11-04: "we have to do the best possible with
      // this recording"): up to 8 moments along the product's path, and the 3 sharpest are read.
      const step = Math.max(1, Math.floor(it.pins.length / CANDIDATES));
      const candidates = it.pins.filter((_, i) => i % step === 0).slice(0, CANDIDATES);
      const scored: Array<{ q: (typeof it.pins)[number]; score: number }> = [];
      for (const q of candidates) {
        try { scored.push({ q, score: await sharpnessAt(from, q.t, q.x, q.y, it.size!) }); } catch { /* that moment is skipped */ }
      }
      const pick = scored.sort((a, b) => b.score - a.score).slice(0, READ_CROPS).map((x) => x.q).sort((a, b) => a.t - b.t);
      if (!pick.length) continue;
      const crops: Uint8Array[] = [];
      for (const q of pick) {
        try { crops.push(await productPhoto(from, q.t, q.x, q.y, it.size!, CROP_PX)); } catch (e) { console.error("[titles] crop", slug, p.n, e); }
      }
      if (!crops.length) continue;
      try {
        const r = await readTitle(purse, crops, model);
        const row: TitleRow = { ...r, n: p.n, t: pick[0].t, ...(p.photo ? { photo: p.photo } : {}), ...(p.seen ? { seen: p.seen } : {}), at: new Date().toISOString(), model };
        const i = list.rows.findIndex((x) => x.n === p.n);
        const rank = (x: ReadTitle) => (x.readable === "full" ? 2 : x.readable === "partial" ? 1 : 0) + x.confidence;
        if (i < 0) list.rows.push(row);
        // An escalation keeps the surer reading; either way the book is not offered for escalation again.
        else list.rows[i] = rank(row) >= rank(list.rows[i]) ? row : { ...list.rows[i], model };
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
    const named = await nameFromTitles(slug).catch(() => 0);
    return `Read ${read} products ($${((purse.spent() - before) / 100).toFixed(2)}): of ${list.rows.length} read so far, ${full} titles read in full, ${partial} in part, ${list.rows.length - full - partial} not readable; ${named} unnamed products named from their full titles.${stopped}`;
  } finally {
    busy = false;
  }
}

/**
 * TITLES BECOME NAMES (owner, 2026-11-06: "The text of titles need to get populated in the product card so when
 * shopper or owner click the title is already populated so for most items the owner need only to add price").
 * Every product with NO name yet takes the title read IN FULL off its book (Farsi and English as printed). A name
 * the owner gave is never touched; a title read only in part is not made a name (it is offered in the owner's
 * card instead, to check). Free. Returns how many were named.
 */
export async function nameFromTitles(slug: string): Promise<number> {
  const list = await readTitleList(slug);
  const c = await readCatalogue(sceneOf(slug));
  if (!list || !c) return 0;
  const full = new Map(list.rows.filter((r) => r.readable === "full" && (r.title_fa.trim() || r.title_en.trim())).map((r) => [r.n, r]));
  let named = 0;
  const products = c.products.map((p) => {
    const r = full.get(p.n);
    if (!r || p.en?.trim() || p.fa?.trim()) return p;
    named++;
    return { ...p, ...(r.title_fa.trim() ? { fa: r.title_fa.trim() } : {}), ...(r.title_en.trim() ? { en: r.title_en.trim() } : {}) };
  });
  if (named) await writeCatalogue({ ...c, products });
  return named;
}
