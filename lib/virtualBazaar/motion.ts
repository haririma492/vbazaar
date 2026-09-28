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
/**
 * ⚠️ A FINGER SLIDES MORE THAN A MOUSE. On a phone a deliberate tap often
 * travels 8–12 px between down and up; at a mouse's 8 it would read as a
 * drag and do nothing (operator, 2026-09-27: "the click on screen … stopped
 * working").
 */
export const TAP_MAX_MOVE_PX_TOUCH = 12;
export const TAP_MAX_MS = 500;

export const tapSlop = (pointerType: string) => (pointerType === "mouse" ? TAP_MAX_MOVE_PX : TAP_MAX_MOVE_PX_TOUCH);

export function isTap(movedPx: number, heldMs: number, slopPx = TAP_MAX_MOVE_PX): boolean {
  return movedPx <= slopPx && heldMs <= TAP_MAX_MS;
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

/**
 * WALKING WITH THE KEYS: a stroll, and it eases in.
 *
 * ⚠️ 1.6 m/s, NOT 3.6 (operator, 2026-09-27: one press "moves a lot ahead and
 * we miss the store"). A shop front is six metres; at 3.6 m/s from the first
 * instant, the time it takes to lift a finger was already most of one. Shift
 * walks fast for crossing the square.
 */
export const STROLL_SPEED = 1.6;
export const HURRY_SPEED = 4;
export const WALK_EASE_IN_S = 0.35;
/** A press shorter than this is a step, not a walk. */
export const STEP_PRESS_S = 0.22;
/** A step in the open square. */
export const SQUARE_STEP_M = 1.2;
/** Gliding from one window-shopping stop to the next. */
export const STOP_GLIDE_SPEED = 2.2;

export function walkSpeed(heldS: number, hurry: boolean): number {
  const top = hurry ? HURRY_SPEED : STROLL_SPEED;
  return top * easeInOutCubic(Math.min(1, heldS / WALK_EASE_IN_S));
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

// ---------------------------------------------------------------------------
// Head and body, when the phone looks round

/**
 * ⚠️ TURN THE PHONE PAST 10° AND THE BODY TURNS THAT WAY (operator,
 * 2026-09-28: "when on mobile we tilt more than 10 degrees to one side, that
 * means the body should move to that side — we don't need to pause there …
 * every time we need to return the mobile back to check if the body-move has
 * applied — annoying"). "Tilt to one side" is turning the phone left or
 * right, its heading — not rolling it like a steering wheel (tried that on
 * 2026-09-28 first; wrong).
 *
 * The phone's turn from the body (`neck`) does two things at once:
 *   - within `LOOK_FREE` it is the head: the view follows the phone
 *     one-for-one, so a small look stays a small look;
 *   - past it, the head stays at the edge of that and the BODY turns that
 *     way — visibly, at once, faster the further past — for as long as the
 *     phone is held there. Bring the phone back within 10° and the turn
 *     stops, facing wherever it took you.
 *
 * ⚠️ WHAT THIS GIVES UP: someone who stands up and turns round for real
 * keeps turning — the phone cannot tell that from being held turned. A swipe
 * still turns the body too.
 *
 * (History, all 2026-09-27/28: the body followed a held look after 0.7 s;
 * then followed continuously but only showed once the phone came back to
 * rest; then was steered by a sideways roll. Each was a turn you had to
 * wait for, check for, or learn.)
 */
const d2r = (d: number) => (d * Math.PI) / 180;

/**
 * ⚠️ 12°, NOT 10°, AND A GENTLE START (operator, 2026-09-28: the body moved
 * "too early, before the turn is 10 degrees" and "too fast"). A hand holding
 * a phone wanders a few degrees without meaning to; at exactly 10° with a
 * straight-line start, that wander was already a turn. The turn begins past
 * `LOOK_FREE` and its speed rises as the square of the way past it — barely
 * moving at first, full speed only a good way further round.
 */
export const LOOK_FREE = d2r(12);
/** How far past `LOOK_FREE` the phone must be for full speed. */
export const BODY_TURN_RAMP = d2r(25);
/** The fastest the body turns, however far the phone is turned (was 90°/s). */
export const BODY_TURN_MAX = d2r(45);

/**
 * How fast the body turns (rad/s, positive = left) with the phone `neck` from
 * it: nothing within 12°, then (past/25°)² of 45°/s — about 2°/s at 17°,
 * 16°/s at 27°, 45°/s from 37° on.
 */
export function bodyTurnRate(neck: number): number {
  const past = Math.abs(neck) - LOOK_FREE;
  if (past <= 0) return 0;
  const k = Math.min(1, past / BODY_TURN_RAMP);
  return Math.sign(neck) * BODY_TURN_MAX * k * k;
}

/**
 * ⚠️ "STRAIGHT AHEAD" IS WHERE THE VISITOR HOLDS THE PHONE, NOT WHERE IT
 * POINTED WHEN THE SENSOR WOKE (operator, 2026-09-28: "only out of control
 * when we move right; when turning left, moving too late"). The reference was
 * fixed at the first reading: held a little off to one side then — or with
 * the sensor's usual slow drift since — every turn one way came early and
 * the other way late. So while the phone rests inside the look zone, the
 * reference slides towards it (τ `RECENTRE_TAU_S`), and the body turns under
 * the head by the same amount so the picture does not move. Past the zone —
 * turning — it does not slide, so a turn is never eaten.
 *
 * Returns how far to move the reference (and the body) this frame.
 */
export const RECENTRE_TAU_S = 2;
export function recentreStep(neck: number, dt: number): number {
  if (Math.abs(neck) >= LOOK_FREE) return 0;
  return neck * (1 - Math.exp(-dt / RECENTRE_TAU_S));
}

/** Eases the body's turning speed towards `target` (no jolt when it starts or stops). */
export function easeTurnRate(current: number, target: number, dt: number, tauS = 0.2): number {
  return current + (target - current) * (1 - Math.exp(-dt / tauS));
}

/** How much of the phone's turn the view shows as a head turn: all of it, up to 10°. */
export function headLook(neck: number): number {
  return Math.max(-LOOK_FREE, Math.min(LOOK_FREE, neck));
}

// ---------------------------------------------------------------------------
// Walking arrows

/**
 * STREET VIEW'S ARROWS ON THE FLOOR (operator, 2026-09-28: "for walking
 * forward, sideways and even backward, provide a clear arrow in front so the
 * user clicks and moves in that direction").
 *
 * ⚠️ ALL FOUR IN FRONT, THE BACK ONE TOO. An arrow behind you cannot be
 * tapped, so the four sit in a cross on the floor ahead — forward at its far
 * end, back at its near end pointing at you, left and right either side.
 *
 * ⚠️ FAR ENOUGH AHEAD TO BE ON SCREEN. From eye height (1.7 m) with a
 * desktop's 60° view, the floor only comes into the picture about 3 m ahead;
 * nearer, the arrows would be under the bottom edge.
 */
export type ArrowDir = "fwd" | "back" | "left" | "right";
export const ARROW_DIRS: ArrowDir[] = ["fwd", "back", "left", "right"];
export const ARROW_AHEAD_M = 4.6;
/** Forward and back arrows either side of the cross's centre (was 0.8 m). */
const ARROW_SPREAD_M = 1.25;
/** Left and right arrows either side of it (was 1.3 m). */
const ARROW_SIDE_M = 2.0;
/** How far one tap on an arrow takes you (in the open square). */
export const ARROW_STEP_M = 2.5;
/** A sidestep (operator, 2026-09-28: "the side arrows make very small distance … make it bigger"; was 1.5 m). */
export const ARROW_SIDESTEP_M = 3.5;

/**
 * ⚠️ AN ARROW INTO A WALL IS NOT SHOWN (operator, 2026-09-28: "if moving to
 * one direction leads to nowhere, only walls, remove that particular arrow").
 * It is shown only if at least half its step is clear — not merely a few
 * centimetres before the wall, the fountain or a shop counter.
 */
export function arrowLeads(reachM: number, stepM: number): boolean {
  return reachM >= Math.max(1, stepM * 0.5);
}

/** The yaw (camera convention) an arrow points along, for a visitor facing `heading`. */
export function arrowYaw(dir: ArrowDir, heading: number): number {
  return heading + { fwd: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[dir];
}

/**
 * How far ahead the cross of arrows sits (its centre), so that even the near
 * arrow is on screen and clear of the buttons at the bottom: the near arrow at
 * about half-way down the lower half of the picture. `vfovDeg` is the camera's
 * vertical angle, `pitch` where it looks (up +).
 */
export function arrowAheadFor(vfovDeg: number, pitch = 0, eye = 1.7): number {
  const below = Math.max(d2r(8), Math.min(d2r(60), d2r(vfovDeg / 2) * 0.55 - pitch));
  // The cross grows with its distance (see `arrowSpot`), so the near arrow is
  // at ahead × (1 − spread/ahead₀); solve for ahead.
  const near = Math.max(ARROW_AHEAD_M - ARROW_SPREAD_M, eye / Math.tan(below));
  return near / (1 - ARROW_SPREAD_M / ARROW_AHEAD_M);
}

/** Where on the floor the arrow for `dir` sits, for a visitor at (x, z) facing `heading`. */
export function arrowSpot(
  dir: ArrowDir,
  x: number,
  z: number,
  heading: number,
  aheadM = ARROW_AHEAD_M,
): { x: number; z: number } {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  // Left of facing (fx, fz) is (fz, -fx).
  const lx = fz;
  const lz = -fx;
  // Further away, the whole cross is bigger, so it looks the same size.
  const k = aheadM / ARROW_AHEAD_M;
  const along = aheadM + k * (dir === "fwd" ? ARROW_SPREAD_M : dir === "back" ? -ARROW_SPREAD_M : 0);
  const side = k * (dir === "left" ? ARROW_SIDE_M : dir === "right" ? -ARROW_SIDE_M : 0);
  return { x: x + fx * along + lx * side, z: z + fz * along + lz * side };
}

/** Where a tap on the arrow for `dir` walks you in the open, for a visitor facing `heading`. */
export function arrowTarget(dir: ArrowDir, x: number, z: number, heading: number): { x: number; z: number } {
  const d = dir === "fwd" || dir === "back" ? ARROW_STEP_M : ARROW_SIDESTEP_M;
  const a = arrowYaw(dir, heading);
  return { x: x - Math.sin(a) * d, z: z - Math.cos(a) * d };
}
