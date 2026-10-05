// The Virtual Ride's camera arithmetic: where the Google 3D camera starts,
// where it lands, and how long the flight between two shopping districts
// takes. Pure — no Google, no DOM — so it is tested with `npm test` and is
// what an app screen would port.
//
// Google's Map3DElement places its camera by what it LOOKS AT: `center` is
// the point in the middle of the view, `range` the camera's distance from it,
// `tilt` 0 straight down … 90 at the horizon, `heading` 0 north, 90 east.
// The camera's own height is roughly `range × cos(tilt)` above `center`.

export type LatLng = { lat: number; lng: number };

/** One Map3DElement camera (the shape `flyCameraTo({ endCamera })` takes). */
export type RideCamera = {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
};

/** How the camera sits over a district when a ride leaves or reaches it. */
export type RideFraming = {
  /** The looked-at point's altitude in metres — about ground level there. */
  altitude: number;
  /** Fixed facing on arrival; unset faces the way the ride travelled. */
  heading?: number;
  tilt: number;
  range: number;
};

/** Drone view: ~150 m up, looking diagonally down and forward. */
export const DRONE_FRAMING: RideFraming = { altitude: 0, tilt: 65, range: 380 };

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

/**
 * A real drive compressed to a ride: 12 s plus 1.5 s per km, never more than
 * 25 s. An 8-minute drive (~5 km) is a ~20 s flight — "fly me there", not
 * "simulate the drive".
 */
export const RIDE_MIN_MS = 12_000;
export const RIDE_MAX_MS = 25_000;
export function rideDurationMillis(meters: number): number {
  const ms = RIDE_MIN_MS + (Math.max(0, meters) / 1000) * 1_500;
  return Math.round(Math.min(RIDE_MAX_MS, ms));
}

function cameraOver(place: LatLng, framing: RideFraming, heading: number): RideCamera {
  return {
    center: { lat: place.lat, lng: place.lng, altitude: framing.altitude },
    range: framing.range,
    tilt: framing.tilt,
    heading: Math.round(heading * 10) / 10,
  };
}

/** Above the departure district, already facing the destination. */
export function departureCamera(from: LatLng, to: LatLng, framing: RideFraming = DRONE_FRAMING): RideCamera {
  return cameraOver(from, framing, bearingDegrees(from, to));
}

/** Above the destination: its own facing if it has one, else the travel direction. */
export function arrivalCamera(from: LatLng, to: LatLng, framing: RideFraming = DRONE_FRAMING): RideCamera {
  return cameraOver(to, framing, framing.heading ?? bearingDegrees(from, to));
}
