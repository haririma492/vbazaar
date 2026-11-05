// THE SHELF TOUR, BY SHELF AND LEVEL (owner, 2026-11-05: "Did not recognize a
// shelf it moves between shelves. It does not recognize one level of a shelf.
// It is mostly moving the route of the camera, we need decouple the existing
// route and create a new route that is focused on each shelf and each level of
// each shelf").
//
// Pure planning (tested in levels.test.ts). Not the camera's path at all: the
// Shelf finder's pictures (`shelfFinder.ts`) each showed one shelf square on,
// and every product in it was boxed (`stores/<slug>/shelf-sightings.json`:
// a product's middle and size, at the picture's moment). From those boxes:
//   1. a PICTURE's products, side by side, are split into SHELVES (bookcases)
//      where there is a wide empty gap between them (`SHELF_GAP`);
//   2. a shelf's products are split into LEVELS (the rows on its boards): a
//      product joins a row its height overlaps by half (`ROW_OVERLAP`); rows run
//      top to bottom, each product in one row;
//   3. a shelf seen in two pictures (two moments) is the same shelf when most
//      of its products are: the picture where its products are biggest is kept;
//   4. each shelf and each level gets a frame (directions, with room round
//      them), which `levelsJob.ts` cuts from the recording as a still.
// Shelves run in the order they were walked past; levels top to bottom.

export type Boxed = { n: number; t: number; lon: number; lat: number; size: { w: number; h: number } };
export type Frame = { lon: number; lat: number; w: number; h: number };
export type Level = { frame: Frame; products: Boxed[] };
export type Shelf = { t: number; frame: Frame; levels: Level[] };

/** A gap wider than this (rad, ~7°) with no product in it parts two shelves. */
export const SHELF_GAP = 0.12;
/** A product joins a row when at least this share of the smaller height overlaps. */
export const ROW_OVERLAP = 0.5;
/** Room round a frame: this share of its size each side, and at least `ROOM_MIN` rad. */
export const ROOM = 0.08, ROOM_MIN = 0.02;
/** A shelf needs at least this many products; a level at least one. */
export const SHELF_MIN = 3;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

/** The frame round some products: their outer edges, with room. Longitudes taken round `c` (no wrap at ±180°). */
export function frameOf(ps: Boxed[]): Frame {
  const c = Math.atan2(ps.reduce((s, p) => s + Math.sin(p.lon), 0), ps.reduce((s, p) => s + Math.cos(p.lon), 0));
  const xs = ps.map((p) => wrap(p.lon - c)), ys = ps.map((p) => p.lat);
  const halfW = (p: Boxed) => p.size.w / 2 / Math.max(0.2, Math.cos(p.lat));
  const l = Math.min(...ps.map((p, i) => xs[i] - halfW(p))), r = Math.max(...ps.map((p, i) => xs[i] + halfW(p)));
  const b = Math.min(...ps.map((p, i) => ys[i] - p.size.h / 2)), t = Math.max(...ps.map((p, i) => ys[i] + p.size.h / 2));
  const w = r - l, h = t - b;
  const rw = Math.max(ROOM_MIN, w * ROOM), rh = Math.max(ROOM_MIN, h * ROOM);
  return { lon: wrap(c + (l + r) / 2), lat: (b + t) / 2, w: w + 2 * rw, h: h + 2 * rh };
}

/** 1: one picture's products → shelves, left to right. */
export function shelvesIn(ps: Boxed[]): Boxed[][] {
  if (!ps.length) return [];
  const c = Math.atan2(ps.reduce((s, p) => s + Math.sin(p.lon), 0), ps.reduce((s, p) => s + Math.cos(p.lon), 0));
  const at = (p: Boxed) => wrap(p.lon - c);
  const sorted = [...ps].sort((a, b) => at(a) - at(b));
  const out: Boxed[][] = [[sorted[0]]];
  let right = at(sorted[0]) + sorted[0].size.w / 2;
  for (const p of sorted.slice(1)) {
    const left = at(p) - p.size.w / 2;
    if (left - right > SHELF_GAP) out.push([p]); else out[out.length - 1].push(p);
    right = Math.max(right, at(p) + p.size.w / 2);
  }
  return out;
}

/** 2: a shelf's products → its levels, top to bottom. */
export function levelsIn(ps: Boxed[]): Boxed[][] {
  const rows: Array<{ top: number; bottom: number; ps: Boxed[] }> = [];
  // Biggest first, so a row's band is set by its books, not by a small item on the board.
  for (const p of [...ps].sort((a, b) => b.size.h - a.size.h)) {
    const top = p.lat + p.size.h / 2, bottom = p.lat - p.size.h / 2;
    let best: { r: (typeof rows)[number]; share: number } | null = null;
    for (const r of rows) {
      const share = (Math.min(top, r.top) - Math.max(bottom, r.bottom)) / Math.min(top - bottom, r.top - r.bottom);
      if (share >= ROW_OVERLAP && (!best || share > best.share)) best = { r, share };
    }
    if (best) { best.r.ps.push(p); best.r.top = Math.max(best.r.top, top); best.r.bottom = Math.min(best.r.bottom, bottom); }
    else rows.push({ top, bottom, ps: [p] });
  }
  return rows.sort((a, b) => b.top - a.top).map((r) => r.ps);
}

/** 3: the same shelf seen twice: most of the smaller one's products in both. */
export function sameShelf(a: Boxed[], b: Boxed[]): boolean {
  const A = new Set(a.map((p) => p.n));
  const both = b.filter((p) => A.has(p.n)).length;
  return both >= 0.5 * Math.min(a.length, b.length);
}

/** The whole plan: every picture's shelves and levels, the same shelf once, in walking order. */
export function planShelves(boxed: Boxed[]): Shelf[] {
  const byT = new Map<number, Boxed[]>();
  for (const p of boxed) byT.set(p.t, [...(byT.get(p.t) ?? []), p]);
  const found: Shelf[] = [];
  const area = (s: Shelf) => median(s.levels.flatMap((l) => l.products.map((p) => p.size.w * p.size.h)));
  for (const [t, ps] of [...byT.entries()].sort((a, b) => a[0] - b[0])) {
    for (const g of shelvesIn(ps)) {
      if (g.length < SHELF_MIN) continue;
      const shelf: Shelf = { t, frame: frameOf(g), levels: levelsIn(g).map((row) => ({ frame: frameOf(row), products: row })) };
      const all = (s: Shelf) => s.levels.flatMap((l) => l.products);
      const i = found.findIndex((s) => sameShelf(all(s), g));
      if (i < 0) found.push(shelf);
      else if (area(shelf) > area(found[i])) found[i] = shelf;
    }
  }
  return found.sort((a, b) => a.t - b.t || a.frame.lon - b.frame.lon);
}

/** A still's size for a frame (px): `maxW` across, its height by the frame's shape, within `minH`…`maxH`. */
export function stillSize(f: Frame, maxW = 2048, minH = 360, maxH = 1536): { w: number; h: number; hfov: number; vfov: number } {
  const hfov = Math.min(2.6, Math.max(0.05, f.w)), vfov0 = Math.min(2.0, Math.max(0.03, f.h));
  let w = maxW, h = Math.round(w * Math.tan(vfov0 / 2) / Math.tan(hfov / 2));
  if (h > maxH) { h = maxH; w = Math.round(h * Math.tan(hfov / 2) / Math.tan(vfov0 / 2)); }
  // Too thin a strip: the frame is grown up and down (more of the shelf above and below), never squashed.
  let vfov = vfov0;
  if (h < minH) { h = minH; vfov = 2 * Math.atan(Math.tan(hfov / 2) * (h / w)); }
  return { w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2, hfov, vfov };
}
