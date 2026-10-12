/**
 * FOLLOW A TAPPED PRODUCT THROUGH A FLAT (PHONE) VIDEO — the browser half of
 * `lib/splats/track.ts` (founder, 2026-10-12: "the dot moves with shopper,
 * instead of being pinned to the product").
 *
 * A hidden copy of the video (so the operator's own view does not jump) is
 * stepped every `STEP` seconds forward from the tapped moment, then backward,
 * each frame drawn small on a canvas and the tapped patch found again in it.
 * The result is a pin per step — fractions of the frame, the same as a tap —
 * from where the product comes into view to where it leaves.
 *
 * ⚠️ IT NEEDS TO READ THE PICTURE, so only videos served with CORS (the scenes
 * bucket): a private phone video (`masters/…`, a signed link) cannot be read,
 * and the follow fails — the operator then taps it a few times by hand.
 */

import { clampCentre, followStep, patchAt, toGray } from "@/lib/splats/track";
import type { ItemPin } from "@/lib/splats/walks";

/** Seconds between followed frames. */
const STEP = 0.2;
/** How far either way to follow (s). */
const SPAN = 15;
/** The frame's width while following (px): small enough to be quick, big enough for a label. */
const WORK_W = 320;
/** The patch followed, as a share of the frame's width. */
const PATCH = 0.09;

export type FollowProgress = { done: number; total: number };

export async function followProduct(
  src: string,
  start: ItemPin,
  onProgress: (p: FollowProgress) => void,
  signal: { cancelled: boolean },
): Promise<ItemPin[]> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  try {
    await new Promise<void>((ok, fail) => {
      video.addEventListener("loadeddata", () => ok(), { once: true });
      video.addEventListener("error", () => fail(new Error("The video could not be opened to follow the product.")), { once: true });
      video.load();
    });
    const vw = video.videoWidth, vh = video.videoHeight;
    const w = WORK_W, h = Math.round((vh / vw) * WORK_W);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const size = Math.max(12, Math.round(w * PATCH) | 1);
    const radius = Math.round(size * 1.2);
    const duration = video.duration;

    const frameAt = async (t: number): Promise<Float32Array> => {
      await new Promise<void>((ok) => {
        const done = () => ok();
        video.addEventListener("seeked", done, { once: true });
        video.currentTime = Math.min(Math.max(0, t), Math.max(0, duration - 0.05));
      });
      ctx.drawImage(video, 0, 0, w, h);
      // Throws on a video without CORS: the caller says so and falls back to taps.
      return toGray(ctx.getImageData(0, 0, w, h).data, w, h);
    };

    const first = await frameAt(start.t);
    const c0 = clampCentre(start.x * w, start.y * h, w, h, size);
    const template0 = patchAt(first, w, c0.x, c0.y, size);
    const pins: ItemPin[] = [{ t: start.t, x: start.x, y: start.y }];
    const forwardSteps = Math.max(0, Math.min(Math.floor(SPAN / STEP), Math.floor((duration - start.t) / STEP)));
    const backSteps = Math.max(0, Math.min(Math.floor(SPAN / STEP), Math.floor(start.t / STEP)));
    const total = forwardSteps + backSteps;
    let done = 0;

    for (const dir of [1, -1] as const) {
      let at = { x: c0.x, y: c0.y };
      let template = template0;
      const steps = dir === 1 ? forwardSteps : backSteps;
      for (let i = 1; i <= steps; i++) {
        if (signal.cancelled) throw new Error("cancelled");
        const t = start.t + dir * i * STEP;
        const r = followStep(await frameAt(t), w, h, template, size, at, radius);
        done++;
        onProgress({ done, total });
        if (!r) {
          done += steps - i; // the rest of this way is not needed
          onProgress({ done, total });
          break;
        }
        at = r;
        template = r.template;
        pins.push({ t: Math.round(t * 100) / 100, x: Math.round((r.x / w) * 1000) / 1000, y: Math.round((r.y / h) * 1000) / 1000 });
      }
    }
    return pins.sort((a, b) => a.t - b.t);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
