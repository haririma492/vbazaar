/**
 * A REPLACED SIGN'S GEOMETRY (founder, 2026-10-08: store signs in a filmed
 * bazaar must look BRAND NEW — "really big for commercialization").
 *
 * The operator clicks the four corners of the old signboard in the viewer's
 * edit mode (`SplatTour.tsx`, «Replace a sign»), in any order; the new image
 * is drawn over that quad and the old splats there hidden. This file is the
 * arithmetic: which corner is which as seen from the street, the sign's own
 * frame (right, up, out toward the street), the plane a missed click falls
 * back to, and the box of old splats that is hidden.
 *
 * All in the scene's own coordinates (upright: +y is up). Pure.
 */

export type Vec3 = [number, number, number];
export type Corners = [Vec3, Vec3, Vec3, Vec3];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 | null => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : null;
};
const centroid = (ps: Vec3[]): Vec3 => mul(ps.reduce(add, [0, 0, 0] as Vec3), 1 / ps.length);

/**
 * The plane through some points (Newell's normal: the best fit for a
 * polygon, steady when the points are not quite flat). Null for fewer than
 * three, or points in a line.
 */
export function planeOf(points: Vec3[]): { point: Vec3; normal: Vec3 } | null {
  if (points.length < 3) return null;
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  const normal = unit(n);
  return normal ? { point: centroid(points), normal } : null;
}

/** Where a ray (origin, direction) meets a plane, ahead of the origin; null when it does not. */
export function rayPlane(origin: Vec3, dir: Vec3, plane: { point: Vec3; normal: Vec3 }): Vec3 | null {
  const d = dot(dir, plane.normal);
  if (Math.abs(d) < 1e-9) return null;
  const t = dot(sub(plane.point, origin), plane.normal) / d;
  return t > 0 ? add(origin, mul(dir, t)) : null;
}

/** The sign's own frame: across (right), up its face, and out of it toward the street. */
function frameAxes(points: Vec3[], eye: Vec3): { right: Vec3; up: Vec3; out: Vec3; center: Vec3 } | null {
  // Four points clicked in any order are no polygon (Newell's normal of a
  // bow-tie cancels out): of the three ways to pair them into two segments,
  // the diagonals cross the most.
  let best: Vec3 = [0, 0, 0];
  for (const [a, b, c, d] of [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]) {
    const n = cross(sub(points[b], points[a]), sub(points[d], points[c]));
    if (len(n) > len(best)) best = n;
  }
  const normal = unit(best);
  if (!normal) return null;
  const p = { point: centroid(points), normal };
  const out = dot(sub(eye, p.point), p.normal) >= 0 ? p.normal : mul(p.normal, -1);
  // "Up" is the world's up laid onto the sign; a sign flat on the ground (a
  // floor mat) takes the direction away from the eye instead.
  const world: Vec3 = [0, 1, 0];
  let up = unit(sub(world, mul(out, dot(world, out))));
  if (!up || Math.abs(dot(world, out)) > 0.95) {
    const away = sub(p.point, eye);
    up = unit(sub(away, mul(out, dot(away, out)))) ?? [0, 0, -1];
  }
  const right = cross(up, out);
  return { right, up, out, center: p.point };
}

/**
 * Four corners clicked in any order → top-left, top-right, bottom-right,
 * bottom-left as seen from `eye` (where the operator stood). Null when they
 * span no area.
 */
export function orderCorners(points: Vec3[], eye: Vec3): Corners | null {
  if (points.length !== 4) return null;
  const f = frameAxes(points, eye);
  if (!f) return null;
  const flat = points.map((p) => ({ p, x: dot(sub(p, f.center), f.right), y: dot(sub(p, f.center), f.up) }));
  // Round the centre, starting from the top-left: a convex quad in any order comes out right.
  const ang = (q: { x: number; y: number }) => Math.atan2(q.y, q.x);
  const sorted = [...flat].sort((a, b) => ang(b) - ang(a)); // clockwise from the left (π) round
  // Start at the one most up-and-left.
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].y - sorted[i].x > sorted[start].y - sorted[start].x) start = i;
  const ring = [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]);
  // Clockwise as seen from the front: top-left → top-right → bottom-right → bottom-left.
  const out = ring.map((q) => q.p) as Corners;
  const area = len(cross(sub(out[2], out[0]), sub(out[3], out[1])));
  return area > 1e-6 ? out : null;
}

/**
 * The frame of a stored sign (corners top-left, top-right, bottom-right,
 * bottom-left): its centre, unit axes (`out` toward the street), and its
 * width and height (the average of opposite edges).
 */
export function signFrame(c: Corners): { center: Vec3; right: Vec3; up: Vec3; out: Vec3; width: number; height: number } | null {
  const [tl, tr, br, bl] = c;
  const right = unit(add(sub(tr, tl), sub(br, bl)));
  const up0 = unit(add(sub(tl, bl), sub(tr, br)));
  if (!right || !up0) return null;
  const out = unit(cross(right, up0));
  if (!out) return null;
  const up = cross(out, right);
  return {
    center: centroid(c),
    right, up, out,
    width: (len(sub(tr, tl)) + len(sub(br, bl))) / 2,
    height: (len(sub(tl, bl)) + len(sub(tr, br))) / 2,
  };
}

/** The corners moved out from the centre of the face by `by` along its right and up (the opaque backing). */
export function grow(c: Corners, by: number): Corners {
  const f = signFrame(c);
  if (!f) return c;
  const s: Array<[number, number]> = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
  return c.map((p, i) => add(p, add(mul(f.right, s[i][0] * by), mul(f.up, s[i][1] * by)))) as Corners;
}

/** How far toward the street the image and its backing sit off the old board, so they never merge with it. */
export const IMAGE_LIFT = 0.02;
export const BACKING_LIFT = 0.012;
/** Old splats hidden from this far in front of the board … */
export const HIDE_FRONT = 0.05;
/** … to this far behind it. */
export const HIDE_BACK = 0.2;

/**
 * The box of old splats to hide: centre, axes (the sign's frame) and half
 * sizes — the board and its backing, a little round them, from just in front
 * of the old board (its fuzz, which would show through) to behind it.
 */
export function hideBox(c: Corners, cover: number): { center: Vec3; right: Vec3; up: Vec3; out: Vec3; half: Vec3 } | null {
  const f = signFrame(c);
  if (!f) return null;
  const margin = cover + 0.02;
  const mid = (HIDE_FRONT - HIDE_BACK) / 2;
  return {
    center: add(f.center, mul(f.out, mid)),
    right: f.right, up: f.up, out: f.out,
    half: [f.width / 2 + margin, f.height / 2 + margin, (HIDE_FRONT + HIDE_BACK) / 2],
  };
}

/** Lifted toward the street by `by`. */
export const lift = (c: Corners, by: number): Corners => {
  const f = signFrame(c);
  return f ? (c.map((p) => add(p, mul(f.out, by))) as Corners) : c;
};

/** How bright the image is drawn: a little under full (it sits in a filmed, shaded street), up to lit at glow 1. */
export const glowGain = (glow: number) => 0.86 + 0.34 * Math.min(1, Math.max(0, glow));
