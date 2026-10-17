/**
 * CUT AND STITCH A WALK VIDEO (founder, 2026-10-18: "4:20 - 4:40, 7:48 - 8:20
 * … only useful part … cut and stitch couple of sections and save on olgoo
 * (under the same name)"). The rules; the server job is `cut-job.ts`.
 *
 * - The parts kept are joined in time order into one video saved under the
 *   SAME key, so the walk, its projection, its sound and every link stay.
 * - The first cut keeps the original beside it, `<key>.original` (not a walk
 *   key, so no list shows it): «Put the original back» copies it home.
 * - The walk's doors and product dots move with the picture (`remapWalk`):
 *   a moment in a kept part moves to its place in the new video; a moment in
 *   a part cut away is dropped (a door there goes, a dot loses that pin).
 * - Cached copies: video files are cached "forever" by name, so the walk's
 *   `rev` changes with every cut and the player asks for `<file>?r=<rev>`.
 */

import type { Walk } from "./walks";

export type Part = { from: number; to: number };

export const MAX_PARTS = 20;
/** Shorter than this is a slip of the finger, not a part. */
export const MIN_PART_SECONDS = 1;

/** «4:20», «1:02:03», «260» or «260.5» → seconds; null when it is none of those. */
export function readTime(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(t)) return null;
  const [whole, frac] = t.split(".");
  const n = whole.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
  const parts = whole.split(":");
  if (parts.slice(1).some((p) => Number(p) >= 60)) return null;
  return n + (frac ? Number(`0.${frac}`) : 0);
}

/** 260 → «4:20», 3723.5 → «1:02:03.5». */
export function sayTime(sec: number): string {
  const r = Math.round(sec * 10) / 10;
  const h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), s = r % 60;
  const ss = (Number.isInteger(s) ? String(s) : s.toFixed(1)).padStart(Number.isInteger(s) ? 2 : 4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The parts in time order, each checked against the video's length; every problem said. */
export function checkParts(raw: unknown, duration: number): { parts: Part[]; problems: string[] } {
  const problems: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) problems.push("Choose at least one part to keep.");
  if (list.length > MAX_PARTS) problems.push(`At most ${MAX_PARTS} parts.`);
  const parts: Part[] = [];
  for (const [i, p] of list.slice(0, MAX_PARTS).entries()) {
    const from = Number((p as Part)?.from), to = Number((p as Part)?.to);
    const name = `Part ${i + 1}`;
    if (!Number.isFinite(from) || !Number.isFinite(to)) { problems.push(`${name}: a start and an end.`); continue; }
    if (from < 0 || (duration > 0 && to > duration + 0.5)) { problems.push(`${name}: ${sayTime(from)}–${sayTime(to)} is outside the video (0:00–${sayTime(duration)}).`); continue; }
    if (to - from < MIN_PART_SECONDS) { problems.push(`${name}: it ends before it starts, or is under ${MIN_PART_SECONDS} s.`); continue; }
    parts.push({ from: Math.round(from * 100) / 100, to: Math.round(Math.min(to, duration > 0 ? duration : to) * 100) / 100 });
  }
  parts.sort((a, b) => a.from - b.from);
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].from < parts[i - 1].to) problems.push(`${sayTime(parts[i - 1].from)}–${sayTime(parts[i - 1].to)} and ${sayTime(parts[i].from)}–${sayTime(parts[i].to)} overlap.`);
  }
  return { parts, problems };
}

export const keptSeconds = (parts: Part[]) => parts.reduce((s, p) => s + (p.to - p.from), 0);

/** Where a moment of the old video lands in the new one; null when it was cut away. */
export function mapTime(t: number, parts: Part[]): number | null {
  let at = 0;
  for (const p of parts) {
    if (t >= p.from && t <= p.to) return Math.round((at + t - p.from) * 100) / 100;
    at += p.to - p.from;
  }
  return null;
}

/** The walk's doors and dots moved to the new video's times (see the head of this file). */
export function remapWalk(walk: Walk, parts: Part[]): { walk: Walk; dropped: string[] } {
  const dropped: string[] = [];
  const doors = walk.doors.flatMap((d) => {
    const t = mapTime(d.t, parts);
    if (t === null) { dropped.push(`door «${d.label.en}»`); return []; }
    const pins = d.pins?.flatMap((p) => { const pt = mapTime(p.t, parts); return pt === null ? [] : [{ ...p, t: pt }]; });
    const bt = d.back ? mapTime(d.back.t, parts) : null;
    const { pins: _p, back: _b, ...rest } = d;
    return [{ ...rest, t, ...(pins?.length ? { pins } : {}), ...(d.back && bt !== null ? { back: { ...d.back, t: bt } } : {}) }];
  });
  const items = walk.items?.map((it) => {
    const pins = it.pins.flatMap((p) => { const pt = mapTime(p.t, parts); return pt === null ? [] : [{ ...p, t: pt }]; });
    if (it.pins.length && !pins.length) dropped.push(`the dot of «${it.label.en}» (kept in the list, place it again)`);
    return { ...it, pins };
  });
  return { walk: { ...walk, doors, ...(items ? { items } : {}) }, dropped };
}

/** Where the original is kept by the first cut. */
export const originalKeyOf = (key: string) => `${key}.original`;

/**
 * ffmpeg's arguments: each part read straight from `src` (a signed address —
 * `-ss` before `-i` asks R2 for that stretch only, not the whole file),
 * joined, and written once as H.264 the way walks want it (a frame every
 * second for quick stepping back, faststart). No sound: the walk plays its
 * video muted (`Walk.audio` is its sound).
 */
export function cutArgs(src: string, parts: Part[], out: string): string[] {
  const inputs = parts.flatMap((p) => ["-ss", String(p.from), "-to", String(p.to), "-i", src]);
  const filter = parts.map((_, i) => `[${i}:v:0]setpts=PTS-STARTPTS[v${i}]`).join(";")
    + `;${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${parts.length}:v=1:a=0[v]`;
  return [
    "-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-nostats",
    ...inputs,
    "-filter_complex", filter, "-map", "[v]", "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-force_key_frames", "expr:gte(t,n_forced*1)", "-movflags", "+faststart", out,
  ];
}
