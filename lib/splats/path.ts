/**
 * THE CAMERAMAN'S ROUTE AS A TENDENCY — a banked road (operator, 2026-10-04).
 *
 * A road engineer banks a bend so that a car whose driver lets the wheel go
 * still follows the road; the driver can steer anywhere, but left alone the
 * car goes the road's way. Here the road is the route the cameraman walked
 * while filming: where the scene was seen best, from outside the shopping
 * centre to inside it. A visitor walking forward without steering is drawn
 * gently along it; any steering of their own wins.
 *
 *   • The pull aims at a point a little further along the route ("look
 *     ahead"), in whichever direction along it the visitor is facing — so
 *     it straightens them onto the route and carries them round its bends.
 *   • It is strongest on the route and fades away from it: someone who has
 *     wandered off on purpose is left alone.
 *
 * Pure: the route (scene units; x and z matter), where the visitor stands and
 * faces, and how strongly to turn back to it.
 */

export type Vec3 = [number, number, number];

/** How far ahead along the route the pull aims (scene units — the walk's own "metres"). */
export const LOOK_AHEAD = 2;
/** Full pull within this distance of the route, none beyond FADE_TO. */
export const FULL_WITHIN = 1.5;
export const FADE_TO = 6;
/** How quickly the heading turns toward the aim (per second, of the angle), and at most (rad/s). */
const GAIN = 1.2;
const MAX_TURN = 0.7;

/** Headings: 0 faces −z, + turns right (the viewer's convention). */
const dirOf = (h: number) => [Math.sin(h), -Math.cos(h)] as const;
const headingTo = (dx: number, dz: number) => Math.atan2(dx, -dz);
/** a − b, wrapped to (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** The point of the route nearest (x, z): which segment, how far along it (0–1), and how far away. */
export function nearestOnRoute(route: Vec3[], x: number, z: number): { seg: number; t: number; px: number; pz: number; dist: number } | null {
  if (route.length < 2) return null;
  let best = { seg: 0, t: 0, px: route[0][0], pz: route[0][2], dist: Infinity };
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, , az] = route[i];
    const [bx, , bz] = route[i + 1];
    const vx = bx - ax, vz = bz - az;
    const len2 = vx * vx + vz * vz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2)) : 0;
    const px = ax + vx * t, pz = az + vz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < best.dist) best = { seg: i, t, px, pz, dist };
  }
  return best;
}

/** Walk `d` along the route from (seg, t), forward (+1) or backward (−1); stops at its ends. */
function along(route: Vec3[], seg: number, t: number, d: number, dir: 1 | -1): [number, number] {
  let i = seg;
  let x = route[i][0] + (route[i + 1][0] - route[i][0]) * t;
  let z = route[i][2] + (route[i + 1][2] - route[i][2]) * t;
  let left = d;
  for (;;) {
    const next = dir > 0 ? route[i + 1] : route[i];
    const dx = next[0] - x, dz = next[2] - z;
    const L = Math.hypot(dx, dz);
    if (L >= left) return [x + (dx / (L || 1)) * left, z + (dz / (L || 1)) * left];
    left -= L;
    x = next[0];
    z = next[2];
    if (dir > 0 ? ++i >= route.length - 1 : --i < 0) return [x, z];
  }
}

/**
 * How fast to turn (rad/s, + right) so that someone at (x, z) facing
 * `heading` is drawn along the route. 0 off the route's reach, at its very
 * end, or when already on course.
 */
export function routePull(route: Vec3[], x: number, z: number, heading: number): number {
  const near = nearestOnRoute(route, x, z);
  if (!near || near.dist >= FADE_TO) return 0;
  const weight = near.dist <= FULL_WITHIN ? 1 : 1 - (near.dist - FULL_WITHIN) / (FADE_TO - FULL_WITHIN);
  // Which way along the route: the one the visitor already faces.
  const [ax, , az] = route[near.seg];
  const [bx, , bz] = route[near.seg + 1];
  const [hx, hz] = dirOf(heading);
  const dir: 1 | -1 = (bx - ax) * hx + (bz - az) * hz >= 0 ? 1 : -1;
  const [tx, tz] = along(route, near.seg, near.t, LOOK_AHEAD, dir);
  const dx = tx - x, dz = tz - z;
  if (Math.hypot(dx, dz) < 1e-6) return 0; // at the route's end: nowhere further to lead
  const off = angleDiff(headingTo(dx, dz), heading);
  // Facing well away from the route (more than a right angle off): the visitor means it.
  if (Math.abs(off) > Math.PI / 2) return 0;
  return Math.max(-MAX_TURN, Math.min(MAX_TURN, off * GAIN)) * weight;
}

/** Add a point to a route being recorded, if the walker has moved far enough from the last one. */
export function recordStep(route: Vec3[], p: Vec3, every = 0.5): Vec3[] {
  const last = route[route.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[2] - last[2]) < every) return route;
  return [...route, [p[0], p[1], p[2]]];
}

/**
 * GUIDED WALKING — the path does the steering (operator, 2026-10-04: walking
 * should not demand a steady, skilled hand). The visitor only says "go" or
 * "back"; which way that takes them is along the route — round its bends and
 * back onto it if they are beside it — whichever way along it they face.
 *
 * At a fork (two routes meeting at the alleys' junction) the route that runs
 * the way they face wins: facing the alley IS choosing it. Far from every
 * route (beyond FADE_TO) there is nothing to follow: null, walk straight.
 *
 * Returns the unit direction to move this step (x, z), and the heading
 * (path convention: 0 faces −z, + right) to turn the view toward.
 */
export function guideStep(routes: Vec3[][], x: number, z: number, heading: number): { dx: number; dz: number; aim: number; route: number } | null {
  const [hx, hz] = dirOf(heading);
  let best: { score: number; dx: number; dz: number; route: number } | null = null;
  routes.forEach((route, ri) => {
    const near = nearestOnRoute(route, x, z);
    if (!near || near.dist >= FADE_TO) return;
    const [ax, , az] = route[near.seg];
    const [bx, , bz] = route[near.seg + 1];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const along1 = ((bx - ax) * hx + (bz - az) * hz) / L;
    const dir: 1 | -1 = along1 >= 0 ? 1 : -1;
    const [tx, tz] = along(route, near.seg, near.t, LOOK_AHEAD, dir);
    let dx = tx - x, dz = tz - z;
    const D = Math.hypot(dx, dz);
    if (D < 1e-6) return; // at the route's end that way
    dx /= D;
    dz /= D;
    // How well this way along matches where they face, a little less for a route further off.
    const score = dx * hx + dz * hz - near.dist * 0.15;
    if (!best || score > best.score) best = { score, dx, dz, route: ri };
  });
  if (!best) return null;
  const b = best as { score: number; dx: number; dz: number; route: number };
  // Facing well away from every way along (more than a right angle): they mean it — walk straight.
  if (b.score < -0.2) return null;
  return { dx: b.dx, dz: b.dz, aim: headingTo(b.dx, b.dz), route: b.route };
}
