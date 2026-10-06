// The Virtual Ride: headings point the right way, the path is measured
// truly, the flight starts over home, stays low over the road, and ends
// standing on the ground facing the destination.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  RIDE, bearingDegrees, cameraHeight, distanceMeters, eyeCamera, flightFrame, groundProfile, headingAt,
  homeCamera, lerpAngle, makePath, offset, planFlight, pointAt, rideDurationMillis, samplePath, straightPath,
  travelFraction,
} from "./flight.ts";
import { DISTRICTS, districtById } from "./districts.ts";

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≉ ${b} (±${tol})`);

const O = { lat: 43.7, lng: -79.4 };

test("bearing: north is 0, east is 90, south 180, west 270", () => {
  near(bearingDegrees(O, { lat: 43.8, lng: -79.4 }), 0, 0.01);
  near(bearingDegrees(O, { lat: 43.7, lng: -79.3 }), 90, 0.1);
  near(bearingDegrees(O, { lat: 43.6, lng: -79.4 }), 180, 0.01);
  near(bearingDegrees(O, { lat: 43.7, lng: -79.5 }), 270, 0.1);
});

test("distance and offset agree: 0.1° of latitude ≈ 11.1 km", () => {
  near(distanceMeters(O, { lat: 43.8, lng: -79.4 }), 11_120, 20);
  for (const h of [0, 45, 90, 200, 315]) {
    const p = offset(O, h, 500);
    near(distanceMeters(O, p), 500, 1, `h=${h}`);
    near(bearingDegrees(O, p), h, 0.5, `h=${h}`);
  }
});

test("headings turn the short way round", () => {
  near(lerpAngle(350, 10, 0.5), 0, 1e-9);
  near(lerpAngle(10, 350, 0.25), 5, 1e-9);
  near(lerpAngle(90, 270, 1), 270, 1e-9);
});

test("eyeCamera keeps the eye where it was asked to be", () => {
  const c = eyeCamera(O, 80, 30, 68, 175);
  near(cameraHeight(c), 80, 1e-6);
  assert.equal(c.center.altitude, 175);
  // The looked-at point is ahead of the eye, along the heading.
  near(bearingDegrees(O, c.center), 30, 0.5);
  near(distanceMeters(O, c.center), c.range * Math.sin((68 * Math.PI) / 180), 1);
  // Tilt is capped short of the horizon.
  assert.equal(eyeCamera(O, 1.7, 0, 89, 0).tilt, RIDE.landTilt);
});

test("path: measured, walked, and faced", () => {
  // An L: 1 km north, then 1 km east.
  const corner = offset(O, 0, 1000);
  const end = offset(corner, 90, 1000);
  const p = makePath([O, corner, end]);
  near(p.length, 2000, 2);
  near(distanceMeters(pointAt(p, 500), offset(O, 0, 500)), 0, 1);
  near(distanceMeters(pointAt(p, 1500), offset(corner, 90, 500)), 0, 1);
  assert.deepEqual(pointAt(p, -10), p.points[0]);
  assert.deepEqual(pointAt(p, 1e9), p.points[p.points.length - 1]);
  near(headingAt(p, 100), 0, 0.5);
  near(headingAt(p, 1600), 90, 0.5);
  // Turning into the corner before reaching it.
  const h = headingAt(p, 950, 120);
  assert.ok(h > 10 && h < 80, String(h));
  assert.equal(samplePath(p, 5).length, 5);
});

test("path: stacked points are dropped, both ends kept", () => {
  const p = makePath([O, offset(O, 0, 3), offset(O, 0, 6), offset(O, 0, 400), offset(O, 0, 402)], 15);
  assert.equal(p.points.length, 2); // 3 m and 6 m dropped; 402 m replaces 400 m
  near(p.length, 402, 1);
  assert.equal(straightPath(O, O).points.length, 2);
});

test("ground profile interpolates the elevation samples", () => {
  const p = straightPath(O, offset(O, 0, 1000));
  const g = groundProfile(p, [100, 120, 110]);
  near(g(0), 100, 1e-6);
  near(g(250), 110, 1e-3);
  near(g(500), 120, 1e-3);
  near(g(1000), 110, 1e-6);
  assert.equal(groundProfile(p, [])(500), 0);
});

test("duration: a 5 km drive is ~50 s, clamped 30–75 s", () => {
  assert.equal(rideDurationMillis(0), RIDE.minMs);
  assert.equal(rideDurationMillis(5_000), 52_000);
  assert.equal(rideDurationMillis(100_000), RIDE.maxMs);
});

test("travel: starts at 0, ends at 1, never goes backwards, stops gently", () => {
  assert.equal(travelFraction(0), 0);
  near(travelFraction(1), 1, 1e-12);
  let last = 0;
  for (let i = 1; i <= 100; i++) {
    const f = travelFraction(i / 100);
    assert.ok(f >= last, `i=${i}`);
    last = f;
  }
  // The last 1% of the time covers far less than 1% of the distance.
  assert.ok(1 - travelFraction(0.99) < 0.001);
});

test("flight: over home, low over the road, then standing facing the destination", () => {
  // ~5 km north along a road, then 300 m east.
  const bend = offset(O, 0, 4700);
  const dest = offset(bend, 90, 300);
  const path = makePath([O, offset(O, 0, 2000), bend, dest]);
  const shop = offset(dest, 180, 25); // the entrance, across the sidewalk
  const plan = planFlight({
    path,
    ground: () => 180,
    followsRoad: true,
    finalHeading: bearingDegrees(dest, shop),
  });
  assert.equal(plan.durationMs, rideDurationMillis(path.length));
  assert.ok(plan.cruise >= RIDE.minCruiseRoad && plan.cruise <= 150, String(plan.cruise));

  assert.deepEqual(flightFrame(plan, 0), homeCamera(plan));

  const mid = flightFrame(plan, plan.durationMs * 0.5);
  near(cameraHeight(mid), plan.cruise, 1e-6);
  near(mid.tilt, RIDE.cruiseTilt, 1e-6);

  const end = flightFrame(plan, plan.durationMs);
  near(cameraHeight(end), RIDE.eyeHeight, 1e-6);
  assert.equal(end.tilt, RIDE.landTilt);
  near(end.heading, 180, 0.01);
  assert.equal(end.center.altitude, 180);
  // The eye is on the destination spot: the looked-at point is `range·sin(tilt)` ahead of it.
  const eye = offset(end.center, end.heading + 180, end.range * Math.sin((end.tilt * Math.PI) / 180));
  near(distanceMeters(eye, dest), 0, 0.5);

  // Past the end it stays put.
  assert.deepEqual(flightFrame(plan, plan.durationMs * 2), end);
});

test("from the street: standing in front of home facing it, then up to cruise", () => {
  const path = makePath([O, offset(O, 0, 3000), offset(O, 45, 5000)]);
  const plan = planFlight({ path, ground: () => 150, followsRoad: true, startHeading: 270 });
  const start = flightFrame(plan, 0);
  near(cameraHeight(start), RIDE.eyeHeight, 1e-6);
  assert.equal(start.tilt, RIDE.landTilt);
  near(start.heading, 270, 1e-6);
  const eye = offset(start.center, start.heading + 180, start.range * Math.sin((start.tilt * Math.PI) / 180));
  near(distanceMeters(eye, O), 0, 0.5);
  // Climbing all through takeoff, at cruise once it ends, facing the road.
  let last = 0;
  for (let i = 1; i <= 10; i++) {
    const h = cameraHeight(flightFrame(plan, plan.durationMs * RIDE.accel * (i / 10)));
    assert.ok(h >= last - 1e-9, `i=${i}`);
    last = h;
  }
  near(last, plan.cruise, 1e-6);
  const cruising = flightFrame(plan, plan.durationMs * 0.4);
  near(cruising.tilt, RIDE.cruiseTilt, 1e-6);
  // Without a street spot it still starts above home.
  assert.deepEqual(flightFrame(planFlight({ path, ground: () => 150, followsRoad: true }), 0),
    homeCamera(planFlight({ path, ground: () => 150, followsRoad: true })));
});

test("a straight-line ride flies higher, clear of towers", () => {
  const path = straightPath(O, offset(O, 0, 5000));
  const road = planFlight({ path, ground: () => 0, followsRoad: true });
  const straight = planFlight({ path, ground: () => 0, followsRoad: false });
  assert.ok(straight.cruise >= RIDE.minCruiseStraight);
  assert.ok(straight.cruise > road.cruise);
});

test("districts: unique ids, real places", () => {
  assert.ok(DISTRICTS.length > 0);
  assert.equal(new Set(DISTRICTS.map((d) => d.id)).size, DISTRICTS.length);
  for (const d of DISTRICTS) {
    assert.ok(Math.abs(d.location.lat) <= 90 && Math.abs(d.location.lng) <= 180, d.id);
    assert.ok(d.groundAltitude > -100 && d.groundAltitude < 5000, d.id);
    assert.ok(d.name.en && d.name.fa, d.id);
  }
  for (const d of DISTRICTS) if (d.enterOnArrival) assert.ok(d.entryScene?.startsWith("/"), d.id);
  assert.equal(districtById("world-on-yonge")?.name.en, "World on Yonge");
  // The splat tour's hallway is at World on Yonge: the ride lands into it.
  assert.equal(districtById("world-on-yonge")?.entryScene, "/vca/splat");
  assert.equal(districtById("world-on-yonge")?.enterOnArrival, true);
  // It lands on Yonge in front of 7171 Yonge St, facing the building — not inside it.
  const woy = districtById("world-on-yonge")!;
  assert.deepEqual(woy.street, { lat: 43.8027855, lng: -79.4212847, heading: 69.91 });
  assert.ok(woy.street!.lng < woy.location.lng, "the street spot is west of the towers");
  near(bearingDegrees(woy.street!, woy.location), woy.street!.heading, 20);
  for (const d of DISTRICTS) if (d.street) assert.ok(distanceMeters(d.street, d.location) < 150, d.id);
  assert.equal(districtById("nowhere"), null);
});

test("by taxi: slower, on the road, the camera behind and above the car at the view's centre", async () => {
  const path = makePath([O, offset(O, 0, 3000), offset(offset(O, 0, 3000), 90, 2000)]);
  const taxi = planFlight({ path, ground: () => 150, followsRoad: true, vehicle: "taxi" });
  const drone = planFlight({ path, ground: () => 150, followsRoad: true });
  assert.equal(taxi.vehicle, "taxi");
  assert.equal(taxi.durationMs, rideDurationMillis(path.length, "taxi"));
  assert.ok(taxi.durationMs > drone.durationMs);
  // No road, no taxi: a straight line through the city is the drone's.
  assert.equal(planFlight({ path, ground: () => 150, followsRoad: false, vehicle: "taxi" }).vehicle, "drone");

  for (const u of [0, 0.3, 0.7, 1]) {
    const c = flightFrame(taxi, taxi.durationMs * u);
    // The looked-at point is the car, on the road.
    const s = path.length * travelFraction(u, RIDE.taxi.accel, RIDE.taxi.decel);
    near(distanceMeters(c.center, pointAt(path, s)), 0, 0.01, `u=${u}`);
    near(cameraHeight(c), RIDE.taxi.height, 1e-6);
    near(c.range * Math.sin((c.tilt * Math.PI) / 180), RIDE.taxi.behind, 1e-6);
    assert.equal(c.center.altitude, 150);
  }
  near(flightFrame(taxi, taxi.durationMs * 0.3).heading, 0, 1);
  near(flightFrame(taxi, taxi.durationMs * 0.9).heading, 90, 1);
});

test("taxi in Street View: pulls up, waits, the rider gets in; gets out, it drives off", async () => {
  const { TAXI, TAXI_ALIGHTING_MS, TAXI_BOARDING_MS, taxiAlightingFrame, taxiBoardingFrame } = await import("./taxi.ts");
  const arriving = taxiBoardingFrame(0);
  assert.deepEqual(arriving.car, { x: TAXI.offSide, y: 0, z: -TAXI.kerbAhead });
  assert.ok(arriving.speed > 10, String(arriving.speed));
  const stopped = taxiBoardingFrame(TAXI.driveInMs + TAXI.waitMs / 2);
  near(stopped.car.x, 0, 1e-9);
  assert.equal(stopped.speed, 0);
  assert.equal(stopped.opacity, 1);
  const inside = taxiBoardingFrame(TAXI_BOARDING_MS);
  near(inside.car.z, -TAXI.inAhead, 1e-9);
  assert.equal(inside.opacity, 0);
  assert.equal(inside.speed, 0);

  const out = taxiAlightingFrame(0);
  assert.equal(out.opacity, 0);
  near(out.car.z, -TAXI.inAhead, 1e-9);
  const parked = taxiAlightingFrame(TAXI.getOutMs + TAXI.waitMs / 2);
  assert.deepEqual(parked.car, { x: 0, y: 0, z: -TAXI.kerbAhead });
  assert.equal(parked.opacity, 1);
  const gone = taxiAlightingFrame(TAXI_ALIGHTING_MS);
  near(gone.car.x, -TAXI.offSide, 1e-9);
  assert.ok(gone.speed > 10);
});

test("pace: slower takes longer and flies lower, faster the opposite", async () => {
  const { PACES, paceFactor } = await import("./flight.ts");
  const path = makePath([O, offset(O, 0, 5000)]);
  const plan = (id: string) => planFlight({ path, ground: () => 0, followsRoad: true, pace: paceFactor(id) });
  const slow = plan("slower"), normal = plan("normal"), fast = plan("faster");
  assert.equal(normal.durationMs, rideDurationMillis(5000));
  near(slow.durationMs, normal.durationMs * 1.6, 1);
  near(fast.durationMs, normal.durationMs * 0.6, 1);
  assert.ok(slow.cruise <= normal.cruise && normal.cruise < fast.cruise, `${slow.cruise} ${normal.cruise} ${fast.cruise}`);
  assert.equal(paceFactor("nonsense"), 1);
  assert.equal(paceFactor(null), 1);
  assert.deepEqual(PACES.map((p) => p.id), ["slower", "normal", "faster"]);
  // Still lands standing at the end, whatever the pace.
  near(cameraHeight(flightFrame(fast, fast.durationMs)), RIDE.eyeHeight, 1e-6);
});

test("durations read the way a rider reads them", async () => {
  const { formatDuration } = await import("./flight.ts");
  assert.equal(formatDuration(0), "5 s");
  assert.equal(formatDuration(42_000), "40 s");
  assert.equal(formatDuration(43_000), "45 s");
  assert.equal(formatDuration(60_000), "1 min");
  assert.equal(formatDuration(81_000), "1 min 20 s");
  assert.equal(formatDuration(125_000), "2 min 5 s");
});
