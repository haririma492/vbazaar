// A DEEP ZOOM PYRAMID, AS THE VIEWER READS IT (owner, 2026-11-11: a shelf's zoom photo is ~100 megapixels; no
// phone can hold it as one picture, so it is cut into 512 px tiles at every size from a thumbnail to full size,
// and the viewer asks only for the tiles on screen at the size on screen). The layout is Microsoft's Deep Zoom
// (DZI): level `maxLevel` is the full photo, each level below is half of it; a tile is
// `<base>/<files>/<level>/<col>_<row>.<format>`. Made by `scripts/stitch/stack.py`. Pure; tested.

export type Pyramid = { type?: "dzi"; w: number; h: number; tile: number; overlap: number; format: string; maxLevel: number; files: string; thumb?: string };
/** What is on screen: the photo's point at the middle of the viewport, and screen (CSS) pixels per photo pixel. */
export type View = { cx: number; cy: number; scale: number };
export type Tile = { level: number; col: number; row: number; x: number; y: number; w: number; h: number };

/** Read a manifest; null when it is not one. */
export function parsePyramid(raw: unknown): Pyramid | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const w = n(o.w), h = n(o.h), tile = n(o.tile), maxLevel = n(o.maxLevel);
  if (!(w >= 1 && h >= 1 && tile >= 64 && tile <= 2048 && Number.isInteger(maxLevel) && maxLevel >= 0 && maxLevel <= 24)) return null;
  if (typeof o.files !== "string" || !/^[A-Za-z0-9_.-]{1,60}$/.test(o.files) || !["jpg", "webp", "png"].includes(String(o.format))) return null;
  return { type: "dzi", w, h, tile, overlap: 0, format: String(o.format), maxLevel, files: o.files, ...(typeof o.thumb === "string" && /^[A-Za-z0-9_.-]{1,60}$/.test(o.thumb) ? { thumb: o.thumb } : {}) };
}

/** A level's size in pixels and in tiles; `shrink`: photo pixels per pixel of this level. */
export function levelSize(p: Pyramid, level: number) {
  const shrink = 2 ** (p.maxLevel - level);
  const w = Math.max(1, Math.ceil(p.w / shrink)), h = Math.max(1, Math.ceil(p.h / shrink));
  return { w, h, cols: Math.ceil(w / p.tile), rows: Math.ceil(h / p.tile), shrink };
}
/** The smallest level worth showing: the whole photo in one tile. */
export function baseLevel(p: Pyramid): number {
  return Math.max(0, p.maxLevel - Math.ceil(Math.log2(Math.max(p.w, p.h) / p.tile)));
}
/** The level to draw at `scale` (screen pixels per photo pixel) on a screen of `dpr`: the first one at least as sharp as the screen. */
export function levelFor(p: Pyramid, scale: number, dpr = 1): number {
  const want = p.maxLevel + Math.ceil(Math.log2(Math.max(1e-9, scale * dpr)) - 1e-6);
  return Math.min(p.maxLevel, Math.max(baseLevel(p), want));
}
/** The scale at which the whole photo fits a viewport of `vw`×`vh`. */
export const fitScale = (p: Pyramid, vw: number, vh: number) => Math.min(vw / p.w, vh / p.h);
/** The closest a shopper may go: two screen pixels a photo pixel (beyond that it is only blur). */
export const MAX_SCALE = 2;

/**
 * The view kept inside the photo (the instructions' "boundary constraints"): never smaller than the whole photo
 * fitted, never closer than `MAX_SCALE`; an edge of the photo never comes inside the viewport, and a photo
 * narrower than the viewport sits in its middle.
 */
export function clampView(p: Pyramid, v: View, vw: number, vh: number): View {
  const fit = fitScale(p, vw, vh);
  const scale = Math.min(Math.max(MAX_SCALE, fit), Math.max(fit, v.scale));
  const halfW = vw / 2 / scale, halfH = vh / 2 / scale;
  const cx = p.w <= 2 * halfW ? p.w / 2 : Math.min(p.w - halfW, Math.max(halfW, v.cx));
  const cy = p.h <= 2 * halfH ? p.h / 2 : Math.min(p.h - halfH, Math.max(halfH, v.cy));
  return { cx, cy, scale };
}
/** Zoomed to `scale` with the photo's point under screen point (`sx`, `sy`) staying under it. */
export function zoomAbout(p: Pyramid, v: View, scale: number, sx: number, sy: number, vw: number, vh: number): View {
  const px = v.cx + (sx - vw / 2) / v.scale, py = v.cy + (sy - vh / 2) / v.scale;
  const s = Math.min(Math.max(MAX_SCALE, fitScale(p, vw, vh)), Math.max(fitScale(p, vw, vh), scale));
  return clampView(p, { scale: s, cx: px - (sx - vw / 2) / s, cy: py - (sy - vh / 2) / s }, vw, vh);
}
/** The part of the photo on screen, in photo pixels. */
export function viewRect(v: View, vw: number, vh: number) {
  return { x: v.cx - vw / 2 / v.scale, y: v.cy - vh / 2 / v.scale, w: vw / v.scale, h: vh / v.scale };
}
/** The tiles of `level` that touch the view (nothing else is fetched), each with its place in photo pixels. */
export function visibleTiles(p: Pyramid, level: number, v: View, vw: number, vh: number): Tile[] {
  const L = levelSize(p, level), r = viewRect(v, vw, vh), span = p.tile * L.shrink;
  const c0 = Math.max(0, Math.floor(r.x / span)), c1 = Math.min(L.cols - 1, Math.floor((r.x + r.w) / span));
  const r0 = Math.max(0, Math.floor(r.y / span)), r1 = Math.min(L.rows - 1, Math.floor((r.y + r.h) / span));
  const out: Tile[] = [];
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    const x = col * span, y = row * span;
    out.push({ level, col, row, x, y, w: Math.min(span, p.w - x), h: Math.min(span, p.h - y) });
  }
  return out;
}
/** A tile's address under the manifest's folder. */
export const tileUrl = (base: string, p: Pyramid, t: Pick<Tile, "level" | "col" | "row">) => `${base}/${p.files}/${t.level}/${t.col}_${t.row}.${p.format}`;
/** The folder a manifest's address is in. */
export const baseOf = (manifestUrl: string) => manifestUrl.replace(/\/[^/]*$/, "");
