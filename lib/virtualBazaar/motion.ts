/**
 * HOW THE VIRTUAL BAZAAR'S CAMERA MOVES — the arithmetic, apart from Three.js
 * so it can be tested without a browser.
 */

/** Smooth start and stop; 0 → 0, 1 → 1. */
export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** The signed turn, in (−π, π], that takes angle `from` to angle `to`. */
export function shortestAngleDelta(from: number, to: number): number {
  const d = (((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return d === -Math.PI ? Math.PI : d;
}

/**
 * ⚠️ THE SHORT WAY ROUND. A plain lerp from 170° to −170° swings the camera
 * through 340°, spinning a visitor all the way round to turn 20°.
 */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDelta(from, to) * t;
}

export const PITCH_LIMIT = 1.2;
export const clampPitch = (p: number) => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));

/**
 * ⚠️ A TAP IS A SHORT PRESS THAT HARDLY MOVES. Selecting on `pointerdown`
 * fires at the start of every look-drag and every pinch.
 */
export const TAP_MAX_MOVE_PX = 8;
export const TAP_MAX_MS = 500;

export function isTap(movedPx: number, heldMs: number): boolean {
  return movedPx <= TAP_MAX_MOVE_PX && heldMs <= TAP_MAX_MS;
}

/**
 * How much a drag turns the view: radians per CSS pixel. ⚠️ THE VIEW FOLLOWS
 * THE FINGER (operator, 2026-09-27: "finger moves left → camera looks left").
 * That is the opposite of Street View's "grab the world", and it is what the
 * signs below assume.
 */
export const LOOK_PER_PX = 0.005;

export function lookFromDrag(
  yaw: number,
  pitch: number,
  dxPx: number,
  dyPx: number,
): { yaw: number; pitch: number } {
  // Yaw grows turning left, so a finger moving left (dx < 0) adds to it.
  // Pitch grows looking up, so a finger moving up (dy < 0) adds to it.
  return { yaw: yaw - dxPx * LOOK_PER_PX, pitch: clampPitch(pitch - dyPx * LOOK_PER_PX) };
}

/** Pinch and wheel zoom, as a magnification of the base field of view. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;
export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/**
 * The vertical field of view for a screen of this shape.
 *
 * ⚠️ A PORTRAIT PHONE NEEDS A TALLER ANGLE. Three.js fixes the VERTICAL angle,
 * so at 60° a 390 × 844 screen sees about 30° across — a keyhole into the
 * square. The horizontal angle is held at no less than `minHorizontal`, the
 * vertical one widening to make up, up to `maxVertical`.
 */
export function verticalFov(
  aspect: number,
  zoom = 1,
  { baseVertical = 60, minHorizontal = 75, maxVertical = 100 } = {},
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (r: number) => (r * 180) / Math.PI;
  const forHorizontal = deg(2 * Math.atan(Math.tan(rad(minHorizontal) / 2) / aspect));
  const base = Math.min(maxVertical, Math.max(baseVertical, forHorizontal));
  // Zooming narrows the angle through its tangent, like a lens.
  return deg(2 * Math.atan(Math.tan(rad(base) / 2) / clampZoom(zoom)));
}

/** Seconds for a flight of this length: quick when short, never a slog. */
export function flightSeconds(metres: number, reducedMotion = false): number {
  if (reducedMotion) return 0;
  return Math.max(0.7, Math.min(3.2, metres / 7));
}

export type P2 = { x: number; z: number };

export function pathLength(points: P2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

/** The point `distance` metres along a polyline (clamped to its ends). */
export function pointAlong(points: P2[], distance: number): P2 {
  if (points.length === 0) return { x: 0, z: 0 };
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= seg) {
      const t = seg === 0 ? 1 : left / seg;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= seg;
  }
  return points[points.length - 1];
}
