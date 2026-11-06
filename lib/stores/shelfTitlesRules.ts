// THE SHELF PHOTOS' RULES (owner, 2026-11-06: "build that" — phone photos of the
// shelves, every spine read; the job is `shelfTitles.ts`). Pure (tested in
// shelfTitlesRules.test.ts).
//
//   1. TILES: a phone photo is 4000 px or more across, and Claude sees at most
//      ~1568 px of a picture; shrunk whole, a spine's letters would be back to
//      the video's 10 px. So a photo is cut into overlapping tiles of at most
//      `TILE` px (`OVERLAP` shared each side, so a spine cut by one tile's edge
//      is whole in the next), each read on its own.
//   2. ONE BOOK ONCE: the same title from two tiles (the overlap), two photos,
//      or the video's own reading is one entry: titles are compared folded
//      (Arabic/Persian letter forms, the half-space, diacritics, punctuation),
//      and the surer reading is kept.

export type SpineRow = {
  title_fa: string; title_en: string; author: string; readable: "full" | "partial"; confidence: number;
  /** The shelf photo it was read in (upload key) and that tile. */
  photo: string; tile: number;
};

/** A tile's longest side (px): Claude's useful picture size. */
export const TILE = 1568;
/**
 * A photo is read at its own size up to this long a side (px): every pixel the phone took (a 12 MP photo, 4032
 * px, is 9 tiles). With Claude Haiku 5.5 a tile costs a fraction of a cent (owner, 2026-11-06: "Make the best
 * use of Haiku … lets call it often"), so nothing is thrown away to save requests. Only a 48 MP photo is brought
 * down, to keep a run's length sane.
 */
export const MAX_SIDE = 6000;
/** About this much a request (cents, Haiku: a tile or a zoomed quarter): what the operator is told before a run. */
export const CENTS_A_TILE = 0.25;
/** A usual phone photo: 9 tiles, plus the zoomed quarters of the ~2 tiles with a partly read title. */
export const CALLS_A_PHOTO = 17;
/** Each tile shares this share of its size with the next. */
export const OVERLAP = 0.15;

/** The tiles of a `w`×`h` photo, row by row: none when it fits in one. */
export function tilesOf(w: number, h: number): Array<{ x: number; y: number; w: number; h: number }> {
  const along = (len: number) => {
    if (len <= TILE) return [{ at: 0, len }];
    const step = TILE * (1 - OVERLAP);
    const n = Math.ceil((len - TILE) / step) + 1;
    // Evenly spread, the last one ending at the edge.
    return Array.from({ length: n }, (_, i) => ({ at: Math.round(i === n - 1 ? len - TILE : (i * (len - TILE)) / (n - 1)), len: TILE }));
  };
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const r of along(h)) for (const c of along(w)) out.push({ x: c.at, y: r.at, w: c.len, h: r.len });
  return out;
}

/** A title folded for comparing: letter forms, half-space, diacritics, digits and punctuation set aside. */
export function foldTitle(v: string): string {
  return v
    .normalize("NFKC")
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[ۀة]/g, "ه").replace(/[أإآ]/g, "ا").replace(/ؤ/g, "و")
    .replace(/[ً-ٰٟ]/g, "") // harakat
    .replace(/[‌‍ـ]/g, " ") // ZWNJ, ZWJ, tatweel → space
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The key two readings of one book share: its folded Farsi title, else its folded English one. Empty: not comparable. */
export function bookKey(r: { title_fa: string; title_en: string }): string {
  const fa = foldTitle(r.title_fa);
  return fa ? `fa:${fa}` : foldTitle(r.title_en) ? `en:${foldTitle(r.title_en)}` : "";
}

const rank = (r: { readable: string; confidence: number }) => (r.readable === "full" ? 1 : 0) + r.confidence;

/** Readings merged: one per book, the surer kept; a reading with no title at all is dropped. */
export function mergeSpines<T extends { title_fa: string; title_en: string; readable: string; confidence: number }>(rows: T[]): T[] {
  const by = new Map<string, T>();
  for (const r of rows) {
    const k = bookKey(r);
    if (!k) continue;
    const had = by.get(k);
    if (!had || rank(r) > rank(had)) by.set(k, r);
  }
  return [...by.values()];
}

/** The size a `w`×`h` photo is read at (never enlarged). */
export function readSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/**
 * THE ZOOM PASS: a tile where some title was only partly read is read again as four overlapping quarters, each
 * enlarged (to at most `TILE` px): small print gets more pixels in front of the model. Cheap on Haiku.
 */
export function quartersOf(t: { x: number; y: number; w: number; h: number }): Array<{ x: number; y: number; w: number; h: number; scale: number }> {
  const qw = Math.round(t.w * (0.5 + OVERLAP / 2)), qh = Math.round(t.h * (0.5 + OVERLAP / 2));
  const scale = Math.min(2, TILE / Math.max(qw, qh));
  const out: Array<{ x: number; y: number; w: number; h: number; scale: number }> = [];
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) out.push({ x: t.x + (fx ? t.w - qw : 0), y: t.y + (fy ? t.h - qh : 0), w: qw, h: qh, scale });
  return out;
}
