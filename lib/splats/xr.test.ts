// Walking the tour in a headset: the stick walks and snaps, pointing at the
// path lands on it, a door is stood in front of.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { DOOR_GAP, STICK_REST, TELEPORT_REACH, standBefore, stickAxes, stickIntent, teleportOnto, type Vec3 } from "./xr.ts";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("forward on the stick walks forward, squared, with a dead zone", () => {
  assert.equal(stickIntent(0, -1, STICK_REST).forward, 1);
  assert.equal(stickIntent(0, 1, STICK_REST).forward, -1);
  assert.ok(near(stickIntent(0, -0.5, STICK_REST).forward, 0.25));
  assert.equal(stickIntent(0.05, -0.1, STICK_REST).forward, 0);
});

test("a firm sideways push snaps once, and again only after the stick comes back", () => {
  const a = stickIntent(0.9, 0, STICK_REST);
  assert.equal(a.snap, 1);
  const held = stickIntent(0.95, 0, a.state);
  assert.equal(held.snap, 0);
  const back = stickIntent(0.1, 0, held.state);
  assert.equal(back.snap, 0);
  assert.equal(stickIntent(-0.9, 0, back.state).snap, -1);
  // A diagonal mostly forward is a walk, not a turn.
  assert.equal(stickIntent(0.75, -0.9, STICK_REST).snap, 0);
});

test("the stick is axes 2–3 on xr-standard, 0–1 on a two-axis controller", () => {
  assert.deepEqual(stickAxes([0, 0, 0.4, -0.8]), [0.4, -0.8]);
  assert.deepEqual(stickAxes([0.3, -0.2, 0, 0]), [0.3, -0.2]);
  assert.deepEqual(stickAxes([0.3, -0.2]), [0.3, -0.2]);
  assert.deepEqual(stickAxes([]), [0, 0]);
});

/** Down the street (−z), the eye rising from 1.5 to 1.7 along it; and a side alley off to +x. */
const STREET: Vec3[] = [[0, 1.5, 0], [0, 1.7, -10]];
const ALLEY: Vec3[] = [[0, 1.6, -5], [8, 1.6, -5]];

test("pointing at the path lands on it, at the filmed eye height", () => {
  const p = teleportOnto([STREET], 0.4, -5)!;
  assert.ok(near(p[0], 0) && near(p[2], -5) && near(p[1], 1.6));
  // Nearer the alley than the street: the alley.
  const q = teleportOnto([STREET, ALLEY], 4, -5.5)!;
  assert.ok(near(q[0], 4) && near(q[2], -5));
});

test("pointing far from every path goes nowhere", () => {
  assert.equal(teleportOnto([STREET], TELEPORT_REACH + 0.5, -5), null);
  assert.equal(teleportOnto([], 0, 0), null);
  assert.equal(teleportOnto([[[0, 0, 0]]], 0, 0), null);
});

test("a door is stood in front of, facing it", () => {
  // Door 5 ahead (−z): stand DOOR_GAP short of it, heading 0.
  const s = standBefore([0, 1.6, -5], 0, 0);
  assert.ok(near(s.x, 0) && near(s.z, -5 + DOOR_GAP) && near(s.heading, 0));
  // Door to the right (+x): heading +90°.
  assert.ok(near(standBefore([4, 0, 0], 0, 0).heading, Math.PI / 2));
  // Already at it: stay, face it.
  const t = standBefore([0.5, 0, 0], 0, 0);
  assert.ok(near(t.x, 0) && near(t.z, 0) && near(t.heading, Math.PI / 2));
});
