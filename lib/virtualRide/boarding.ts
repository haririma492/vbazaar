// Boarding the drone, before the Virtual Ride lifts off: in Street View in
// front of home, a passenger drone waits on the street, spins up, lifts and
// glides in under the rider, carries them a couple of metres forward, then
// fades away as the ride takes over. Pure — the timeline only, in metres in
// the rider's own frame (x right, y up from the ground, z forward is
// negative, as in Three.js) — so it is tested by `npm test`.

/** The rider's eye above the street in Street View (a camera on a car roof). */
export const STREET_EYE = 2.5;

export const BOARDING = {
  /** Parked on the street ahead, propellers spinning up. */
  spinUpMs: 1_400,
  /** Lifting off and gliding in under the rider. */
  approachMs: 2_200,
  /** Carrying the rider forward. */
  carryMs: 2_400,
  /** Fading away as the ride takes over. */
  fadeMs: 900,
  /** Where it waits: this far ahead, on the ground. */
  parkedAhead: 6,
  /** Where it carries the rider from: just ahead of and below their eye. */
  boardAhead: 1.9,
  boardHeight: 1.1,
  /** How far it carries them. */
  carryMeters: 2.5,
  /** Propeller speed, turns per second, at full spin. */
  maxSpin: 9,
} as const;

export const BOARDING_MS = BOARDING.spinUpMs + BOARDING.approachMs + BOARDING.carryMs + BOARDING.fadeMs;

export type BoardingFrame = {
  /** The drone's centre in the rider's frame (they never move; the world does). */
  drone: { x: number; y: number; z: number };
  /** Propeller speed, turns per second. */
  spin: number;
  /** 1 solid … 0 gone. */
  opacity: number;
  /** Metres carried so far (0 … carryMeters), for the Street View dolly. */
  carried: number;
  /** A gentle hover bob once airborne, metres. */
  bob: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function boardingFrame(tMs: number): BoardingFrame {
  const B = BOARDING;
  const t = Math.max(0, tMs);
  const tApproach = t - B.spinUpMs;
  const tCarry = tApproach - B.approachMs;
  const tFade = tCarry - B.carryMs;

  const spin = B.maxSpin * Math.min(1, (t / B.spinUpMs) ** 2);
  const a = ease(tApproach / B.approachMs);
  // Up first, then in: lift leads the glide a little.
  const lift = ease((tApproach / B.approachMs) * 1.4);
  const y = lerp(0, B.boardHeight, lift);
  const z = -lerp(B.parkedAhead, B.boardAhead, a);
  const airborne = clamp01(tApproach / 400);
  const bob = airborne * 0.04 * Math.sin((t / 1000) * Math.PI * 1.6);

  return {
    drone: { x: 0, y, z },
    spin,
    opacity: 1 - ease(tFade / B.fadeMs),
    carried: B.carryMeters * ease(tCarry / B.carryMs),
    bob,
  };
}

/**
 * Getting off at the destination: boarding, backwards in time — appearing
 * aboard as Street View fades in, gliding out ahead to set down on the
 * street, propellers winding down — except the carry still goes forward.
 */
export function alightingFrame(tMs: number): BoardingFrame {
  const f = boardingFrame(BOARDING_MS - Math.max(0, tMs));
  return { ...f, carried: BOARDING.carryMeters - f.carried };
}
