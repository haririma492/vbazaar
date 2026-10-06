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
  // 0–3 s: outside, then through the doorway (the threshold is at z 4.6),
  // a glance at the Celadon wall on the right.
  { t: 0, eye: [0.32, 1.64, 7.6], look: [0.05, 1.9, 0] },
  { t: 3, eye: [0.05, 1.63, 4.3], look: [1.4, 1.35, 0.6] },
  // 3–7.5 s: past the sale post — the ginger jar speaks up, its tag rises.
  { t: 5.6, eye: [-0.15, 1.62, 3.0], look: [-1.15, 1.0, 1.85] },
  { t: 7.6, eye: [-0.12, 1.62, 1.55], look: [-0.5, 1.2, -1.4] },
  // 7.5–11 s: the wall fills the view; its labels appear.
  { t: 10.0, eye: [-0.06, 1.61, 0.15], look: [-0.05, 1.18, -2.25] },
  // 11–14 s: in to the teapot.
  { t: 13.4, eye: [0.14, 1.6, -0.78], look: [0.05, 1.28, -2.25] },
];

/**
 * The second leg: back out of the china store with the teapot in the basket,
 * along the mall to the jewellery store next door, in to the solitaire.
 */
export const MALL_KEYS: Key[] = [
  { t: 20.6, eye: [0.14, 1.6, -0.78], look: [0.05, 1.28, -2.25] },
  // Turn round (by the right) toward the door.
  { t: 21.9, eye: [0.2, 1.61, -0.25], look: [2.6, 1.45, -0.2] },
  { t: 23.2, eye: [0.22, 1.62, 1.1], look: [0.1, 1.55, 6.0] },
  // Out through the doorway, into the mall; look along it to the right.
  { t: 25.4, eye: [0.05, 1.63, 4.7], look: [3.0, 1.65, 9.0] },
  { t: 27.6, eye: [2.0, 1.64, 7.2], look: [7.6, 1.75, 7.0] },
  // The jewellery store's front: its sign, its windows.
  { t: 30.0, eye: [6.1, 1.64, 7.5], look: [7.5, 1.95, 4.6] },
  // In through its door, to the vitrine at the back.
  { t: 32.4, eye: [7.5, 1.63, 4.0], look: [7.5, 1.25, -1.2] },
  { t: 35.0, eye: [7.46, 1.6, 0.7], look: [7.5, 1.05, -1.25] },
  { t: 37.2, eye: [7.5, 1.34, -0.74], look: [7.5, 1.02, -1.22] },
];

/** The end of the first leg (the teapot). */
export const DURATION = KEYS[KEYS.length - 1].t;
/** The end of the whole walk. */
export const WALK_END = MALL_KEYS[MALL_KEYS.length - 1].t;

/** The walk in legs; between legs the shopper stands still. */
export const LEGS: Key[][] = [KEYS, MALL_KEYS];

export type Cue =
  | { t: number; kind: "select"; id: string }
  | { t: number; kind: "add" }
  | { t: number; kind: "checkout" }
  | { t: number; kind: "pay" }
  | { t: number; kind: "end" };

/** The demo's beats, in order: what a shopper does, done through the same calls a tap makes. */
export const CUE_LIST: Cue[] = [
  { t: 14.1, kind: "select", id: "teapot-01" },
  { t: 18.6, kind: "add" },
  { t: 37.8, kind: "select", id: "ring-01" },
  { t: 41.6, kind: "add" },
  { t: 43.4, kind: "checkout" },
  { t: 46.4, kind: "pay" },
  { t: 49.0, kind: "end" },
];

/** The first store's beats, kept by name (the tests and the captions read them). */
export const CUES = {
  select: 14.1,
  addToBasket: 18.6,
  end: 49.0,
} as const;

/** Which leg the camera is on at time t, and how far along it. */
export function legAt(t: number, legs: Key[][] = LEGS): { leg: number; u: number } {
  for (let i = legs.length - 1; i >= 0; i--) {
    if (t >= legs[i][0].t) return { leg: i, u: progressAt(t, legs[i]) };
  }
  return { leg: 0, u: 0 };
}

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
