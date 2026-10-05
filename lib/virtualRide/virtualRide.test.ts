// The Virtual Ride's camera: headings point the right way, a drive is
// compressed into seconds, and every registered district can be ridden to.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  RIDE_MAX_MS, RIDE_MIN_MS, arrivalCamera, bearingDegrees, departureCamera, distanceMeters, rideDurationMillis,
} from "./camera.ts";
import { DISTRICTS, districtById } from "./districts.ts";

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≉ ${b} (±${tol})`);

test("bearing: north is 0, east is 90, south 180, west 270", () => {
  const o = { lat: 43.7, lng: -79.4 };
  near(bearingDegrees(o, { lat: 43.8, lng: -79.4 }), 0, 0.01);
  near(bearingDegrees(o, { lat: 43.7, lng: -79.3 }), 90, 0.1);
  near(bearingDegrees(o, { lat: 43.6, lng: -79.4 }), 180, 0.01);
  near(bearingDegrees(o, { lat: 43.7, lng: -79.5 }), 270, 0.1);
});

test("distance: 0.1° of latitude is about 11.1 km", () => {
  near(distanceMeters({ lat: 43.7, lng: -79.4 }, { lat: 43.8, lng: -79.4 }), 11_120, 20);
  assert.equal(distanceMeters({ lat: 1, lng: 2 }, { lat: 1, lng: 2 }), 0);
});

test("duration: an 8-minute drive is a ~20 s ride, clamped 12–25 s", () => {
  assert.equal(rideDurationMillis(0), RIDE_MIN_MS);
  assert.equal(rideDurationMillis(5_000), 19_500);
  assert.equal(rideDurationMillis(80_000), RIDE_MAX_MS);
  assert.equal(rideDurationMillis(-5), RIDE_MIN_MS);
});

test("the camera leaves facing the destination and lands with the district's facing", () => {
  const home = districtById("home")!;
  const woy = districtById("world-on-yonge")!;
  const start = departureCamera(home.location, woy.location, home.rideArrival);
  const end = arrivalCamera(home.location, woy.location, woy.rideArrival);
  // World on Yonge is north of North York Centre, a touch west.
  assert.ok(start.heading > 340 || start.heading < 10, String(start.heading));
  assert.deepEqual(start.center, { ...home.location, altitude: home.rideArrival.altitude });
  assert.equal(end.heading, 200);
  assert.deepEqual(end.center, { ...woy.location, altitude: woy.rideArrival.altitude });
});

test("without a fixed facing the camera lands facing the way it travelled", () => {
  const a = { lat: 43.7, lng: -79.4 };
  const b = { lat: 43.7, lng: -79.3 };
  near(arrivalCamera(a, b, { altitude: 0, tilt: 65, range: 400 }).heading, 90, 0.1);
});

test("districts: unique ids, sane framing, any pair rideable", () => {
  assert.equal(new Set(DISTRICTS.map((d) => d.id)).size, DISTRICTS.length);
  for (const d of DISTRICTS) {
    assert.ok(Math.abs(d.location.lat) <= 90 && Math.abs(d.location.lng) <= 180, d.id);
    assert.ok(d.rideArrival.tilt >= 0 && d.rideArrival.tilt <= 90, d.id);
    assert.ok(d.rideArrival.range > 0, d.id);
  }
  for (const a of DISTRICTS) for (const b of DISTRICTS) {
    if (a === b) continue;
    const ms = rideDurationMillis(distanceMeters(a.location, b.location));
    assert.ok(ms >= RIDE_MIN_MS && ms <= RIDE_MAX_MS);
  }
  assert.equal(districtById("nowhere"), null);
});
