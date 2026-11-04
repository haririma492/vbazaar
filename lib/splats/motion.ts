// A WALK'S MOTION, MEASURED, FOR A SMOOTH RIDE (owner, 2026-11-04: "the route
// optimizer also is in charge of smoothness, to fix sharp turns, fast moves in
// one spot and slow in another so on and so forth").
//
// The Route optimizer measures how the camera moved all through a walk
// (`lib/stores/routeJob.ts`: the floor's slide, the horizon's turn, 5 times a
// second) and keeps it on the walk (`Walk.motion`). The player uses it two ways,
// changing nothing in the video:
//   - EVEN SPEED: the self-drive's rate comes from how fast the photographer
//     walked HERE (`paceAt`), not the walk's average: where they hurried it plays
//     slower, where they dawdled or stood it plays faster (up to the browser's
//     4×), so the shopper moves at one even pace;
//   - SMOOTH TURNS: where the camera swung or turned sharply, the view is turned
//     gently against it (`turnEase`): the world turns as the smoothed heading
//     does (`TURN_SMOOTH_S`), never more than `MAX_EASE` away from the camera's.
// Pure; tested in motion.test.ts.

/** Measured every `dt` s from 0: walking speed (m/s, along the floor) and the camera's heading (rad, summed from the start; + = turned right). */
export type WalkMotion = { dt: number; speed: number[]; yaw: number[]; rev?: number };

/** Speeds are taken over this window (s): a step is not a hurry. */
export const PACE_WINDOW_S = 1.5;
/** Below this (m/s) the photographer was standing: it plays as if walking this slowly (the fastest the player goes there). */
export const STANDING = 0.12;
/** The heading is smoothed over this window (s) for the shopper's view. */
export const TURN_SMOOTH_S = 2.5;
/** The camera's own heading is taken over this window (s): its measuring jitter left out. */
export const CAMERA_S = 0.4;
/** The view is never turned more than this (rad, ~35°) against the camera. */
export const MAX_EASE = 0.6;

const at = (v: number[], dt: number, t: number) => {
  const f = Math.max(0, Math.min(v.length - 1, t / dt));
  const i = Math.min(v.length - 2, Math.floor(f));
  return v.length > 1 ? v[i] + (v[i + 1] - v[i]) * (f - i) : v[0] ?? 0;
};
/** Mean of `v` round `t` over `win` s (tricube weights). */
function windowMean(v: number[], dt: number, t: number, win: number): number {
  const c = t / dt, r = win / 2 / dt;
  let s = 0, w = 0;
  for (let i = Math.max(0, Math.floor(c - r)); i <= Math.min(v.length - 1, Math.ceil(c + r)); i++) {
    const u = Math.abs(i - c) / (r + 1e-9);
    if (u >= 1) continue;
    const k = (1 - u * u * u) ** 3;
    s += v[i] * k; w += k;
  }
  return w ? s / w : at(v, dt, t);
}

/** How fast the photographer walked round `t` (m/s), never under `STANDING`; null without a measured motion. */
export function paceAt(m: WalkMotion | null | undefined, t: number): number | null {
  if (!m || !m.speed.length) return null;
  // ⚠️ ROBUST (measured on the bookshop, 2026-11-04): single readings of the floor's slide are noisy, so the
  // middle reading round `t`, not the mean; and never more than `PACE_SPAN`× off the walk's own middle pace,
  // so a noisy patch can neither make the walk crawl nor race.
  const c = Math.round(t / m.dt), r = Math.round(PACE_WINDOW_S / 2 / m.dt);
  const near = m.speed.slice(Math.max(0, c - r), Math.min(m.speed.length, c + r + 1));
  const local = median(near.length ? near : m.speed);
  const typical = median(m.speed);
  return Math.max(STANDING, Math.min(typical * PACE_SPAN, Math.max(typical / PACE_SPAN, local)));
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
/** The pace here is kept within this factor of the walk's own middle pace. */
export const PACE_SPAN = 2.5;

/**
 * How far to turn the shopper's view (rad, in the video's own directions) at
 * `t` so the world turns as the smoothed heading does: the smoothed heading
 * less the camera's (lightly smoothed), kept within ±`MAX_EASE`.
 */
export function turnEase(m: WalkMotion | null | undefined, t: number): number {
  if (!m || m.yaw.length < 2) return 0;
  // ⚠️ Against the heading lightly smoothed (`CAMERA_S`), not as measured: the measuring's own
  // jitter, corrected for, would have become a new small shake of the view.
  const d = windowMean(m.yaw, m.dt, t, TURN_SMOOTH_S) - windowMean(m.yaw, m.dt, t, CAMERA_S);
  return Math.max(-MAX_EASE, Math.min(MAX_EASE, d));
}

/** A walk's motion read back from walks.json, checked: null when it is not one. */
export function parseMotion(v: unknown): WalkMotion | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const ok = (a: unknown) => Array.isArray(a) && a.length <= 20000 && a.every((x) => typeof x === "number" && Number.isFinite(x));
  if (typeof o.dt !== "number" || !(o.dt > 0 && o.dt <= 2) || !ok(o.speed) || !ok(o.yaw)) return null;
  const speed = o.speed as number[], yaw = o.yaw as number[];
  if (!speed.length || speed.length !== yaw.length) return null;
  return { dt: o.dt, speed, yaw, ...(typeof o.rev === "number" ? { rev: o.rev } : {}) };
}
