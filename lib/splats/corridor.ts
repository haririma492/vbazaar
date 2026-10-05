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

/** How far apart two joined scenes' routes may end and still be bridged (scene units). */
export const BRIDGE_MAX = 12;

/**
 * BRIDGES BETWEEN JOINED SCENES' ROUTES. The cameraman's walk outside and
 * his walk inside were recorded separately: once the scenes are aligned, the
 * one's end and the other's start rarely touch — a gap of a few steps, and the
 * walls (and «Follow the path») would stop the visitor dead at the entrance.
 * Each route's END is joined by a straight lane to the nearest point of every
 * other route within BRIDGE_MAX: the walk goes on across the gap.
 */
export function bridges(lanes: Lane[], max = BRIDGE_MAX): Lane[] {
  const out: Lane[] = [];
  lanes.forEach((a, i) => {
    if (a.route.length < 2) return;
    for (const end of [a.route[0], a.route[a.route.length - 1]]) {
      lanes.forEach((b, j) => {
        if (i === j || b.route.length < 2) return;
        const n = nearest(b.route, end[0], end[2]);
        if (!n || n.dist < 0.2 || n.dist > max) return;
        const half = Math.max(a.half, b.half) || DEFAULT_HALF;
        out.push({ route: [end, [n.px, n.py, n.pz]], half });
      });
    }
  });
  return out;
}

/** Distance from (x, z) to the segment a–b on the ground. */
function segDist(a: Vec3, b: Vec3, x: number, z: number): number {
  const vx = b[0] - a[0], vz = b[2] - a[2];
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[2]) * vz) / len2)) : 0;
  return Math.hypot(x - (a[0] + vx * t), z - (a[2] + vz * t));
}
const nearRoute = (r: Vec3[], p: Vec3, tol: number, upTo = r.length - 1) => {
  for (let i = 0; i < Math.min(upTo, r.length - 1); i++) if (segDist(r[i], r[i + 1], p[0], p[2]) <= tol) return true;
  return false;
};

/**
 * ONE LINE WHERE ONE WAS WALKED (operator, 2026-10-05: "double blue line…
 * it is going to turn around from the middle and return"). A cameraman films
 * an alley walking in AND back out, and the next scene's walk begins where
 * the last one ended — so recorded routes retrace themselves and each other.
 * Walking back needs no second line (the path is followed either way), so:
 *   • a route is cut where it starts going back over itself;
 *   • a later route's beginning and end that run over an earlier route are
 *     dropped (the bridges then join what is left).
 * `tol`: how near counts as "over" (scene units). Routes in a stable order.
 */
export function untangle(routes: Vec3[][], tol = 0.5): Vec3[][] {
  const RUN = 3; // points in a row: one crossing is not a retrace
  const cut = routes.map((r) => {
    for (let i = 2; i + RUN <= r.length; i++) {
      let back = true;
      for (let k = 0; k < RUN && back; k++) back = nearRoute(r, r[i + k], tol, i - 1);
      if (back) return r.slice(0, i);
    }
    return r;
  });
  return cut.map((r, j) => {
    const earlier = cut.slice(0, j).filter((e) => e.length > 1);
    if (!earlier.length || r.length < 2) return r;
    const over = (p: Vec3) => earlier.some((e) => nearRoute(e, p, tol));
    let a = 0, b = r.length;
    while (a < b && over(r[a])) a++;
    while (b > a && over(r[b - 1])) b--;
    // Keep one point on the shared ground at each trimmed end, so it still meets the earlier route.
    return r.slice(Math.max(0, a - 1), Math.min(r.length, b + 1));
  });
}

/**
 * THE SEAM BETWEEN TWO JOINED SCENES (operator, 2026-10-05: "the circle area
 * around the entrance … got corrupted"). Both films saw the entrance; joined,
 * the two reconstructions of it overlap and blur each other. Where one
 * scene's route ends near where the next one's begins, a seam crosses the
 * walk there: the first scene is shown up to it, the next from it on.
 * `dir`: the way the walk goes through the seam (unit, on the ground).
 */
export function seams(routes: Array<{ id: string; route: Vec3[] }>, max = BRIDGE_MAX): Array<{ from: string; to: string; at: Vec3; dir: [number, number] }> {
  const out: Array<{ from: string; to: string; at: Vec3; dir: [number, number] }> = [];
  for (const a of routes) {
    if (a.route.length < 2) continue;
    const end = a.route[a.route.length - 1];
    // The way the walk arrives: over the last unit or so.
    let k = a.route.length - 2;
    while (k > 0 && Math.hypot(end[0] - a.route[k][0], end[2] - a.route[k][2]) < 1) k--;
    const dx = end[0] - a.route[k][0], dz = end[2] - a.route[k][2];
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    for (const b of routes) {
      if (b === a || b.route.length < 2) continue;
      const start = b.route[0];
      if (Math.hypot(start[0] - end[0], start[2] - end[2]) > max) continue;
      out.push({ from: a.id, to: b.id, at: [(end[0] + start[0]) / 2, (end[1] + start[1]) / 2, (end[2] + start[2]) / 2], dir: [dx / L, dz / L] });
    }
  }
  return out;
}
