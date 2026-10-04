/**
 * WALK BY TILTING — the phone as the whole controller (operator, 2026-10-04).
 *
 *   • The phone's comfortable position in the hand — upright, top leaning
 *     back about 15–20°, not twisted — is "standing still". It is captured
 *     when the mode starts (`neutralPitch`), so each hand sets its own.
 *   • Tilt the top further back to walk: 2° past comfortable is the first
 *     speed, 4° the second, 6° the last. Back to comfortable, and you stop.
 *   • Twist it like a steering wheel to turn the BODY. The turn follows the
 *     twist out; the twist back to straight does not undo it, so the body
 *     stays facing the new way. To turn back, twist the other way.
 *
 * Pure: angles in, speed level and turn out. `SplatTour` feeds it the phone's
 * orientation events; the tests pin the thresholds.
 */

const DEG = Math.PI / 180;

/** Tilt past comfortable (degrees) that starts each speed, slowest first. */
export const SPEED_STEPS = [2, 4, 6] as const;
/** How far below a step the tilt must come back before that speed drops (no flicker at the edge). */
const HYSTERESIS = 1;
/** A twist smaller than this (degrees) is a steady hand, not a turn. */
export const TWIST_DEAD = 1.5;
/** The body turns this many degrees per degree of twist: a 15° twist is a 30° turn. */
export const TURN_GAIN = 2;
/** Fraction of full speed at each level: standing, then the three steps. */
export const LEVEL_SPEED = [0, 0.35, 0.65, 1] as const;

/**
 * How the phone is held, from its orientation event (degrees, the browser's
 * own beta and gamma, and the screen's angle):
 *   pitch  how far the top leans back from upright (0 upright, 90 flat face-up)
 *   roll   how far it is twisted like a steering wheel (+ right, − left)
 * Worked out from where "up" points in the phone's own frame, so neither the
 * compass nor the angle sets' gimbal flips near upright get in the way.
 */
export function holdAngles(betaDeg: number, gammaDeg: number, screenDeg = 0): { pitch: number; roll: number } {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  // "Up" in the phone's frame: x to its right edge, y to its top, z out of the screen.
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  // Held sideways, the screen's own up is another edge of the phone.
  const s = screenDeg * DEG;
  const sx = ux * Math.cos(s) - uy * Math.sin(s);
  const sy = ux * Math.sin(s) + uy * Math.cos(s);
  return { pitch: Math.atan2(uz, sy) / DEG, roll: Math.atan2(-sx, sy) / DEG };
}

export type TiltState = {
  /** The pitch captured as "standing still". */
  neutralPitch: number;
  /** 0 standing, 1–3 the speeds. */
  level: number;
  /** The last twist beyond the dead zone, signed — what a new twist is measured from. */
  lastTwist: number;
};

export function startTilt(neutralPitch: number): TiltState {
  return { neutralPitch, level: 0, lastTwist: 0 };
}

/** The speed level for a tilt past comfortable, given the current level (hysteresis). */
export function speedLevel(past: number, current: number): number {
  let level = 0;
  for (let i = 0; i < SPEED_STEPS.length; i++) {
    const step = SPEED_STEPS[i];
    // Holding a level only needs the tilt to stay within HYSTERESIS below its step.
    const needed = current > i ? step - HYSTERESIS : step;
    if (past >= needed) level = i + 1;
  }
  return level;
}

/** The twist beyond the dead zone, keeping its sign; 0 inside it. */
function effectiveTwist(roll: number): number {
  const a = Math.abs(roll);
  return a <= TWIST_DEAD ? 0 : Math.sign(roll) * (a - TWIST_DEAD);
}

/**
 * One reading of the phone. Returns the new state and how far the body turns
 * now (degrees, + right). A twist moving AWAY from straight turns the body;
 * one moving back toward straight does not — that is what leaves the body
 * facing the new way when the hand returns to comfortable.
 */
export function stepTilt(state: TiltState, pitch: number, roll: number): { state: TiltState; turn: number } {
  const level = speedLevel(pitch - state.neutralPitch, state.level);
  const twist = effectiveTwist(roll);
  const away = Math.abs(twist) > Math.abs(state.lastTwist) && Math.sign(twist) === Math.sign(state.lastTwist || twist);
  let turn = 0;
  if (away) turn = (twist - state.lastTwist) * TURN_GAIN;
  // Crossing straight in one jump: only the part beyond straight counts.
  else if (twist !== 0 && Math.sign(twist) !== Math.sign(state.lastTwist) && state.lastTwist !== 0) turn = twist * TURN_GAIN;
  return { state: { ...state, level, lastTwist: twist }, turn };
}

/**
 * THE STICK DRIVES THE SAME WAY (operator, 2026-10-04: "exactly the same
 * behaviour on the joystick"). Its push up is the tilt back, its push sideways
 * the steering twist, fed through `stepTilt` as if the phone were held so:
 *   up      a quarter push walks slowly, half faster, three quarters full speed
 *   ←/→     the body turns by how far it went (a full push and back is ~90°)
 *           and stays turned when the knob comes back to the middle
 * (Down — stepping back, a car's reverse — is the stick's own: the phone has
 * no tilt for it.)
 */
const STICK_FULL_PITCH = 8; // a full push up = 8° past comfortable, beyond the last step
const STICK_FULL_TWIST = 46.5; // a full push sideways: (46.5 − 1.5) × 2 = a 90° turn

export function stickHold(x: number, y: number): { pitch: number; roll: number } {
  return { pitch: Math.max(0, -y) * STICK_FULL_PITCH, roll: x * STICK_FULL_TWIST };
}
