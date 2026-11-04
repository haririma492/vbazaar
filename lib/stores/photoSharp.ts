// A PRODUCT'S PHOTO: THE SHARPEST FRAME, AT THE VIDEO'S OWN RESOLUTION
// (owner, 2026-11-05: "look at the screenshots of product photos compare to
// screenshot I myself got when stopped the movie … the latter is much better.
// The green rectangle identifying the book on the photo was a good idea keep it").
//
// ⚠️ TRIED AND DROPPED (2026-11-04 → 05): combining 5 frames. The close-ups were
// cut at 512 px, averaged (which softens) and blown up to 1024: worse than a
// paused frame. Now:
//   1. up to `CANDIDATES` moments along the product's light are measured for
//      sharpness (`sharpnessAt`), in the SHARPEST source there is: the upload
//      itself, at the original's time even after a cut (`timeOf`);
//   2. the sharpest one is cut once, aimed at the product, at the video's OWN
//      pixels (`nativeSize`: as many pixels as the product covers in the
//      source, never blown up more than `MAX_GROW`×), with Lanczos;
//   3. the yellow box is drawn round what the finder boxed. Nothing is
//      averaged, sharpened or invented.
import { run, v360Yaw, photoFrame, sharpnessAt } from "./media";
import type { ItemPin } from "@/lib/splats/walks";

export const CANDIDATES = 12, MIN_PX = 480, MAX_PX = 1280, MAX_GROW = 1.25;
/** A photo's side (px) when cut at the finder's own sighting: enlarged in ONE step, as the player does on screen. */
export const SIGHTING_PX = 1024;
/** Moments looked at round a sighting (s): the sharpest of them is cut. Small, so the product stays in the box. */
export const AROUND = [-0.2, -0.1, 0, 0.1, 0.2];

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);

/** The photo's side (px): the source's own pixels across the view's field (`fov` rad), a source `srcW` px round. */
export function nativeSize(fov: number, srcW: number): number {
  const px = (fov / (2 * Math.PI)) * srcW * MAX_GROW;
  return Math.max(MIN_PX, Math.min(MAX_PX, Math.round(px / 2) * 2));
}

/**
 * The product's photo from its light (`pins`, `size`, in the walk's times):
 * the sharpest moment, cut from `input` at `timeOf(t)`. `srcW` is the source's
 * width. Returns the JPEG and the moment used.
 */
export async function sharpestPhoto(input: string, srcW: number, pins: ItemPin[], size: { w: number; h: number }, timeOf: (t: number) => number = (t) => t): Promise<{ jpeg: Uint8Array; t: number }> {
  const step = Math.max(1, Math.floor(pins.length / CANDIDATES));
  let best: { q: ItemPin; score: number } | null = null;
  for (const q of pins.filter((_, i) => i % step === 0).slice(0, CANDIDATES)) {
    try {
      const score = await sharpnessAt(input, timeOf(q.t), q.x, q.y, size);
      if (!best || score > best.score) best = { q, score };
    } catch { /* that moment is skipped */ }
  }
  if (!best) throw new Error("No frame of the product could be cut.");
  const fov0 = photoFrame(size, 100).fov;
  const n = nativeSize(fov0, srcW);
  const { fov, box } = photoFrame(size, n);
  const q = best.q;
  const jpeg = new Uint8Array(await run("ffmpeg", ["-v", "error", "-ss", timeOf(q.t).toFixed(3), "-i", input, "-frames:v", "1", "-vf",
    `v360=input=e:output=flat:yaw=${v360Yaw(q.x).toFixed(3)}:pitch=${deg(q.y)}:h_fov=${deg(fov)}:v_fov=${deg(fov)}:w=${n}:h=${n}:interp=lanczos,` +
    `drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=yellow@0.9:t=${Math.max(2, Math.round(n / 300))}`,
    "-threads", "1", "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]));
  return { jpeg, t: q.t };
}

/**
 * ⚠️ AT THE FINDER'S OWN SIGHTING (owner, 2026-11-05; measured on the bookshop's
 * blue books): along a light the camera is often far from the product, so the
 * box drawn at the size the finder saw held a dozen books. At the sighting the
 * box fits exactly, and the closest sighting (the largest box) has the most
 * pixels. So: the product's closest sighting, the sharpest frame within
 * ±0.2 s of it, from the source in the sighting's own times (the upload: the
 * original's times), enlarged ONCE (v360 Lanczos, straight to `SIGHTING_PX`)
 * with a light unsharp, and the yellow box. Nothing averaged or invented.
 */
export type Seen = { t: number; lon: number; lat: number; size: { w: number; h: number } };
export async function sightingPhoto(input: string, seen: Seen, end = Infinity): Promise<{ jpeg: Uint8Array; t: number }> {
  let best: { t: number; score: number } | null = null;
  for (const dt of AROUND) {
    const t = Math.max(0, Math.min(end - 0.05, seen.t + dt));
    try {
      const score = await sharpnessAt(input, t, seen.lon, seen.lat, seen.size);
      if (!best || score > best.score) best = { t, score };
    } catch { /* that moment is skipped */ }
  }
  const t = best?.t ?? seen.t, n = SIGHTING_PX;
  const { fov, box } = photoFrame(seen.size, n);
  const jpeg = new Uint8Array(await run("ffmpeg", ["-v", "error", "-ss", t.toFixed(3), "-i", input, "-frames:v", "1", "-vf",
    `v360=input=e:output=flat:yaw=${v360Yaw(seen.lon).toFixed(3)}:pitch=${deg(seen.lat)}:h_fov=${deg(fov)}:v_fov=${deg(fov)}:w=${n}:h=${n}:interp=lanczos,` +
    `unsharp=5:5:0.4:5:5:0,drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=yellow@0.9:t=4`,
    "-threads", "1", "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]));
  return { jpeg, t };
}

/** A time in a cut walk → the same moment in the original (the upload's times), from the cut's `parts` in order. */
export function originalTime(parts: Array<{ from: number; to: number }>, t: number): number {
  let at = 0;
  for (const p of parts) {
    const len = p.to - p.from;
    if (t < at + len || p === parts[parts.length - 1]) return p.from + Math.min(len, Math.max(0, t - at));
    at += len;
  }
  return t;
}
