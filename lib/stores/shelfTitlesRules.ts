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
 * A photo is first brought to at most this long a side (px). A 12 MP phone photo of a 1 m shelf section gives a
 * spine's letters ~40 px at full size; at 2800 still ~28 px (the video gave ~10), and it is 4 tiles, not 9 —
 * the cost is per tile.
 */
export const MAX_SIDE = 2800;
/** About this much a tile (one request): what the operator is told before a run. */
export const CENTS_A_TILE = 5;
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
