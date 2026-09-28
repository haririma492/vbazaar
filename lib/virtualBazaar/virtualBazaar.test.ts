// The Virtual Bazaar's plan and camera arithmetic: where one may walk, the
// route round the pool, the short way to turn, and the spot kept in the url
// so coming back from a shop lands in front of it.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  FOOD_STREET, FOOD_STREET_ENTRY, FOUNTAIN_CLEAR, SHOPS, START_POSE, STREETS,
  SQUARE_FROM_FOOD, WALK_RADIUS, gateFrontPose, isWalkable, nearestWalkable,
  STREET_STOPS, nextStop, streetDirection, parseSpot, planRoute, poseForSpot, routeAround, shopFrontPose, spotParam, step,
  yawToward, zoneOf, type Point,
} from "./layout.ts";
import {
  STROLL_SPEED, STEP_PRESS_S, WALK_EASE_IN_S, walkSpeed,
  TILT_FREE, TILT_TURN_MAX, tiltTurnRate,
  easeInOutCubic, isTap, tapSlop, lerpAngle, lookFromDrag, pathLength, pointAlong,
  PITCH_LIMIT, shortestAngleDelta, verticalFov,
} from "./motion.ts";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("walkable: the paved ring, not the pool, not past the arcade", () => {
  assert.equal(isWalkable(10, 0), true);
  assert.equal(isWalkable(0, 0), false, "the pool");
  assert.equal(isWalkable(0, FOUNTAIN_CLEAR - 0.1), false);
  assert.equal(isWalkable(0, WALK_RADIUS + 0.1), false, "into the arcade");
});

test("walkable: only the food street's floor beyond the square", () => {
  assert.equal(isWalkable(40, 0), true);
  assert.equal(isWalkable(40, FOOD_STREET.walkHalfWidth + 0.1), false, "a shop counter");
  assert.equal(isWalkable(FOOD_STREET.end, 0), false, "the end wall");
  // A closed gate (clothing, 60°) has no street behind it.
  const a = (60 * Math.PI) / 180;
  assert.equal(isWalkable(Math.cos(a) * 25, Math.sin(a) * 25), false);
});

test("walkable: the square and the street meet at the gate", () => {
  for (let x = 15; x <= 30; x += 0.25) assert.equal(isWalkable(x, 0), true, `x=${x}`);
});

test("every pose we fly to is somewhere one may stand", () => {
  const poses = [START_POSE, FOOD_STREET_ENTRY, SQUARE_FROM_FOOD, ...SHOPS.map(shopFrontPose), ...STREETS.map(gateFrontPose)];
  for (const p of poses) {
    assert.equal(isWalkable(p.x, p.z), true, JSON.stringify(p));
  }
});

test("step: slides along a wall instead of stopping dead", () => {
  const from = { x: 40, z: 2 };
  const into = { x: 41, z: 3 }; // diagonally into the south counter
  assert.deepEqual(step(from, into), { x: 41, z: 2 });
  assert.deepEqual(step({ x: 40, z: 0 }, { x: 40.5, z: 0.5 }), { x: 40.5, z: 0.5 });
});

test("routeAround: a straight line when it clears the pool", () => {
  assert.deepEqual(routeAround({ x: -15, z: 10 }, { x: 15, z: 10 }), [{ x: 15, z: 10 }]);
});

test("routeAround: through the pool goes beside it, and each leg clears it", () => {
  const from = { x: -15, z: 0.5 };
  const to = { x: 25, z: 0 };
  const route = routeAround(from, to);
  assert.equal(route.length, 2);
  const pts = [from, ...route];
  for (let i = 1; i < pts.length; i++) {
    for (let t = 0; t <= 1; t += 0.02) {
      const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
      const z = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t;
      assert.ok(Math.hypot(x, z) >= FOUNTAIN_CLEAR - 1e-9, `leg ${i} at t=${t}`);
    }
  }
  // It leans to the side the line already passed (z > 0).
  assert.ok(route[0].z > 0);
});

test("yawToward: north is 0, east is −π/2 (camera yaw turns left)", () => {
  close(yawToward(0, -1), 0);
  close(yawToward(1, 0), -Math.PI / 2);
  close(yawToward(-1, 0), Math.PI / 2);
});

test("zoneOf: the food street starts at its gate", () => {
  assert.equal(zoneOf(10, 0), "square");
  assert.equal(zoneOf(30, 0), "food");
  assert.equal(zoneOf(21, 15), "square");
});

test("spot: a shop and an open street survive the url; nonsense does not", () => {
  const sk = SHOPS.find((s) => s.id === "sarekooche")!;
  assert.equal(spotParam({ kind: "shop", shop: sk }), "shop:sarekooche");
  assert.deepEqual(parseSpot("shop:sarekooche"), { kind: "shop", shop: sk });
  assert.equal(parseSpot("street:food")?.kind, "street");
  assert.equal(parseSpot("street:gold"), null, "a closed street has nowhere to stand");
  assert.equal(parseSpot("shop:nope"), null);
  assert.equal(parseSpot(""), null);
  assert.equal(parseSpot(null), null);
  assert.deepEqual(poseForSpot(null), START_POSE);
  assert.deepEqual(poseForSpot(parseSpot("shop:sarekooche")), shopFrontPose(sk));
});

test("the Sarekooche shops open real pages; the scenery opens none", () => {
  const open = SHOPS.filter((s) => s.href).map((s) => [s.id, s.href]);
  assert.deepEqual(open, [["sarekooche", "/"], ["butcher", "/?open=meat-order"]]);
  assert.equal(new Set(SHOPS.map((s) => s.id)).size, SHOPS.length, "ids are unique");
  assert.equal(STREETS.filter((s) => s.open).map((s) => s.id).join(), "food");
});

test("easing: starts at 0, ends at 1, never overshoots", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  close(easeInOutCubic(0.5), 0.5);
  for (let t = -0.5; t <= 1.5; t += 0.05) {
    const v = easeInOutCubic(t);
    assert.ok(v >= 0 && v <= 1);
  }
});

test("angles: the short way round", () => {
  const deg = Math.PI / 180;
  close(shortestAngleDelta(170 * deg, -170 * deg), 20 * deg);
  close(shortestAngleDelta(-170 * deg, 170 * deg), -20 * deg);
  close(shortestAngleDelta(0, Math.PI), Math.PI);
  close(lerpAngle(170 * deg, -170 * deg, 0.5), 180 * deg);
});

test("drag: the view follows the finger, and pitch stops short of straight up", () => {
  const left = lookFromDrag(0, 0, -100, 0);
  assert.ok(left.yaw > 0, "finger left → look left (yaw grows turning left)");
  const up = lookFromDrag(0, 0, 0, -100);
  assert.ok(up.pitch > 0, "finger up → look up");
  assert.equal(lookFromDrag(0, 0, 0, -1e6).pitch, PITCH_LIMIT);
});

test("tap: short and still, not a drag or a long press", () => {
  assert.equal(isTap(3, 120), true);
  assert.equal(isTap(20, 120), false);
  assert.equal(isTap(3, 900), false);
  // A finger gets more room than a mouse.
  assert.equal(isTap(10, 120, tapSlop("mouse")), false);
  assert.equal(isTap(10, 120, tapSlop("touch")), true);
  assert.equal(isTap(20, 120, tapSlop("touch")), false);
});

test("fov: a portrait phone gets a wide enough view; zoom narrows it", () => {
  close(verticalFov(16 / 9), 60, 1e-9); // landscape keeps the base angle
  const portrait = verticalFov(390 / 844);
  const horizontal = (2 * Math.atan(Math.tan((portrait * Math.PI) / 360) * (390 / 844)) * 180) / Math.PI;
  assert.ok(portrait > 60 && portrait <= 100);
  assert.ok(horizontal > 40, `only ${horizontal.toFixed(1)}° across`);
  assert.ok(verticalFov(16 / 9, 2) < 60);
});

test("path: length and points along it", () => {
  const pts = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 4 }];
  assert.equal(pathLength(pts), 7);
  assert.deepEqual(pointAlong(pts, 5), { x: 3, z: 2 });
  assert.deepEqual(pointAlong(pts, 99), { x: 3, z: 4 });
  assert.deepEqual(pointAlong(pts, -1), { x: 0, z: 0 });
});

/** Every point of every leg of a route is walkable. */
function assertWalkableRoute(from: Point, route: Point[]) {
  const pts = [from, ...route];
  for (let i = 1; i < pts.length; i++) {
    for (let t = 0; t <= 1; t += 0.01) {
      const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
      const z = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t;
      assert.ok(isWalkable(x, z), `leg ${i} at t=${t.toFixed(2)}: (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
}

test("planRoute: from anywhere on the square into any shop, without a wall", () => {
  const starts: Point[] = [START_POSE, { x: 0, z: 15 }, { x: 0, z: -15 }, { x: 15, z: 10 }, { x: -18, z: -6 }];
  for (const from of starts) {
    for (const shop of SHOPS) assertWalkableRoute(from, planRoute(from, shopFrontPose(shop)));
    assertWalkableRoute(from, planRoute(from, FOOD_STREET_ENTRY));
    for (const street of STREETS) assertWalkableRoute(from, planRoute(from, gateFrontPose(street)));
  }
});

test("planRoute: out of the street and across the square", () => {
  for (const shop of SHOPS) {
    const from = shopFrontPose(shop);
    assertWalkableRoute(from, planRoute(from, SQUARE_FROM_FOOD));
    assertWalkableRoute(from, planRoute(from, START_POSE));
    for (const street of STREETS) assertWalkableRoute(from, planRoute(from, gateFrontPose(street)));
  }
});

test("nearestWalkable: a tap on the arcade walks up to it", () => {
  const p = nearestWalkable({ x: 0, z: 10 }, { x: 0, z: 30 });
  assert.ok(isWalkable(p.x, p.z));
  assert.ok(p.z > WALK_RADIUS - 0.01 && p.z <= WALK_RADIUS);
});

const DEG = Math.PI / 180;

test("tilt: a level phone (under 10°) never turns the body", () => {
  assert.equal(tiltTurnRate(0), 0);
  assert.equal(tiltTurnRate(TILT_FREE * 0.99), 0);
  assert.equal(tiltTurnRate(-TILT_FREE * 0.99), 0);
});

test("tilt: past 10° the body turns that way at once, faster the more it tilts", () => {
  assert.ok(tiltTurnRate(15 * DEG) > 0, "tilted left → turns left");
  assert.ok(tiltTurnRate(-15 * DEG) < 0, "tilted right → turns right");
  assert.ok(tiltTurnRate(30 * DEG) > tiltTurnRate(15 * DEG));
  close(tiltTurnRate(30 * DEG), 50 * DEG, 1e-9); // 20° past → 50°/s
  assert.equal(tiltTurnRate(89 * DEG), TILT_TURN_MAX, "capped");
});

test("tilt: holding a 25° tilt for 2 s turns you round, and levelling stops it", () => {
  let body = 0;
  for (let t = 0; t < 2; t += 1 / 60) body += tiltTurnRate(25 * DEG) / 60;
  assert.ok(body / DEG > 60, `${(body / DEG).toFixed(0)}°`);
  const before = body;
  for (let t = 0; t < 1; t += 1 / 60) body += tiltTurnRate(3 * DEG) / 60;
  assert.equal(body, before);
});

test("tilt: looking steeply up or down never turns you", () => {
  assert.equal(tiltTurnRate(30 * DEG, 70 * DEG), 0);
  assert.equal(tiltTurnRate(30 * DEG, -70 * DEG), 0);
  assert.ok(tiltTurnRate(30 * DEG, 20 * DEG) > 0);
});

test("window shopping: each stop is a walkable spot with a shop either side", () => {
  for (const x of STREET_STOPS) assert.equal(isWalkable(x, 0), true, `x=${x}`);
  for (const shop of SHOPS) assert.ok(STREET_STOPS.includes(shop.x), `${shop.id} has a stop`);
});

test("window shopping: one press, the next pair of shops", () => {
  assert.equal(nextStop(FOOD_STREET_ENTRY.x, 1), 28);
  assert.equal(nextStop(28, 1), 34, "standing at a stop moves on");
  assert.equal(nextStop(28.3, 1), 34);
  assert.equal(nextStop(30, 1), 34);
  assert.equal(nextStop(30, -1), 28);
  assert.equal(nextStop(58, 1), null, "the end of the street");
  assert.equal(nextStop(FOOD_STREET_ENTRY.x, -1), null, "the gate");
});

test("window shopping: forward is the way you face along the street", () => {
  const east = yawToward(1, 0);
  const west = yawToward(-1, 0);
  const atShop = yawToward(0, -1);
  assert.equal(streetDirection(east, true), 1);
  assert.equal(streetDirection(east, false), -1);
  assert.equal(streetDirection(west, true), -1, "facing the gate, forward goes back out");
  assert.equal(streetDirection(atShop, true), 1, "facing a shop, forward goes deeper");
  assert.equal(streetDirection(atShop, false), -1);
});

test("walking: a stroll that eases in, so a short press barely moves", () => {
  assert.equal(walkSpeed(0, false), 0);
  close(walkSpeed(WALK_EASE_IN_S, false), STROLL_SPEED, 1e-9);
  // Distance covered while a quick press is held: under 15 cm.
  let d = 0;
  for (let t = 0; t < STEP_PRESS_S; t += 1 / 60) d += walkSpeed(t, false) / 60;
  assert.ok(d < 0.15, `${d.toFixed(3)} m`);
  assert.ok(walkSpeed(10, true) > walkSpeed(10, false));
});
