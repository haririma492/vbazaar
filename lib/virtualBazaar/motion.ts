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
 * ⚠️ THE PHONE IS THE HEAD, NOT THE BODY (operator, 2026-09-27: "if we see
 * something interesting and change the direction of our body to that
 * direction then the point of reference changes, and again we have 90 degrees
 * of head movement from that point").
 *
 * Someone holding a phone can turn it about a quarter-turn each way before
 * their neck — or their chair — runs out, so the phone turning the view
 * one-for-one would never show what is behind them. Three headings:
 *
 *   `rest`   where the phone sits when the visitor is comfortable (fixed —
 *            where it pointed when the sensor came on);
 *   `centre` the phone heading that means "straight ahead from the body";
 *   `phone`  where it points now.
 *
 * The view is the body's heading plus the neck (`phone − centre`). Look at
 * something to one side and hold it there a moment, and THE BODY TURNS TO FACE
 * IT: the body takes the neck's turn and the neck goes to zero, so the view
 * does not move. Then, bringing the phone back towards `rest` is the visitor
 * getting comfortable, not looking away — `centre` travels with the phone and
 * the view stays on what they were looking at. Back at rest, the phone held
 * straight faces the new way, with the full neck either side of it.
 *
 * ⚠️ WHY THE RETURN MUST BE ABSORBED. Without it, the body turning changes
 * nothing: phone back to rest is a head turn the other way by the same angle,
 * and the view lands exactly where it started. (Tried; that is what it did.)
 */
const d2r = (d: number) => (d * Math.PI) / 180;

/** Inside this the head is just looking; the body stays put. */
export const NECK_DEADZONE = d2r(25);
/** How long the head must rest off to one side before the body turns. */
export const BODY_DWELL_S = 0.7;
/** "Resting": the head turning slower than this. */
export const HEAD_STILL_RAD_S = d2r(25);
/** The return is over once the phone has settled this close to `rest`… */
export const REST_REACHED = d2r(12);
/** …and stayed still this long there. */
export const SETTLE_S = 0.3;
/**
 * ⚠️ STILL THIS LONG ANYWHERE, AND THAT IS THE NEW REST. Someone who stands
 * up and turns round for real never brings the phone back to where it used to
 * rest — that is behind them now. Without this, every later look back that
 * way would be taken for "getting comfortable" and the view would refuse to
 * follow the phone.
 *
 * The phone's heading alone cannot tell a real turn from a long look over the
 * shoulder, so this is long: a twisted neck rarely holds still for 4 s, and
 * someone who turned round for real stands there far longer.
 */
export const NEW_REST_S = 4;

export type Neck = { dwell: number; returning: boolean; still: number };
export const NECK_AT_REST: Neck = { dwell: 0, returning: false, still: 0 };

/**
 * One frame. `phone`, `rest`, `centre` are headings (radians); `turned` is how
 * far the phone turned since the last frame (signed). Returns the new `centre`
 * and `rest`, how far the BODY turns this frame (add it to the body's yaw), and
 * the state.
 * The view (body + phone − centre) never jumps: whatever the body gains, the
 * neck gives back.
 */
export function headStep(
  phone: number,
  turned: number,
  rest: number,
  centre: number,
  dt: number,
  state: Neck,
): { centre: number; rest: number; bodyTurn: number; state: Neck } {
  const speed = dt > 0 ? Math.abs(turned) / dt : 0;
  const still = speed < HEAD_STILL_RAD_S ? state.still + dt : 0;

  const neck = shortestAngleDelta(centre, phone);
  const holding = Math.abs(neck) > NECK_DEADZONE && speed < HEAD_STILL_RAD_S;
  const dwell = holding ? state.dwell + dt : 0;

  if (state.returning) {
    // Held a look further out on the way back: the body turns again.
    if (dwell >= BODY_DWELL_S) return { centre: phone, rest, bodyTurn: neck, state: { dwell: 0, returning: true, still: 0 } };
    const fromRest = Math.abs(shortestAngleDelta(rest, phone));
    const before = Math.abs(shortestAngleDelta(rest, phone - turned));
    // Coming back towards rest: the centre travels with the phone. Going
    // away from it is a look.
    const next = fromRest < before ? centre + turned : centre;
    if (still >= NEW_REST_S) return { centre: next, rest: phone, bodyTurn: 0, state: NECK_AT_REST };
    const done = fromRest < REST_REACHED && still >= SETTLE_S;
    return { centre: next, rest, bodyTurn: 0, state: done ? NECK_AT_REST : { dwell, returning: true, still } };
  }

  if (dwell < BODY_DWELL_S) return { centre, rest, bodyTurn: 0, state: { dwell, returning: false, still } };
  // The body turns to where the head is; the neck is straight again.
  return { centre: phone, rest, bodyTurn: neck, state: { dwell: 0, returning: true, still: 0 } };
}
