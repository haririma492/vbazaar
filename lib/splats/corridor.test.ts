// Walls from the cameraman's route: free inside the lane, sliding along its
// edge, the eye at the filmed height, and shops entered only through a door.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { doorLane, inReach, keepInside, type Lane, type Vec3 } from "./corridor.ts";

/** An alley down −z, 20 long, eye height rising from 1.6 to 2.0. */
const ALLEY: Lane = { route: [[0, 1.6, 0], [0, 1.8, -10], [0, 2.0, -20]], half: 1 };

test("inside the lane: left where one stands, eye at the route's height", () => {
  const r = keepInside([ALLEY], 0.5, -5);
  assert.deepEqual([r.x, r.z, r.outside], [0.5, -5, 0]);
  assert.ok(Math.abs(r.y! - 1.7) < 1e-9);
});

test("past a wall: back to the edge, keeping the step along the alley", () => {
  const r = keepInside([ALLEY], 1.4, -7);
  assert.ok(Math.abs(r.x - 1) < 1e-9);
  assert.equal(r.z, -7); // walking down the alley is never stopped
  assert.ok(Math.abs(r.outside - 0.4) < 1e-9);
});

test("the alley's end is round: one stops there, not through it", () => {
  const r = keepInside([ALLEY], 0, -23);
  assert.ok(Math.abs(r.z + 21) < 1e-9);
});

test("at a junction the lane one is least outside wins: either way is open", () => {
  const side: Lane = { route: [[0, 1.6, -10], [10, 1.6, -10]], half: 1 };
  const r = keepInside([ALLEY, side], 5, -10.5);
  assert.deepEqual([r.x, r.z, r.lane], [5, -10.5, 1]);
});

test("no route: no walls", () => {
  const r = keepInside([], 40, 40);
  assert.deepEqual([r.x, r.z, r.y], [40, 40, null]);
});

test("a door opens a narrow lane from the alley, through it, into the shop", () => {
  const lane = doorLane([ALLEY.route], { id: "shop", at: [2, 0, -5], depth: 3 }, 1);
  assert.deepEqual(lane.route[0].map((v) => Math.round(v * 100) / 100), [0, 1.7, -5]);
  assert.deepEqual(lane.route[2].map((v) => Math.round(v * 100) / 100), [5, 1.7, -5]);
  assert.ok(lane.half < 1);
  // Inside the shop is walkable only with the door open.
  assert.ok(keepInside([ALLEY], 4, -5).outside > 0);
  assert.equal(keepInside([ALLEY, lane], 4, -5).outside, 0);
});

test("going in: near the door and facing it", () => {
  const at: Vec3 = [2, 0, -5];
  const right = Math.PI / 2; // facing +x
  assert.ok(inReach(at, 0, -5, right) !== null);
  assert.equal(inReach(at, 0, -5, -right), null); // back turned
  assert.equal(inReach(at, 0, -5, 0), null); // looking down the alley
  assert.equal(inReach(at, -5, -5, right), null); // too far
});
