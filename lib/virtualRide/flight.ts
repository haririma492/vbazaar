// The Virtual Ride, as arithmetic: where the rider's eye is at every moment
// of the flight from their address to a shopping district, and the camera
// Google's Map3DElement needs to show it. Pure — no Google, no DOM — so it is
// tested by `npm test` and is what an app screen would port.
//
// Map3DElement places its camera by what it LOOKS AT: `center` (altitude in
// metres above SEA LEVEL), `range` (the camera's distance from it), `tilt`
// (0 straight down … 90 at the horizon) and `heading` (0 north, 90 east).
// The ride thinks in the opposite way — where the rider's EYE is, how high
// above the ground, which way they face — and `eyeCamera` converts.

export type LatLng = { lat: number; lng: number };

/** One Map3DElement camera. */
export type RideCamera = {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
};

const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, 0 ≤ ° < 360 (0 north, 90 east). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `meters` from `p` along `heading` (flat-earth; fine under a few km). */
export function offset(p: LatLng, heading: number, meters: number): LatLng {
  const h = rad(heading);
  return {
    lat: p.lat + deg((meters * Math.cos(h)) / R),
    lng: p.lng + deg((meters * Math.sin(h)) / (R * Math.cos(rad(p.lat)))),
  };
}

/** a + (b − a)·t */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Heading interpolation the short way round: 350° → 10° passes north. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

/** 0 → 1 with a gentle start and finish. */
export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Steepest tilt the ride uses; at 90 the looked-at point is at infinity. */
export const MAX_TILT = 86;

/**
 * The camera for a rider whose eye is `height` metres above the ground at
 * `eye`, facing `heading` and looking `tilt` degrees up from straight down.
 * The looked-at point is on the ground ahead, so the eye stays exactly where
 * it was asked to be.
 */
export function eyeCamera(eye: LatLng, height: number, heading: number, tilt: number, ground: number): RideCamera {
  const t = Math.min(MAX_TILT, Math.max(0, tilt));
  const h = Math.max(0.5, height);
  const range = h / Math.cos(rad(t));
  const ahead = offset(eye, heading, range * Math.sin(rad(t)));
  return {
    center: { lat: ahead.lat, lng: ahead.lng, altitude: ground },
    range,
    tilt: t,
    heading: (heading + 360) % 360,
  };
}

/* ─── The path: the road route, measured. ─────────────────────────── */

export type RidePath = {
  points: LatLng[];
  /** cum[i] = metres from points[0] to points[i]. */
  cum: number[];
  length: number;
};

/**
 * A path from route points, dropping points closer than `minSpacing` metres
 * to the last one kept (a route polyline can have thousands, many stacked at
 * corners). The first and last points are always kept.
 */
export function makePath(raw: LatLng[], minSpacing = 15): RidePath {
  const pts = raw.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (pts.length === 0) throw new Error("empty path");
  const points: LatLng[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = i === pts.length - 1;
    if (distanceMeters(points[points.length - 1], pts[i]) >= minSpacing) points.push(pts[i]);
    else if (last) points[points.length - 1] = pts[i];
  }
  if (points.length === 1) points.push(points[0]);
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + distanceMeters(points[i - 1], points[i]));
  return { points, cum, length: cum[cum.length - 1] };
}

/** A straight line a → b, for when no road route is available. */
export function straightPath(a: LatLng, b: LatLng): RidePath {
  return makePath([a, b], 0);
}

/** The position `s` metres along the path (clamped to its ends). */
export function pointAt(path: RidePath, s: number): LatLng {
  const { points, cum, length } = path;
  const x = Math.min(length, Math.max(0, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= x) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? (x - cum[lo]) / seg : 0;
  return {
    lat: points[lo].lat + (points[hi].lat - points[lo].lat) * t,
    lng: points[lo].lng + (points[hi].lng - points[lo].lng) * t,
  };
}

/**
 * The facing at `s`: toward the point `lookahead` metres further on, so the
 * camera turns into a corner before it reaches it rather than snapping at it.
 * Near the end it looks back from the end instead.
 */
export function headingAt(path: RidePath, s: number, lookahead = 120): number {
  const a = Math.min(s, path.length - Math.min(lookahead, path.length));
  const from = pointAt(path, Math.max(0, a));
  const to = pointAt(path, Math.max(0, a) + lookahead);
  if (distanceMeters(from, to) < 1) return bearingDegrees(path.points[0], path.points[path.points.length - 1]);
  return bearingDegrees(from, to);
}

/** At most `n` points evenly spaced along the path (for an elevation request). */
export function samplePath(path: RidePath, n: number): LatLng[] {
  const k = Math.max(2, Math.floor(n));
  return Array.from({ length: k }, (_, i) => pointAt(path, (path.length * i) / (k - 1)));
}

/**
 * Ground height along the path from evenly spaced samples (Google's
 * `getElevationAlongPath`): heights[0] at the start … heights[n-1] at the end.
 */
export function groundProfile(path: RidePath, heights: number[]): (s: number) => number {
  const hs = heights.filter(Number.isFinite);
  if (hs.length === 0) return () => 0;
  if (hs.length === 1) return () => hs[0];
  return (s: number) => {
    const u = (Math.min(path.length, Math.max(0, s)) / (path.length || 1)) * (hs.length - 1);
    const i = Math.min(hs.length - 2, Math.floor(u));
    return hs[i] + (hs[i + 1] - hs[i]) * (u - i);
  };
}

/* ─── The flight: one frame for every moment. ──────────────────────── */

/**
 * Every tunable of the ride in one place. A real drive is compressed, not
 * replayed: 22 s plus 6 s per km, 30–75 s in all, so home → World on Yonge
 * (~5 km by road) is ~50 s. The cruise height follows the speed — a faster
 * ride flies higher, so the city doesn't smear — but never below 70 m over a
 * road, or 160 m in a straight line, where towers stand in the way.
 */
export const RIDE = {
  baseMs: 22_000,
  msPerKm: 6_000,
  minMs: 30_000,
  maxMs: 75_000,
  /** Fractions of the ride spent speeding up and slowing down. */
  accel: 0.15,
  decel: 0.3,
  /** Departure: looking down at the rider's home from this far away. */
  homeRange: 260,
  homeTilt: 50,
  cruiseTilt: 68,
  /** Cruise height = speed (m/s) × this, clamped. */
  heightPerSpeed: 0.7,
  minCruiseRoad: 70,
  minCruiseStraight: 160,
  maxCruise: 450,
  /** Arrival: a standing person's eye, looking almost level. */
  eyeHeight: 1.7,
  landTilt: MAX_TILT,
} as const;

export function rideDurationMillis(meters: number): number {
  const ms = RIDE.baseMs + (Math.max(0, meters) / 1000) * RIDE.msPerKm;
  return Math.round(Math.min(RIDE.maxMs, Math.max(RIDE.minMs, ms)));
}

/**
 * The share of the distance covered at share `u` of the time: speed rises
 * steadily for `accel`, holds, and falls to nothing over `decel`.
 */
export function travelFraction(u: number, accel: number = RIDE.accel, decel: number = RIDE.decel): number {
  const x = Math.min(1, Math.max(0, u));
  const area = 1 - accel / 2 - decel / 2;
  let s: number;
  if (x < accel) s = (x * x) / (2 * accel);
  else if (x <= 1 - decel) s = accel / 2 + (x - accel);
  else s = area - ((1 - x) * (1 - x)) / (2 * decel);
  return s / area;
}

/** Metres per second while cruising. */
export function cruiseSpeed(length: number, durationMs: number): number {
  return length / ((durationMs / 1000) * (1 - RIDE.accel / 2 - RIDE.decel / 2));
}

export function cruiseHeight(speed: number, followsRoad: boolean): number {
  const min = followsRoad ? RIDE.minCruiseRoad : RIDE.minCruiseStraight;
  return Math.min(RIDE.maxCruise, Math.max(min, speed * RIDE.heightPerSpeed));
}

export type FlightPlan = {
  path: RidePath;
  /** Ground height above sea level `s` metres along the path. */
  ground: (s: number) => number;
  durationMs: number;
  cruise: number;
  /** The way the rider faces once standing at the destination. */
  finalHeading: number;
};

export function planFlight(opts: {
  path: RidePath;
  ground: (s: number) => number;
  followsRoad: boolean;
  finalHeading?: number;
}): FlightPlan {
  const { path, ground, followsRoad } = opts;
  const durationMs = rideDurationMillis(path.length);
  return {
    path,
    ground,
    durationMs,
    cruise: cruiseHeight(cruiseSpeed(path.length, durationMs), followsRoad),
    finalHeading: opts.finalHeading ?? headingAt(path, path.length),
  };
}

/** The rider's eye height above the ground for a camera (range × cos tilt). */
export function cameraHeight(c: RideCamera): number {
  return c.range * Math.cos(rad(c.tilt));
}

function mixCamera(a: RideCamera, b: RideCamera, t: number): RideCamera {
  return {
    center: {
      lat: lerp(a.center.lat, b.center.lat, t),
      lng: lerp(a.center.lng, b.center.lng, t),
      altitude: lerp(a.center.altitude, b.center.altitude, t),
    },
    range: lerp(a.range, b.range, t),
    tilt: lerp(a.tilt, b.tilt, t),
    heading: lerpAngle(a.heading, b.heading, t),
  };
}

/** Looking down at the rider's home, facing the way the ride will leave. */
export function homeCamera(plan: FlightPlan): RideCamera {
  const home = plan.path.points[0];
  return {
    center: { lat: home.lat, lng: home.lng, altitude: plan.ground(0) },
    range: RIDE.homeRange,
    tilt: RIDE.homeTilt,
    heading: headingAt(plan.path, 0),
  };
}

/**
 * The camera `tMs` into the ride. 0: looking at home. Takeoff: the view
 * lifts off home into the rider's eye, already moving along the road.
 * Cruise: `plan.cruise` metres over the road, looking ahead and turning into
 * corners. Landing: slowing, descending to eye height and turning to face
 * the destination, standing on the ground at `durationMs`.
 */
export function flightFrame(plan: FlightPlan, tMs: number): RideCamera {
  const { path, ground, cruise } = plan;
  const u = Math.min(1, Math.max(0, tMs / plan.durationMs));
  const s = path.length * travelFraction(u);
  const eye = pointAt(path, s);
  const lift = smoothstep(u / RIDE.accel);
  const land = smoothstep((u - (1 - RIDE.decel)) / RIDE.decel);
  const turn = smoothstep((u - (1 - RIDE.decel * 0.6)) / (RIDE.decel * 0.6));

  const height = u < RIDE.accel ? cruise : lerp(cruise, RIDE.eyeHeight, land);
  const tilt = lerp(RIDE.cruiseTilt, RIDE.landTilt, land);
  const lookahead = Math.min(150, Math.max(40, height * 1.5));
  const heading = lerpAngle(headingAt(path, s, lookahead), plan.finalHeading, turn);
  const flying = eyeCamera(eye, height, heading, tilt, ground(s));

  return lift < 1 ? mixCamera(homeCamera(plan), flying, lift) : flying;
}
