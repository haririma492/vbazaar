/**
 * WALKING THE TOUR IN A HEADSET (`/vr`) — the arithmetic of moving about in
 * WebXR, for every brand of headset: Quest and Pico (thumbsticks, or hands),
 * Vision Pro (look and pinch, no stick at all), Vive / Index / WMR through
 * SteamVR (sticks or trackpads).
 *
 *   • THE STICK WALKS ALONG THE PATH: pushed forward, the visitor goes the
 *     path's way (the viewer's `guideStep`), as on the phone. Pushed sideways,
 *     the view SNAPS round a step — a smooth turn in a headset makes people
 *     sick, a snap does not.
 *   • POINT AND PINCH (or pull the trigger) at the blue path: the visitor is
 *     put there, at the filmed eye height. That is the whole of locomotion for
 *     a headset without sticks, and the quick way along for one with them.
 *   • A SHOP DOOR pointed at puts the visitor in front of it, facing in.
 *
 * Headings as everywhere in `lib/splats`: 0 faces −z, + turns right.
 *
 * Pure, and imports nothing (`node --test` runs it without a bundler).
 */

export type Vec3 = [number, number, number];

/** How far a snap turns (radians): 30°, the usual comfortable step. */
export const SNAP_TURN = Math.PI / 6;
/** A push past this fires one snap; the stick must come back under REARM before the next. */
export const SNAP_AT = 0.7;
export const REARM = 0.3;
/** Below this the stick is resting (sticks drift; trackpads are touched by accident). */
export const DEAD = 0.15;
/** Pointing within this of the path (scene units) still lands on it. */
export const TELEPORT_REACH = 1.5;
/** How far in front of a shop door the visitor is put. */
export const DOOR_GAP = 1.2;

export type StickState = { armed: boolean };
export const STICK_REST: StickState = { armed: true };

/**
 * One thumbstick (x right, y DOWN — the Gamepad convention, so forward is
 * −y): how fast to walk (−1 back … 1 forward, squared so a small push creeps)
 * and whether a snap turn fires now (−1 left, 1 right, 0 none).
 */
export function stickIntent(x: number, y: number, s: StickState): { forward: number; snap: -1 | 0 | 1; state: StickState } {
  const fy = Math.abs(y) < DEAD ? 0 : -y;
  const forward = Math.max(-1, Math.min(1, Math.sign(fy) * fy * fy));
  // A firm sideways push is a turn, not a walk: walking keeps going while it is held.
  if (s.armed && Math.abs(x) >= SNAP_AT && Math.abs(x) > Math.abs(y)) {
    return { forward, snap: x > 0 ? 1 : -1, state: { armed: false } };
  }
  if (!s.armed && Math.abs(x) < REARM) return { forward, snap: 0, state: { armed: true } };
  return { forward, snap: 0, state: s };
}

/**
 * Of the controller's axes, the ones that are its stick. `xr-standard`
 * gamepads put the thumbstick at 2–3 and a touchpad (Vive) at 0–1; a
 * controller with only two axes has them at 0–1.
 */
export function stickAxes(axes: readonly number[]): [number, number] {
  if (axes.length >= 4 && (Math.abs(axes[2]) > 0 || Math.abs(axes[3]) > 0)) return [axes[2], axes[3]];
  if (axes.length >= 2) return [axes[0], axes[1]];
  return [0, 0];
}

/** The point of a route nearest (x, z), with the route's height there: the filmed eye height. */
function nearest(route: Vec3[], x: number, z: number): { p: Vec3; dist: number } | null {
  if (route.length < 2) return null;
  let best: { p: Vec3; dist: number } | null = null;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay, az] = route[i];
    const [bx, by, bz] = route[i + 1];
    const vx = bx - ax, vz = bz - az;
    const len2 = vx * vx + vz * vz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2)) : 0;
    const p: Vec3 = [ax + vx * t, ay + (by - ay) * t, az + vz * t];
    const dist = Math.hypot(x - p[0], z - p[2]);
    if (!best || dist < best.dist) best = { p, dist };
  }
  return best;
}

/**
 * Where pointing at (x, z) puts the visitor: the nearest point of any route,
 * at its eye height — or null when nothing walkable is near what they point at.
 */
export function teleportOnto(routes: Vec3[][], x: number, z: number, reach = TELEPORT_REACH): Vec3 | null {
  let best: { p: Vec3; dist: number } | null = null;
  for (const r of routes) {
    const n = nearest(r, x, z);
    if (n && (!best || n.dist < best.dist)) best = n;
  }
  return best && best.dist <= reach ? best.p : null;
}

/**
 * In front of a shop door, seen from (x, z): DOOR_GAP short of it on the way
 * there, facing it. Standing on it already: at it, facing the way they came.
 */
export function standBefore(door: Vec3, x: number, z: number, gap = DOOR_GAP): { x: number; z: number; heading: number } {
  const dx = door[0] - x, dz = door[2] - z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x, z, heading: 0 };
  const heading = Math.atan2(dx, -dz);
  if (d <= gap) return { x, z, heading };
  return { x: door[0] - (dx / d) * gap, z: door[2] - (dz / d) * gap, heading };
}
