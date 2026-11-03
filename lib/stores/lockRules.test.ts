// The operator under the camera: a tilt lock, not a slice of directions (`lockRules.ts`).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { downForHead, isUnderCamera } from "./lockRules.ts";

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
