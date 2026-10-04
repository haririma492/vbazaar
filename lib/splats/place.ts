/**
 * WHERE A SCENE SITS IN THE TOUR'S ONE WORLD (operator, 2026-10-04).
 *
 * Every Splatica reconstruction comes in its own coordinates — its own origin,
 * its own "north", its own size. To walk from the entrance scene straight into
 * the alley scene with no jump, the alley is PLACED into the entrance's world:
 * moved, turned about the vertical and scaled until the junction both filmed
 * lies on itself. The operator does that by eye in the viewer's edit mode
 * (Align); the result is a `Place`.
 *
 * A scene's own data (its cameras' route) is in its own coordinates, "local";
 * what the visitor walks in, and what edit mode records (start pose, exits),
 * is the world. `toWorld` / `toLocal` go between them, exactly as three.js
 * places the splat: scale, then turn about y, then move.
 *
 * Pure.
 */

export type Vec3 = [number, number, number];
export type Place = { offset: Vec3; yaw: number; scale: number };

export const IDENTITY: Place = { offset: [0, 0, 0], yaw: 0, scale: 1 };

/** A point in the scene's own coordinates → the world. */
export function toWorld(p: Place, v: Vec3): Vec3 {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const x = v[0] * p.scale, y = v[1] * p.scale, z = v[2] * p.scale;
  return [p.offset[0] + x * c + z * s, p.offset[1] + y, p.offset[2] - x * s + z * c];
}

/** A world point → the scene's own coordinates. */
export function toLocal(p: Place, v: Vec3): Vec3 {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const x = v[0] - p.offset[0], y = v[1] - p.offset[1], z = v[2] - p.offset[2];
  const k = 1 / (p.scale || 1);
  return [(x * c - z * s) * k, y * k, (x * s + z * c) * k];
}

/** A place as read from the tour: sane numbers, a positive scale, or null for "not placed". */
export function parsePlace(v: unknown): Place | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const off = Array.isArray(o.offset) ? o.offset : [];
  const scale = n(o.scale, 1);
  return {
    offset: [n(off[0], 0), n(off[1], 0), n(off[2], 0)],
    yaw: n(o.yaw, 0),
    scale: scale > 1e-3 && scale < 1e3 ? scale : 1,
  };
}

/**
 * One nudge of the Align tool: move along the world's axes, turn (radians),
 * or grow/shrink by a factor — about the point the operator is looking at
 * (`pivot`, world), so the junction stays under their eyes while they adjust.
 */
export function nudge(p: Place, by: { move?: Vec3; turn?: number; grow?: number }, pivot: Vec3): Place {
  let next: Place = { offset: [...p.offset] as Vec3, yaw: p.yaw, scale: p.scale };
  if (by.move) next.offset = [next.offset[0] + by.move[0], next.offset[1] + by.move[1], next.offset[2] + by.move[2]];
  if (by.turn || by.grow) {
    // Keep the scene point under the pivot where it is.
    const local = toLocal(next, pivot);
    next = { ...next, yaw: next.yaw + (by.turn ?? 0), scale: next.scale * (by.grow ?? 1) };
    const moved = toWorld(next, local);
    next.offset = [next.offset[0] + pivot[0] - moved[0], next.offset[1] + pivot[1] - moved[1], next.offset[2] + pivot[2] - moved[2]];
  }
  return next;
}

/** The heading (0 faces −z, + turns right) from a to b on the ground. */
const headingOf = (a: Vec3, b: Vec3) => Math.atan2(b[0] - a[0], -(b[2] - a[2]));

/** The way a route sets off from its start, or arrives at its end: over its first / last `over` units. */
function routeHeading(route: Vec3[], atEnd: boolean, over = 1): number | null {
  if (route.length < 2) return null;
  const pts = atEnd ? [...route].reverse() : route;
  const from = pts[0];
  for (const p of pts.slice(1)) {
    if (Math.hypot(p[0] - from[0], p[2] - from[2]) >= over) return atEnd ? headingOf(p, from) : headingOf(from, p);
  }
  const last = pts[pts.length - 1];
  return atEnd ? headingOf(last, from) : headingOf(from, last);
}

/**
 * AUTO-JOIN: a place for the next scene that puts the start of its route
 * (its own coordinates) on the end of this scene's route (the world's), set
 * off the way this one arrives — the cameraman walked on from where he
 * stopped. A first guess for Align; the operator fine-tunes it by eye.
 * Null when either route is missing.
 */
export function joinAtEnd(endRoute: Vec3[], nextRoute: Vec3[], scale = 1): Place | null {
  const arrive = routeHeading(endRoute, true);
  const leave = routeHeading(nextRoute, false);
  if (arrive == null || leave == null) return null;
  // Turning by `yaw` takes a heading h to h − yaw.
  const yaw = leave - arrive;
  const p0: Place = { offset: [0, 0, 0], yaw, scale };
  const at = toWorld(p0, nextRoute[0]);
  const end = endRoute[endRoute.length - 1];
  return { offset: [end[0] - at[0], end[1] - at[1], end[2] - at[2]], yaw, scale };
}
