// THE INVESTOR WALK — the scripted 20-second demo as data and timing.
//
// The camera passes through keyframes: a position and a point it looks at,
// each at a time. Between them the renderer draws a Catmull-Rom spline (one
// for the eye, one for the look point) and this module says how far along it
// the shopper is at any second — a monotone curve through the keyframe
// times, so the walk eases out of the doorway, never stops dead between
// keys, never overshoots a key and walks back, and settles at the end.
//
// Cues are the moments the demo acts *as a shopper would*: it selects the
// teapot and presses «Add to basket» through the same calls a click makes.
//
// Import-free so `npm test` runs it directly.

export type Key = { t: number; eye: [number, number, number]; look: [number, number, number] };

export const KEYS: Key[] = [
  // 0–3 s: outside, then through the doorway (the threshold is at z 4.6).
  { t: 0, eye: [0.32, 1.64, 7.6], look: [0.05, 1.9, 0] },
  { t: 3, eye: [0.05, 1.63, 4.3], look: [-0.25, 1.38, 0] },
  // 3–7 s: past the plinth — its labels come and go — toward the wall.
  { t: 6.2, eye: [-0.12, 1.62, 2.1], look: [-0.45, 1.2, -1.2] },
  // 7–11 s: the wall fills the view; its labels appear.
  { t: 9.6, eye: [-0.06, 1.61, 0.15], look: [-0.05, 1.18, -2.25] },
  // 11–14 s: in to the teapot.
  { t: 13.2, eye: [0.14, 1.6, -0.78], look: [0.05, 1.28, -2.25] },
];

export const CUES = {
  /** The hero's highlight is up by now (it begins as it becomes selectable). */
  select: 13.9,
  /** «Add to basket» pressed. */
  addToBasket: 18.4,
  /** The demo has said what it came to say. */
  end: 20.5,
} as const;

export const DURATION = KEYS[KEYS.length - 1].t;

/**
 * Progress u ∈ [0, 1] along the splines at time t: u passes key i at
 * i / (n − 1) exactly at KEYS[i].t. Monotone cubic Hermite (Fritsch–Carlson)
 * with zero speed at both ends.
 */
export function progressAt(t: number, keys: Key[] = KEYS): number {
  const n = keys.length;
  if (t <= keys[0].t) return 0;
  if (t >= keys[n - 1].t) return 1;
  const xs = keys.map((k) => k.t);
  const ys = keys.map((_, i) => i / (n - 1));
  const slopes = tangents(xs, ys);
  let i = 0;
  while (i < n - 2 && t > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const s = (t - xs[i]) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
  const h10 = s ** 3 - 2 * s ** 2 + s;
  const h01 = -2 * s ** 3 + 3 * s ** 2;
  const h11 = s ** 3 - s ** 2;
  return h00 * ys[i] + h10 * h * slopes[i] + h01 * ys[i + 1] + h11 * h * slopes[i + 1];
}

function tangents(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      // Weighted harmonic mean: keeps the curve monotone between keys.
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  // Ends start and finish at rest.
  m[0] = 0;
  m[n - 1] = 0;
  return m;
}
