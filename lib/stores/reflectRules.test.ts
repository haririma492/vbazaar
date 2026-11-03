// The photographer's reflection: where it is, between looks, and the mask (`reflectRules.ts`).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { MASK_H, MASK_W, STEP, STRIP_H, STRIP_W, boxesAt, looks, maskFrame, stripBoxToSeen } from "./reflectRules.ts";

test("a box in a strip becomes a direction on the panorama", () => {
  const s = stripBoxToSeen(10, [STRIP_W / 2 - 32, 0, STRIP_W / 2 + 32, STRIP_H])!;
  assert.ok(Math.abs(s.yaw) < 0.5);
  assert.ok(Math.abs(s.width - 15) < 0.1);
  assert.equal(s.top, 35);
  assert.equal(s.bottom, -40);
  assert.equal(stripBoxToSeen(1, [0, 0, 1, 1]), null, "too small to be anything");
  assert.equal(stripBoxToSeen(1, [0, 0, STRIP_W * 0.6, 50]), null, "half the street is not a reflection");
});

test("a reflection seen twice is carried smoothly between the looks", () => {
  const a = { t: 10, yaw: 20, width: 10, top: 10, bottom: -10 };
  const b = { t: 10 + STEP, yaw: 30, width: 10, top: 10, bottom: -10 };
  const mid = boxesAt([a, b], 10 + STEP / 2, 0);
  assert.equal(mid.length, 1);
  assert.ok(Math.abs(mid[0].yaw - 25) < 1e-9);
});

test("a reflection seen once is softened half a step either side, and not beyond", () => {
  const a = { t: 10, yaw: -170, width: 10, top: 5, bottom: -5 };
  assert.equal(boxesAt([a], 10 + STEP / 2 - 0.01).length, 1);
  assert.equal(boxesAt([a], 10 - STEP / 2 + 0.01).length, 1);
  assert.equal(boxesAt([a], 10 + STEP).length, 0);
});

test("two reflections far apart are not joined", () => {
  const a = { t: 10, yaw: 0, width: 10, top: 5, bottom: -5 };
  const b = { t: 10 + STEP, yaw: 120, width: 10, top: 5, bottom: -5 };
  const mid = boxesAt([a, b], 10 + STEP / 2, 0);
  assert.ok(mid.every((x) => Math.abs(x.yaw - 60) > 30), "nothing carried across the gap between them");
});

test("the mask wraps round the back of the panorama", () => {
  const m = maskFrame([{ t: 0, yaw: 180, width: 20, top: 10, bottom: -10 }]);
  const row = Math.floor(MASK_H / 2);
  assert.equal(m[row * MASK_W + 0], 255, "left edge");
  assert.equal(m[row * MASK_W + MASK_W - 1], 255, "right edge");
  assert.equal(m[row * MASK_W + MASK_W / 2], 0, "the front is untouched");
});

test("a 108 s walk is looked at in about 18 looks", () => {
  const l = looks(108);
  assert.equal(l.flat().length, 54);
  assert.equal(l.length, 18);
});
