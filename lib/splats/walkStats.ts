/**
 * A WALK'S OWN NUMBERS, at its top left (owner, 2026-11-11: "accurately measure and label on top left a) actual
 * PPD & 2) FPS … we do not need estimation the real numbers"; then, of pixels over angle: "this is pretty
 * accurate, total pixels devided by total angels gives PPD").
 *
 *   PPD   pixels per degree ACROSS: the playing copy's width over the angle it spans. A 360° panorama spans 360°
 *         exactly; YouTube's cube map 270° (three faces of 90°); a flat video its lens (`Walk.lens`, `lens.ts`:
 *         ⚠️ 70° along the long side unless the store's real lens is set, so a flat walk's PPD is as true as
 *         that angle). The phone copy is narrower than the web copy: the number is the copy on screen's.
 *   FPS   the video's own frame rate, from the times of the frames the browser shows
 *         (`requestVideoFrameCallback`'s `mediaTime`): the step between two frames one after the other. Played
 *         fast, frames are skipped and steps are whole multiples of it, so the SMALLEST step seen a few times is
 *         the frame's. Not how fast the screen is drawing.
 *
 * Pure: `node --test` runs it.
 */
import type { FlatLens } from "./lens";

/** Pixels per degree across a video `width` px wide; null when it cannot be said. */
export function ppdOf(width: number, projection: "equirect" | "eac" | "flat" | null, lens: FlatLens | null): number | null {
  if (!(width > 0)) return null;
  const span = projection === "flat" ? (lens ? (lens.hfov * 180) / Math.PI : null) : projection === "eac" ? 270 : 360;
  return span && span > 0 ? Math.round((width / span) * 10) / 10 : null;
}

/** The frame rate from the steps (s) between frames shown one after the other; null until it is sure (the same smallest step, 3 times). */
export function fpsOf(steps: number[]): number | null {
  const ok = steps.filter((d) => d > 1 / 250 && d < 0.5);
  if (ok.length < 3) return null;
  const min = Math.min(...ok);
  const same = ok.filter((d) => d < min * 1.2);
  if (same.length < 3) return null;
  const step = same.reduce((s, d) => s + d, 0) / same.length;
  return Math.round((1 / step) * 100) / 100;
}
