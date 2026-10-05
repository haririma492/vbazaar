// The taxi at either end of a Virtual Ride by taxi, in Street View: it pulls
// up along the street and stops at the kerb in front of the rider, who walks
// up and gets in; at the destination they get out, step back, and it drives
// off. Pure — the timeline only, in metres in the rider's frame (x right, y
// up from the street, z forward is negative, as in Three.js) — tested by
// `npm test`. During the drive the taxi sits still in the chase camera's
// frame (`RIDE.taxi` in flight.ts).

/** The rider's eye above the street in Street View (a camera on a car roof). */
export const STREET_EYE = 2.5;

export const TAXI = {
  /** Pulling up from the right, slowing to a stop at the kerb ahead. */
  driveInMs: 2_600,
  waitMs: 1_100,
  /** The rider walking up and getting in: the taxi comes close, then fades. */
  getInMs: 1_800,
  /** Getting out at the destination: stepping back from it as it appears. */
  getOutMs: 1_500,
  /** Then pulling away to the left. */
  driveOffMs: 2_400,
  /** Where it stops: this far ahead, across the rider's view. */
  kerbAhead: 6,
  /** Where it comes from / goes to, to the side. */
  offSide: 24,
  /** How close the rider comes before they are in. */
  inAhead: 2.4,
  /** Wheel radius, metres (for turning the wheels with the speed). */
  wheel: 0.36,
} as const;

export const TAXI_BOARDING_MS = TAXI.driveInMs + TAXI.waitMs + TAXI.getInMs;
export const TAXI_ALIGHTING_MS = TAXI.getOutMs + TAXI.waitMs + TAXI.driveOffMs;

export type TaxiFrame = {
  car: { x: number; y: number; z: number };
  /** Rotation about up, radians: 0 faces away from the rider, π/2 faces left. */
  yaw: number;
  /** Ground speed, metres per second (turns the wheels). */
  speed: number;
  /** 1 solid … 0 gone. */
  opacity: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** Fast, then slowing to a stop. */
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 2;
/** Gently away, then faster. */
const easeIn = (x: number) => clamp01(x) ** 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function boardingPose(t: number) {
  const T = TAXI;
  const x = lerp(T.offSide, 0, easeOut(t / T.driveInMs));
  const tIn = t - T.driveInMs - T.waitMs;
  const z = -lerp(T.kerbAhead, T.inAhead, ease(tIn / T.getInMs));
  const opacity = 1 - ease((tIn - T.getInMs * 0.55) / (T.getInMs * 0.45));
  return { x, z, opacity };
}

function alightingPose(t: number) {
  const T = TAXI;
  const z = -lerp(T.inAhead, T.kerbAhead, ease(t / T.getOutMs));
  const opacity = ease(t / (T.getOutMs * 0.45));
  const tOff = t - T.getOutMs - T.waitMs;
  const x = lerp(0, -T.offSide, easeIn(tOff / T.driveOffMs));
  return { x, z, opacity };
}

function frame(pose: (t: number) => { x: number; z: number; opacity: number }, tMs: number): TaxiFrame {
  const t = Math.max(0, tMs);
  const p = pose(t);
  const ahead = pose(t + 20);
  const behind = pose(Math.max(0, t - 20));
  return {
    car: { x: p.x, y: 0, z: p.z },
    yaw: Math.PI / 2,
    // Only its own driving turns the wheels, not the rider walking up to it.
    speed: Math.max(Math.abs(ahead.x - p.x), Math.abs(p.x - behind.x)) / 0.02,
    opacity: p.opacity,
  };
}

export const taxiBoardingFrame = (tMs: number) => frame(boardingPose, tMs);
export const taxiAlightingFrame = (tMs: number) => frame(alightingPose, tMs);
