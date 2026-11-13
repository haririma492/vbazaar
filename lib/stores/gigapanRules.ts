// A SHELF'S ZOOM PHOTO — the rules (owner, 2026-11-11: "take 3 Gigapan style photo of a shelf and you need to
// stitch them together so user … zoom in and out and read labels"). The job is `gigapan.ts`, the stitcher
// `scripts/stitch/stack.py`. Pure; tested.
//
// The photos of one shelf bay are uploaded together as a SET (the card makes the set's id); a set is stitched
// once, and again only when its photos change.
import type { ZoomUpload } from "./store";

export type ZoomSet = {
  id: string;
  /** "Shelf 1", «قفسه ۱»: its place among the store's zoom photos. */
  label: { en: string; fa: string };
  /** The photos it was stitched from (their keys, sorted and joined): a different list means stitch again. */
  sig: string;
  state: "done" | "failed";
  /** What the stitcher said: the size and how it joined, or why it could not (for a person to act on). */
  note: string;
  made: string;
  /** Done: the tiles' manifest and the mini-map picture (public https), the photo's size. */
  manifest?: string;
  thumb?: string;
  dzi?: string;
  w?: number;
  h?: number;
  mp?: number;
  tiles?: number;
  /** The stitched master (private bucket), kept for the agents (reading every label, later). */
  master?: string;
  /** The finder's last look for this shelf in the store's walk (`scripts/stitch/locate.py`): which walk and photo it
   *  looked with, whether the shelf was seen, and what it said. Looked again only when the walk or the photo changes. */
  place?: { walk: string; manifest: string; found: boolean; note: string; at: string };
};
/** Whether the finder should look for `set` in `walk`: never looked, or the walk or the photo changed since. */
export function toLocate(set: ZoomSet, walk: string, force = false): boolean {
  if (set.state !== "done" || !set.manifest || !set.master) return false;
  return force || !set.place || set.place.walk !== walk || set.place.manifest !== set.manifest;
}
/**
 * WHAT A SHELF IS CALLED (owner, 2026-11-12: "identify 'Shelves' and assign number or name or both to them"): the
 * number and name the operator gave it on the walk (`named`: the walk's shelves that have either, by id), else its
 * place among the store's zoom photos («Shelf 2»).
 */
export function labelFor(id: string, index: number, named: Map<string, { en: string; fa?: string }>): { en: string; fa: string } {
  const l = named.get(id);
  return l ? { en: l.en, fa: l.fa ?? l.en } : zoomLabel(index);
}
/** The walk's shelves the operator numbered or named, by id. */
export function namedShelves(zooms: Array<{ id: string; n?: number; name?: unknown; label: { en: string; fa?: string } }> | undefined): Map<string, { en: string; fa?: string }> {
  return new Map((zooms ?? []).filter((z) => z.n !== undefined || z.name).map((z) => [z.id, z.label]));
}
/** At most `max` of `frames`, evenly, keeping the first and the last. */
export function thin<T>(frames: T[], max: number): T[] {
  if (frames.length <= max) return frames;
  return Array.from({ length: max }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (max - 1))]);
}
export type ZoomRecord = { store: string; sets: ZoomSet[]; updated: string };

/** The uploads grouped into shelves, in the order each shelf's first photo came. */
export function setsOf(files: ZoomUpload[]): Array<{ id: string; photos: ZoomUpload[] }> {
  const out = new Map<string, ZoomUpload[]>();
  for (const f of [...files].sort((a, b) => a.at.localeCompare(b.at))) out.set(f.set, [...(out.get(f.set) ?? []), f]);
  return [...out].map(([id, photos]) => ({ id, photos }));
}
/** Raised when the stitcher changes what shoppers see, so every shelf is stitched again by the next run
 *  (2: the look pass: sharper contours, punch, shine, colour — owner, 2026-11-12). */
export const STITCH_VERSION = 4; // 4: a finished picture (one photo under 6 MP) is shown as uploaded, no look on it (2026-11-13)
export const sigOf = (photos: Array<{ key: string }>) => `${photos.map((p) => p.key).sort().join("|")}#v${STITCH_VERSION}`;
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const zoomLabel = (i: number) => ({ en: `Shelf ${i + 1}`, fa: `قفسه ${String(i + 1).replace(/\d/g, (d) => FA_DIGITS[Number(d)])}` });

/**
 * Where a shelf stands: `waiting` (never stitched), `changed` (photos added or replaced since), `done`, `failed`
 * (the same photos would fail the same way: only new photos, or «Try again», run it again).
 */
export function stateOf(photos: ZoomUpload[], made: ZoomSet | undefined): "waiting" | "changed" | "done" | "failed" {
  if (!made) return "waiting";
  if (made.sig !== sigOf(photos)) return "changed";
  return made.state;
}
/** The shelves a run stitches: the ones waiting or changed; with `force`, the failed ones too. */
export function toStitch(files: ZoomUpload[], record: ZoomRecord | null, force = false): Array<{ id: string; photos: ZoomUpload[]; index: number }> {
  return setsOf(files).map((s, index) => ({ ...s, index })).filter((s) => {
    const st = stateOf(s.photos, record?.sets.find((x) => x.id === s.id));
    return st === "waiting" || st === "changed" || (force && st === "failed");
  });
}
/** What the stitcher's answer says, in a sentence for the card. */
export function noteOf(r: { w: number; h: number; mp: number; tiles: number; order: string[]; seconds: number; row?: boolean; look?: boolean }): string {
  return `${r.w}×${r.h} px (${r.mp} megapixels) in ${r.tiles} tiles, ${r.seconds} s${r.order.length > 1 ? `; ${r.row ? "left to right" : "top to bottom"}: ${r.order.join(" → ")}` : "; one photo, not stitched"}.`
    // Said plainly: a small picture cannot be zoomed into, whatever was done to it before it was uploaded.
    + (r.look === false ? ` Shown exactly as uploaded (a finished picture, not a camera's own photo).` : "")
    + (r.mp < 6 ? ` ⚠️ Only ${r.mp} megapixels: shoppers can zoom in very little. For labels that can be read, upload the phone's own full-size photos (12 megapixels or more each).` : "");
}
