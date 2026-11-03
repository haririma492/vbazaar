/**
 * HOW FAST THE PHOTOGRAPHER WALKED (owner, 2026-11-03: "can we make the 'Slow'
 * and 'Fast' such that they work regardless of the speed of walk of
 * photographer and is always standard?").
 *
 * Self-drive used to play a walk at a fixed multiple of how it was filmed, so
 * «Slow» on a walk filmed briskly was faster than «Fast» on one filmed slowly.
 * Now each walk carries `pace`, the photographer's own speed in metres a
 * second, and the player plays at `STANDARD[speed] / pace`, so Slow and Fast
 * are the same speed on every walk.
 *
 * The pace is MEASURED from the picture, by the lock agent (`lock.ts`), with no
 * AI: the floor is the one thing in every walk at a known distance — the
 * camera is held over the head, `CAMERA_HEIGHT` above it — so how fast the
 * floor slides past, seen in four views looking 45° down, gives the speed in
 * metres. The views are cut out of the 360° frame by ffmpeg; this module does
 * the arithmetic and is pure (tested in `pace.test.ts`).
 *
 * A floor with no texture, a walk that never moves, or views that do not
 * agree give no pace (null), and the player falls back to the old multiples.
 */

/** Metres a second the self-drive speeds walk at, on every walk. */
export const STANDARD = { slow: 0.3, fast: 1.4, back: 0.5 } as const;
/** How high the camera is held above the floor (m): over the head, as filming asks. */
export const CAMERA_HEIGHT = 2.0;
/** The views look this far down (rad): 45°, where the floor is close and the operator is not. */
export const VIEW_PITCH = Math.PI / 4;
/** Each view: this wide (rad) and this many pixels across and down. */
export const VIEW_FOV = Math.PI / 3;
export const VIEW_W = 160, VIEW_H = 120;
/** The four directions looked in (deg): ahead, right, behind, left. */
export const VIEW_YAWS = [0, 90, 180, -90];
/** Frames a second the walk is measured at. */
export const PACE_FPS = 4;
/** Pace is believed between these (m/s); anything else is a misreading. */
export const PACE_MIN = 0.2, PACE_MAX = 3;

/**
 * The shift (px) that best lines `b` up with `a` (grey frames, `w`×`h`), within
 * ±`range` px: how far the picture moved between them. Sum of absolute
 * differences over the middle of the frame, coarse then fine. `score` is how
 * much better the best is than an average guess (0 = no texture to go on).
 */
export function frameShift(a: Uint8Array, b: Uint8Array, w: number, h: number, range = 30): { dx: number; dy: number; score: number } {
  const x0 = range + 2, x1 = w - range - 2, y0 = range + 2, y1 = h - range - 2;
  if (x1 - x0 < 8 || y1 - y0 < 8) return { dx: 0, dy: 0, score: 0 };
  const sad = (dx: number, dy: number, step: number) => {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y += step) {
      const ra = y * w, rb = (y + dy) * w + dx;
      for (let x = x0; x < x1; x += step) { s += Math.abs(a[ra + x] - b[rb + x]); n++; }
    }
    return s / n;
  };
  let best = { dx: 0, dy: 0, v: Infinity }, total = 0, count = 0;
  for (let dy = -range; dy <= range; dy += 2) {
    for (let dx = -range; dx <= range; dx += 2) {
      const v = sad(dx, dy, 2);
      total += v; count++;
      if (v < best.v) best = { dx, dy, v };
    }
  }
  // Fine: the coarse best and its neighbours, every pixel counted.
  const cx = best.dx, cy = best.dy;
  best = { dx: cx, dy: cy, v: sad(cx, cy, 1) };
  for (let dy = cy - 1; dy <= cy + 1; dy++) {
    for (let dx = cx - 1; dx <= cx + 1; dx++) {
      if ((dx === cx && dy === cy) || Math.abs(dx) > range || Math.abs(dy) > range) continue;
      const v = sad(dx, dy, 1);
      if (v < best.v) best = { dx, dy, v };
    }
  }
  const mean = total / count;
  return { dx: best.dx, dy: best.dy, score: mean > 0 ? Math.max(0, 1 - best.v / mean) : 0 };
}

/**
 * Metres the camera moved, from a view's shift (px). Looking `pitch` down at
 * the floor `height` below, a step `d` along the view slides the floor
 * `d·sin²(pitch)/height` rad up or down the view; a step across it slides it
 * `d·sin(pitch)/height` rad sideways.
 */
export function groundMove(dx: number, dy: number, opts = { height: CAMERA_HEIGHT, pitch: VIEW_PITCH, fov: VIEW_FOV, width: VIEW_W }): number {
  const radPerPx = opts.fov / opts.width;
  const s = Math.sin(opts.pitch);
  const along = (dy * radPerPx * opts.height) / (s * s);
  const across = (dx * radPerPx * opts.height) / s;
  return Math.hypot(along, across);
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The pace (m/s) from frame pairs: for each pair, the views' moves (m) over
 * `dt` seconds. A pair counts when at least two views had texture; its speed
 * is the middle of its views (one view may hold the operator, who moves with
 * the camera, or a passer-by). Standing still is left out, then the middle of
 * the walking is the pace. Null when too little was readable.
 */
export function paceOf(pairs: { move: number; score: number }[][], dt: number, minScore = 0.15): number | null {
  const speeds: number[] = [];
  for (const views of pairs) {
    const good = views.filter((v) => v.score >= minScore && Number.isFinite(v.move));
    if (good.length < 2) continue;
    speeds.push(median(good.map((v) => v.move)) / dt);
  }
  const walking = speeds.filter((v) => v >= 0.15 && v <= PACE_MAX * 1.5);
  if (walking.length < 10 || walking.length < speeds.length * 0.2) return null;
  const pace = median(walking);
  return pace >= PACE_MIN && pace <= PACE_MAX ? Math.round(pace * 100) / 100 : null;
}

/**
 * The self-drive rate (times as filmed) for `speed` on a walk filmed at
 * `pace` m/s; without a pace, the fallback multiple. Browsers play from 0.25×
 * to 4× smoothly (slower is stepped by the player), so the rate stays in that.
 */
export function driveRate(speed: keyof typeof STANDARD, pace: number | null | undefined, fallback: number): number {
  if (!pace || !Number.isFinite(pace) || pace <= 0) return fallback;
  const r = STANDARD[speed] / pace;
  const sign = speed === "back" ? -1 : 1;
  return sign * Math.round(Math.min(4, Math.max(0.1, r)) * 100) / 100;
}
