// THE PHOTOGRAPHER'S TURNS, READ FROM THE PICTURE (founder, 2026-10-10: "a
// self drive should turn the wheel when photographer has turned so the wheel
// become as close to reality as possible").
//
// A 360° walk exported from Insta360 Studio keeps its forward on the camera's
// front, so when the photographer turns, the whole world slides sideways in
// the equirectangular frame — the same amount at every height. A band round
// the horizon, averaged down each column, is a ring of numbers; between two
// moments it comes back rotated, and the rotation is the turn. Walking
// straight on slides the left and right halves opposite ways, which cancels.
//
// Pure functions (no DOM): `Walk360.tsx` draws the band on a small canvas.

/** Columns sampled round the horizon (1.4° each). */
export const TURN_COLS = 256;

/**
 * A horizon band (RGBA, `w` × `h`) → its column profile: each column's mean
 * brightness, as a gradient round the ring (brightness drifts don't count),
 * mean 0, length 1. All zeros for a flat grey band.
 */
export function bandProfile(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const col = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      col[x] += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  const g = new Float32Array(w);
  let mean = 0;
  for (let x = 0; x < w; x++) {
    g[x] = col[(x + 1) % w] - col[x];
    mean += g[x];
  }
  mean /= w;
  let norm = 0;
  for (let x = 0; x < w; x++) {
    g[x] -= mean;
    norm += g[x] * g[x];
  }
  norm = Math.sqrt(norm);
  if (norm > 1e-9) for (let x = 0; x < w; x++) g[x] /= norm;
  return g;
}

/**
 * How far `b` is `a` rotated: `b[i] ≈ a[i + shift]` (a positive shift: the
 * world slid left, the camera turned RIGHT), searched up to ±`max` columns,
 * to a fraction of a column. `score` is the match (1 = the same ring).
 */
export function ringShift(a: Float32Array, b: Float32Array, max: number): { shift: number; score: number } {
  const n = a.length;
  const at = (s: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += b[i] * a[(((i + s) % n) + n) % n];
    return sum;
  };
  let best = 0;
  let score = -Infinity;
  for (let s = -max; s <= max; s++) {
    const c = at(s);
    if (c > score) {
      score = c;
      best = s;
    }
  }
  // A parabola through the peak and its neighbours: the fraction of a column.
  const l = at(best - 1);
  const r = at(best + 1);
  const den = l - 2 * score + r;
  const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
  return { shift: best + frac, score };
}

/** A shift of `shift` columns (of `n`) over `dt` seconds of video → radians per second, + right. */
export const turnRate = (shift: number, n: number, dt: number) => (dt === 0 ? 0 : (shift / n) * 2 * Math.PI / dt);
