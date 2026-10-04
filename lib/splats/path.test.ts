// The cameraman's route as a tendency: walking forward unsteered, the visitor
// is drawn along it, round its bends, and left alone far from it.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { FADE_TO, angleDiff, guideStep, nearestOnRoute, recordStep, routePull, type Vec3 } from "./path.ts";

/** Down the street (−z) 20, then a right turn (+x) 15 into the mall. */
const ROUTE: Vec3[] = [[0, 0, 0], [0, 0, -10], [0, 0, -20], [7, 0, -20], [15, 0, -20]];
const RIGHT = Math.PI / 2;

test("the nearest point of the route", () => {
  const n = nearestOnRoute(ROUTE, 1, -5)!;
  assert.equal(n.seg, 0);
  assert.ok(Math.abs(n.dist - 1) < 1e-9);
  assert.ok(Math.abs(n.pz + 5) < 1e-9);
  assert.equal(nearestOnRoute([[0, 0, 0]], 0, 0), null);
});

test("on the route and facing along it: no pull", () => {
  assert.ok(Math.abs(routePull(ROUTE, 0, -5, 0)) < 1e-9);
});

test("drifted a little off to the right: drawn back left, onto the route", () => {
  assert.ok(routePull(ROUTE, 1, -5, 0) < 0);
  assert.ok(routePull(ROUTE, -1, -5, 0) > 0);
});

test("at the bend, unsteered: carried round it, to the right", () => {
  // Just before the corner, still facing down the street.
  assert.ok(routePull(ROUTE, 0, -19, 0) > 0);
});

test("walking the route backward is drawn back along it too", () => {
  // Facing +z (heading π), slightly off to the right of the route (x = −1 when facing back).
  const pull = routePull(ROUTE, -1, -5, Math.PI);
  assert.ok(pull < 0, `pull ${pull}`); // toward x = 0, which is the visitor's left when facing back
});

test("the pull fades with distance and is gone beyond its reach", () => {
  const near = Math.abs(routePull(ROUTE, 1, -5, 0.3));
  const farther = Math.abs(routePull(ROUTE, 4, -5, 0.3));
  assert.ok(near > farther && farther > 0, `${near} ${farther}`);
  assert.equal(routePull(ROUTE, FADE_TO + 1, -5, 0), 0);
});

test("beside the route and facing away from it, the visitor means it: no pull", () => {
  // 3 to the right of the street, facing further right (toward a shop): left alone.
  assert.equal(routePull(ROUTE, 3, -5, RIGHT), 0);
  // The same spot facing down the street: drawn back toward it.
  assert.ok(routePull(ROUTE, 3, -5, 0) < 0);
});

test("recording drops a point every half step of walking, not every frame", () => {
  let r: Vec3[] = [];
  for (let z = 0; z >= -3; z -= 0.1) r = recordStep(r, [0, 1.6, z]);
  assert.ok(r.length >= 6 && r.length <= 8, `${r.length}`);
  assert.ok(Math.abs(angleDiff(0.1, 2 * Math.PI)) - 0.1 < 1e-9);
});

test("guided: «go» follows the route round its bend, whichever way one faces", () => {
  // Facing down the street, a little off the route: along it and back onto it.
  const g = guideStep([ROUTE], 0.5, -5, 0.3)!;
  assert.ok(g.dz < -0.9 && g.dx < 0, `${g.dx},${g.dz}`);
  // At the corner, facing roughly right: into the mall (+x).
  const c = guideStep([ROUTE], 0, -19.5, 1.2)!;
  assert.ok(c.dx > 0.7, `${c.dx}`);
  // Facing back up the street: back along it.
  const b = guideStep([ROUTE], 0, -5, Math.PI)!;
  assert.ok(b.dz > 0.9);
});

test("guided: at a fork, the route one faces is the one taken", () => {
  const street: Vec3[] = [[0, 0, 0], [0, 0, -20]];
  const alley: Vec3[] = [[0, 0, -10], [10, 0, -10]];
  assert.equal(guideStep([street, alley], 0, -10, RIGHT * 0.9)!.route, 1);
  assert.equal(guideStep([street, alley], 0, -10, 0.1)!.route, 0);
});

test("guided: far from every route there is nothing to follow", () => {
  assert.equal(guideStep([ROUTE], 50, 50, 0), null);
});
