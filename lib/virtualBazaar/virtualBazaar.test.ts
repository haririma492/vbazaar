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
  LOOK_FREE, BODY_TURN_MAX, bodyTurnRate, easeTurnRate, headLook, recentreStep, RECENTRE_STILL_S, ARROW_DIRS, arrowAheadFor, arrowFacing, arrowSpot, arrowTarget, arrowYaw, isTurnArrow, turnArrowYaw,
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

/** Plays a phone's path (degrees from the body's start, one per 1/60 s); returns the views, in degrees. */
function play(path: number[]) {
  let body = 0;
  const views: number[] = [];
  for (const d of path) {
    const neck = d * DEG; // the phone's turn from where it pointed when the sensor came on
    body += (bodyTurnRate(neck) / 60);
    views.push((body + headLook(neck)) / DEG);
  }
  return { view: views[views.length - 1], views, body: body / DEG };
}
const move = (a: number, b: number, s: number) =>
  Array.from({ length: Math.round(s * 60) }, (_, i) => a + ((b - a) * (i + 1)) / Math.round(s * 60));
const hold = (a: number, s: number) => Array(Math.round(s * 60)).fill(a);

test("phone turn: within 12° it is only a look, one-for-one — a hand's wander is not a turn", () => {
  const { views, body } = play([...move(0, 11, 0.3), ...hold(11, 3), ...move(11, 0, 0.3)]);
  close(Math.max(...views), 11, 1e-9);
  assert.equal(body, 0);
  close(views[views.length - 1], 0, 1e-9);
});

test("phone turn: past 12° the body turns that way, and keeps turning", () => {
  const { views } = play([...move(0, 40, 0.3), ...hold(40, 2)]);
  // Still turning after 2 s, at full speed (45°/s): the last half-second added ~22°.
  const n = views.length;
  close(views[n - 1] - views[n - 31], 22.5, 1);
  assert.ok(views[n - 1] > 60);
  assert.ok(bodyTurnRate(-30 * DEG) < 0, "the other way, the other way");
});

test("phone turn: back within 10° and the turn stops — no need to check", () => {
  const { views, body } = play([...move(0, 40, 0.3), ...hold(40, 1.5), ...move(40, 0, 0.3), ...hold(0, 2)]);
  const n = views.length;
  close(views[n - 1], views[n - 60], 1e-9);
  assert.ok(body > 40, `turned ${body.toFixed(0)}°`);
  // Facing where the turn took you: the view settles on the body.
  close(views[n - 1], body, 1e-9);
});

test("phone turn: a gentle start, faster the further, capped at 45°/s", () => {
  assert.ok(bodyTurnRate(30 * DEG) > bodyTurnRate(20 * DEG));
  assert.ok(bodyTurnRate(17 * DEG) / DEG < 5, `${(bodyTurnRate(17 * DEG) / DEG).toFixed(1)}°/s just past`);
  close(bodyTurnRate(30 * DEG), BODY_TURN_MAX, 1e-9); // full speed from 30°
  close(BODY_TURN_MAX / DEG, 45, 1e-9);
  assert.equal(bodyTurnRate(170 * DEG), BODY_TURN_MAX);
  assert.equal(bodyTurnRate(LOOK_FREE * 0.99), 0);
  close(headLook(40 * DEG), LOOK_FREE, 1e-12);
  // The speed eases in: a fifth of a second to get most of the way there.
  let r = 0;
  for (let i = 0; i < 12; i++) r = easeTurnRate(r, 1, 1 / 60);
  assert.ok(r > 0.5 && r < 0.8, r.toFixed(2));
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

test("arrows: all four sit in front — the back one too — in a cross", () => {
  for (const h of [0, 1, -2.5, Math.PI]) {
    const fx = -Math.sin(h);
    const fz = -Math.cos(h);
    const ahead = (p: { x: number; z: number }) => p.x * fx + p.z * fz;
    for (const d of ARROW_DIRS) assert.ok(ahead(arrowSpot(d, 0, 0, h)) > 3, `${d} at heading ${h}`);
    assert.ok(ahead(arrowSpot("fwd", 0, 0, h)) > ahead(arrowSpot("back", 0, 0, h)));
    // Left is on the left: turning left (yaw +) from facing is where "left" lies.
    const l = arrowSpot("left", 0, 0, h);
    const r = arrowSpot("right", 0, 0, h);
    const lx = -Math.sin(h + Math.PI / 2);
    const lz = -Math.cos(h + Math.PI / 2);
    assert.ok(l.x * lx + l.z * lz > r.x * lx + r.z * lz);
  }
});

test("arrows: forward and back walk; the side ones turn you 60°", () => {
  const east = yawToward(1, 0);
  assert.ok(arrowTarget("fwd", 0, 0, east).x > 2);
  assert.ok(arrowTarget("back", 0, 0, east).x < -2);
  close(arrowYaw("back", east), east + Math.PI);
  assert.equal(isTurnArrow("left") && isTurnArrow("right") && !isTurnArrow("fwd"), true);
  // Right turns right (yaw −), left turns left (yaw +), by 60°.
  close(turnArrowYaw("right", east), east - 60 * DEG);
  close(turnArrowYaw("left", east), east + 60 * DEG);
  // Facing north then tapping right faces north-east-ish: 60° clockwise.
  const n = turnArrowYaw("right", 0);
  assert.ok(-Math.sin(n) > 0.8, "now looking mostly east");
  // The turn arrows lie facing the visitor's way; the others point their own.
  close(arrowFacing("left", east), east);
  close(arrowFacing("back", east), east + Math.PI);
});

test("arrows: further ahead on a desktop's narrower view, and when looking up", () => {
  assert.ok(arrowAheadFor(60) > arrowAheadFor(100), "desktop 60° vs portrait phone 100°");
  assert.ok(arrowAheadFor(60, 0.2) > arrowAheadFor(60, 0));
  // The near arrow is below the horizon but inside the picture.
  for (const fov of [60, 80, 100]) {
    const ahead = arrowAheadFor(fov);
    const near = ahead - (0.8 * ahead) / 4.2;
    const below = (Math.atan(1.7 / near) * 180) / Math.PI;
    assert.ok(below < fov / 2, `fov ${fov}: ${below.toFixed(1)}° below`);
  }
});

test("centre: follows where the phone is held, so left and right turn alike", () => {
  // The sensor woke with the phone 8° to the left of where it is now held.
  let centre = 8 * DEG;
  let body = 0;
  const phone = 0;
  const view0 = body + headLook(phone - centre);
  for (let t = 0; t < 15; t += 1 / 60) {
    const d = recentreStep(phone - centre, 1 / 60);
    centre += d;
    body += d;
    // The picture never moves while it does.
    close(body + headLook(phone - centre), view0, 1e-9);
  }
  close(centre, 0, 0.01 * DEG);
  // Now 20° either way is past the zone by the same amount.
  close(Math.abs(bodyTurnRate(20 * DEG - centre)), Math.abs(bodyTurnRate(-20 * DEG - centre)), 1e-3);
});

test("centre: never slides during a turn", () => {
  assert.equal(recentreStep(LOOK_FREE + 0.01, 1 / 60), 0);
  assert.equal(recentreStep(-(LOOK_FREE + 0.01), 1 / 60), 0);
});

test("centre: never chases a phone that is on its way out", () => {
  // Turning slowly towards 20°, one degree at a time: never still, so the
  // reference stays and the body starts turning at 12° as it should.
  let centre = 0;
  for (let d = 0; d <= 20; d += 0.05) centre += recentreStep(d * DEG - centre, 1 / 60, 0);
  assert.equal(centre, 0);
  assert.equal(recentreStep(5 * DEG, 1 / 60, RECENTRE_STILL_S * 0.9), 0);
  assert.ok(recentreStep(5 * DEG, 1 / 60, RECENTRE_STILL_S) > 0);
});
