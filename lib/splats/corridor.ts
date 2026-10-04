/**
 * WALLS FROM THE CAMERAMAN'S ROUTE (operator, 2026-10-04).
 *
 * In a narrow alley of shops the visitor must not drift into a wall, up into
 * the ceiling or through a shop window, and must never get lost "inside" the
 * reconstruction. The splat itself cannot say where its walls are (guessing
 * them from its points was tried and stopped visitors dead — dropped). What
 * IS known is where the cameraman walked: that ground is open, by definition.
 *
 * So the walkable space is a LANE around the route: everything within
 * `half` of it (scene units, across). Walking is free inside; at its edge the
 * push outward is taken away and the rest kept — the visitor SLIDES along the
 * wall and is never stopped while walking down the alley. Looking round is
 * never limited: window shopping is turning to the glass, not walking into it.
 * The eye's height follows the route's, so there is no floor or ceiling to
 * fall through.
 *
 * A shop is entered on purpose only: a DOOR (placed in edit mode at the shop's
 * entrance) opens a short side lane into it when the visitor, standing near
 * and facing it, presses Enter (or taps «Go in»). Walking back out to the
 * alley closes it again.
 *
 * Pure. World coordinates throughout; x and z are the ground, y is up.
 */

export type Vec3 = [number, number, number];

/** A walkable lane: a route and how far either side of it one may stand. */
export type Lane = { route: Vec3[]; half: number };

/** A shop's door, as the tour keeps it: where its entrance is and how deep one may walk in. */
export type Door = { id: string; at: Vec3; depth: number };

/** A lane's half-width when the tour does not say (scene units, either side of the route). */
export const DEFAULT_HALF = 1.5;
/** How near a door (scene units) and how squarely faced (radians either side) for «Go in». */
export const DOOR_REACH = 3;
export const DOOR_FACING = (70 * Math.PI) / 180;

// `path.ts`'s nearestOnRoute, repeated with the height: `node --test` runs this
// file without a bundler, so it imports nothing.
function nearest(route: Vec3[], x: number, z: number): { px: number; py: number; pz: number; dist: number } | null {
  if (route.length < 2) return null;
  let best = { px: route[0][0], py: route[0][1], pz: route[0][2], dist: Infinity };
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay, az] = route[i];
    const [bx, by, bz] = route[i + 1];
    const vx = bx - ax, vz = bz - az;
    const len2 = vx * vx + vz * vz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2)) : 0;
    const px = ax + vx * t, pz = az + vz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < best.dist) best = { px, py: ay + (by - ay) * t, pz, dist };
  }
  return best;
}

/**
 * Where someone at (x, z) may stand: unchanged inside any lane; otherwise
 * brought back to the edge of the lane they are least outside (straight
 * across to it, so the part of a step along the wall is kept). `y` is the
 * route's height there — the eye height filmed — or null with no lane.
 * `outside`: how far beyond the edge they were (0 inside).
 */
export function keepInside(lanes: Lane[], x: number, z: number): { x: number; z: number; y: number | null; lane: number; outside: number } {
  let best: { lane: number; slack: number; n: NonNullable<ReturnType<typeof nearest>>; half: number } | null = null;
  lanes.forEach((l, i) => {
    const n = nearest(l.route, x, z);
    if (!n) return;
    const slack = n.dist - l.half;
    if (!best || slack < best.slack) best = { lane: i, slack, n, half: l.half };
  });
  if (!best) return { x, z, y: null, lane: -1, outside: 0 };
  const { lane, slack, n, half } = best as { lane: number; slack: number; n: NonNullable<ReturnType<typeof nearest>>; half: number };
  if (slack <= 0) return { x, z, y: n.py, lane, outside: 0 };
  const k = n.dist > 1e-9 ? half / n.dist : 0;
  return { x: n.px + (x - n.px) * k, z: n.pz + (z - n.pz) * k, y: n.py, lane, outside: slack };
}

/**
 * The side lane into a shop: from the nearest point of the alley's route,
 * through the door, `depth` on inside. Narrower than the alley — a doorway.
 */
export function doorLane(routes: Vec3[][], door: Door, half: number): Lane {
  let base: Vec3 = door.at;
  let bestDist = Infinity;
  for (const r of routes) {
    const n = nearest(r, door.at[0], door.at[2]);
    if (n && n.dist < bestDist) {
      bestDist = n.dist;
      base = [n.px, n.py, n.pz];
    }
  }
  const dx = door.at[0] - base[0], dz = door.at[2] - base[2];
  const L = Math.hypot(dx, dz) || 1;
  const inside: Vec3 = [door.at[0] + (dx / L) * door.depth, base[1], door.at[2] + (dz / L) * door.depth];
  return { route: [base, [door.at[0], base[1], door.at[2]], inside], half: Math.max(0.3, half * 0.6) };
}

/**
 * Is (x, z), facing `heading` (0 faces −z, + turns right), near enough to the
 * point `at` and turned toward it to go in? Distance when so, else null.
 */
export function inReach(at: Vec3, x: number, z: number, heading: number, reach = DOOR_REACH): number | null {
  const dx = at[0] - x, dz = at[2] - z;
  const d = Math.hypot(dx, dz);
  if (d > reach) return null;
  if (d < 0.3) return d; // standing in it
  let off = (Math.atan2(dx, -dz) - heading) % (2 * Math.PI);
  if (off > Math.PI) off -= 2 * Math.PI;
  if (off <= -Math.PI) off += 2 * Math.PI;
  return Math.abs(off) <= DOOR_FACING ? d : null;
}
