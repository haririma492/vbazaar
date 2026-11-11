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
};
export type ZoomRecord = { store: string; sets: ZoomSet[]; updated: string };

/** The uploads grouped into shelves, in the order each shelf's first photo came. */
export function setsOf(files: ZoomUpload[]): Array<{ id: string; photos: ZoomUpload[] }> {
  const out = new Map<string, ZoomUpload[]>();
  for (const f of [...files].sort((a, b) => a.at.localeCompare(b.at))) out.set(f.set, [...(out.get(f.set) ?? []), f]);
  return [...out].map(([id, photos]) => ({ id, photos }));
}
export const sigOf = (photos: Array<{ key: string }>) => photos.map((p) => p.key).sort().join("|");
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
export function noteOf(r: { w: number; h: number; mp: number; tiles: number; order: string[]; seconds: number }): string {
  return `${r.w}×${r.h} px (${r.mp} megapixels) in ${r.tiles} tiles, ${r.seconds} s${r.order.length > 1 ? `; top to bottom: ${r.order.join(" → ")}` : "; one photo, not stitched"}.`;
}
