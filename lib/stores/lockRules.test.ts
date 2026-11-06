// The operator under the camera: a tilt lock, not a slice of directions (`lockRules.ts`).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { downForHead, dropStrays, isUnderCamera, seedTimes } from "./lockRules.ts";

// The area-outside walk (2026-11-03): the head fills the bottom of the
// panorama, the agent saw 160–183° wide, the top of the head about −49°.
const outside = [
  { span: 156, headLat: -49 }, { span: 149, headLat: -50 }, { span: 160, headLat: -48 },
  { span: 171, headLat: -49 }, { span: 167, headLat: -51 }, { span: 96, headLat: -47 },
];

test("a head straight under the camera is recognised", () => {
  assert.equal(isUnderCamera(outside), true);
});

test("a person beside or behind the camera is not", () => {
  assert.equal(isUnderCamera([{ span: 40, headLat: 10 }, { span: 60, headLat: -5 }, { span: 50, headLat: 2 }]), false);
  assert.equal(isUnderCamera([]), false);
});

test("the view stops before the screen's bottom edge reaches the head", () => {
  const down = downForHead(outside, 37.5);
  assert.equal(down, -4.5);
  assert.ok(down - 37.5 > -47, "the bottom edge stays above the highest head-top seen");
});

test("the limit stays between −40° and −3°", () => {
  assert.equal(downForHead([{ span: 150, headLat: -10 }], 37.5), -3);
  assert.equal(downForHead([{ span: 150, headLat: -89 }], 37.5), -40);
});

test("the agent looks every ~8 s, at least 6 and at most 30 times", () => {
  assert.equal(seedTimes(152).length, 19);
  assert.equal(seedTimes(20).length, 6);
  assert.equal(seedTimes(1000).length, 30);
  assert.deepEqual(seedTimes(0), []);
  const t = seedTimes(152);
  assert.ok(t[0] > 0 && t[t.length - 1] < 152);
});

test("a look that boxed a passer-by is dropped, the operator's turn is kept", () => {
  const r = (d: number) => (d * Math.PI) / 180;
  const locks = [{ t: 4, yaw: r(-170) }, { t: 12, yaw: r(175) }, { t: 20, yaw: r(20) }, { t: 28, yaw: r(-165) }, { t: 36, yaw: r(-120) }, { t: 44, yaw: r(-80) }];
  dropStrays(locks);
  assert.deepEqual(locks.map((l) => l.t), [4, 12, 28, 36, 44]);
});
