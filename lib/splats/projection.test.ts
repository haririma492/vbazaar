// YouTube's 360° layout (Equi-Angular Cubemap): where each direction lies in
// the frame. The face layout was matched against ffmpeg's v360=e:eac.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { eacUv } from "./projection.ts";

const near = (a: { u: number; v: number }, u: number, v: number) => Math.abs(a.u - u) < 1e-9 && Math.abs(a.v - v) < 1e-9;

test("each face's middle is the middle of its cell: left · front · right / down · back · up", () => {
  assert.ok(near(eacUv(0, 0), 0.5, 0.25), "front");
  assert.ok(near(eacUv(Math.PI / 2, 0), 5 / 6, 0.25), "right");
  assert.ok(near(eacUv(-Math.PI / 2, 0), 1 / 6, 0.25), "left");
  assert.ok(near(eacUv(Math.PI, 0), 0.5, 0.75), "back");
  assert.ok(near(eacUv(0, Math.PI / 2 - 1e-9), 5 / 6, 0.75), "up");
  assert.ok(near(eacUv(0, -Math.PI / 2 + 1e-9), 1 / 6, 0.75), "down");
});

test("the grid is by angle: 22.5° right of front is halfway to the face's 45° edge", () => {
  const p = eacUv((22.5 * Math.PI) / 180, 0);
  assert.ok(Math.abs(p.u - (1 + 0.75) / 3) < 1e-9);
});

test("looking right across the front face's edge lands on the right face's left edge", () => {
  const a = eacUv(Math.PI / 4 - 1e-6, 0), b = eacUv(Math.PI / 4 + 1e-6, 0);
  assert.ok(Math.abs(a.u - 2 / 3) < 1e-5 && Math.abs(b.u - 2 / 3) < 1e-5);
});
