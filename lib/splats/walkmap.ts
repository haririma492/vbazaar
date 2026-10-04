/**
 * THE WALK MAP — where a visitor can walk in a splat, and what is in the way.
 *
 * A splat is only points; nothing says "wall" or "corridor". This reads them
 * as a plan, seen from above (operator, 2026-10-04):
 *
 *   1. The FLOOR is the densest layer of points below the eye. How far below
 *      it is gives the scene's scale: the eye is a person's 1.6 m up.
 *   2. Points between knee and head height are SOLID — walls, shop windows,
 *      pillars — and fill cells of a grid seen from above.
 *   3. What is left open is where the camera walked: that is where a visitor
 *      can go.
 *
 * From the grid, `depthAt` measures how far one can see-and-walk in a
 * direction, and `guide` turns that into help while walking:
 *
 *   • open ahead       walk; if the open way bends a little, the heading is
 *                      drawn gently along it — no fine steering needed
 *   • something ahead  slow down smoothly to a window-shopping pace by arm's
 *                      length — but never to a stop: what the plan calls a
 *                      wall may be a floater (see MIN_SPEED)
 *
 * Pure: points in (x, y, z triples, y up), plan and guidance out.
 */

export type WalkMap = {
  /** World x/z of cell (0, 0)'s corner, and the cell size, in scene units. */
  x0: number;
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 where something solid stands at body height. */
  solid: Uint8Array;
  /** Cells that hold any point at all: outside them is beyond the scene. */
  known: Uint8Array;
  floorY: number;
  eyeY: number;
  /** Scene units per metre, from the eye's height over the floor. */
  unitsPerMetre: number;
};

/** A person's eye height, which sets the scene's scale. */
export const EYE_HEIGHT_M = 1.6;
/** The band that counts as "in the way": knee to just over the head. */
const BAND_LOW_M = 0.5;
const BAND_HIGH_M = 2.0;
const CELL_M = 0.25;
const MAX_CELLS = 640;

/** The floor under `eyeY`: the most crowded height among the points nearest (on the ground) to `eye`. */
export function findFloor(points: Float32Array, eye: [number, number, number]): number | null {
  const n = points.length / 3;
  if (n < 100) return null;
  // The nearest tenth of the points, on the ground plan.
  const step = Math.max(1, Math.floor(n / 200_000));
  const near: Array<[number, number]> = [];
  for (let i = 0; i < n; i += step) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    near.push([Math.hypot(x - eye[0], z - eye[2]), y]);
  }
  near.sort((a, b) => a[0] - b[0]);
  const local = near.slice(0, Math.max(50, Math.floor(near.length * 0.1))).map((p) => p[1]).filter((y) => y < eye[1]);
  if (local.length < 30) return null;
  const lo = Math.min(...local);
  const span = eye[1] - lo;
  if (!(span > 0)) return null;
  const bins = new Array(80).fill(0);
  for (const y of local) bins[Math.min(79, Math.floor(((y - lo) / span) * 80))]++;
  // The floor is the crowded layer, not a stray point far below: the busiest bin.
  let best = 0;
  for (let i = 1; i < 80; i++) if (bins[i] > bins[best]) best = i;
  return lo + ((best + 0.5) / 80) * span;
}

/** Build the plan from the points. Null when no floor can be found (then nothing is guided). */
export function buildWalkMap(points: Float32Array, eye: [number, number, number]): WalkMap | null {
  const floorY = findFloor(points, eye);
  if (floorY == null) return null;
  const eyeH = eye[1] - floorY;
  if (!(eyeH > 1e-6)) return null;
  const upm = eyeH / EYE_HEIGHT_M;
  const lowY = floorY + BAND_LOW_M * upm;
  const highY = floorY + BAND_HIGH_M * upm;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const n = points.length / 3;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], z = points[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  let cell = CELL_M * upm;
  cell = Math.max(cell, (maxX - minX) / MAX_CELLS, (maxZ - minZ) / MAX_CELLS);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const counts = new Uint32Array(cols * rows);
  const known = new Uint8Array(cols * rows);
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    const c = Math.floor((x - minX) / cell), r = Math.floor((z - minZ) / cell);
    const k = r * cols + c;
    known[k] = 1;
    if (y >= lowY && y <= highY) counts[k]++;
  }
  // A few stray points are floaters, not a wall: a cell is solid when it is
  // crowded compared with the scene's busy cells.
  const busy = Array.from(counts).filter((v) => v > 0).sort((a, b) => a - b);
  const p90 = busy.length ? busy[Math.floor(busy.length * 0.9)] : 0;
  const threshold = Math.max(4, Math.round(p90 * 0.15));
  const solid = new Uint8Array(cols * rows);
  for (let k = 0; k < counts.length; k++) solid[k] = counts[k] >= threshold ? 1 : 0;
  return { x0: minX, z0: minZ, cell, cols, rows, solid, known, floorY, eyeY: eye[1], unitsPerMetre: upm };
}

function blocked(m: WalkMap, x: number, z: number): boolean {
  const c = Math.floor((x - m.x0) / m.cell), r = Math.floor((z - m.z0) / m.cell);
  if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return true; // the scene's edge
  return m.solid[r * m.cols + c] === 1;
}

/**
 * How far (scene units) one can go from (x, z) heading `heading` (radians;
 * 0 is −z, the camera's forward at yaw 0; + turns right) before something
 * solid, up to `max`.
 */
export function depthAt(m: WalkMap, x: number, z: number, heading: number, max = 12 * m.unitsPerMetre): number {
  const dx = Math.sin(heading), dz = -Math.cos(heading);
  const step = m.cell * 0.5;
  for (let d = step; d <= max; d += step) if (blocked(m, x + dx * d, z + dz * d)) return d - step;
  return max;
}

/** Slowest at this distance from what is ahead: arm's length. */
const STOP_M = 0.6;
/**
 * ⚠️ NEVER A STANDSTILL. The plan is read from a real scene's points, with
 * floaters, the inside of a shop seen through its glass and uneven ground in
 * them; read as walls they stopped visitors dead a few metres in (operator,
 * 2026-10-04). In front of what looks solid the walk slows to this share of
 * its speed — a window-shopping pace — and always goes on.
 */
export const MIN_SPEED = 0.35;
/** Start slowing this far before it: there is a shop window to look at. */
const SLOW_M = 2.5;
/** Look this far either side of the heading for the open way. */
const LOOK_DEG = 35;
/** How readily the heading is drawn along an open way (per second, of the angle to it). */
const PULL = 0.5; // gentle: the plan of a real scene is approximate

/**
 * Help for one moment of walking: how much of the asked speed to allow
 * (0 at arm's length from something, 1 in the open), and how much to turn
 * toward the open way (radians/second, + right).
 */
export function guide(m: WalkMap, x: number, z: number, heading: number): { speed: number; steer: number; ahead: number } {
  const upm = m.unitsPerMetre;
  const ahead = depthAt(m, x, z, heading);
  const stop = STOP_M * upm, slow = SLOW_M * upm;
  const t = ahead <= stop ? 0 : ahead >= slow ? 1 : (ahead - stop) / (slow - stop);
  const speed = MIN_SPEED + (1 - MIN_SPEED) * t;
  // The open way: the deepest direction near the heading, nearer ones preferred.
  let bestA = 0, bestScore = ahead;
  for (let deg = -LOOK_DEG; deg <= LOOK_DEG; deg += 5) {
    if (!deg) continue;
    const a = (deg * Math.PI) / 180;
    const score = depthAt(m, x, z, heading + a) * Math.cos(a) ** 2;
    if (score > bestScore) {
      bestScore = score;
      bestA = a;
    }
  }
  // Only lean when the open way is clearly more open than straight ahead.
  const steer = bestScore > ahead * 1.6 && bestScore > slow * 1.5 ? bestA * PULL : 0;
  return { speed, steer, ahead };
}
