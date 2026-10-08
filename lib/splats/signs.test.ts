// A replaced sign's geometry: corners clicked in any order, its frame, the
// plane a missed click falls back to, and the box of old splats hidden.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { HIDE_BACK, HIDE_FRONT, glowGain, grow, hideBox, lift, orderCorners, planeOf, rayPlane, signFrame, type Corners, type Vec3 } from "./signs.ts";

const near = (a: number[], b: number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

// A 2 × 0.6 board on a shop front at z = −5, seen from the street (z = 0).
const TL: Vec3 = [-1, 3, -5], TR: Vec3 = [1, 3, -5], BR: Vec3 = [1, 2.4, -5], BL: Vec3 = [-1, 2.4, -5];
const EYE: Vec3 = [0, 1.6, 0];

test("corners clicked in any order come out top-left, top-right, bottom-right, bottom-left", () => {
  for (const order of [[TL, TR, BR, BL], [BR, TL, BL, TR], [BL, BR, TR, TL], [TR, BL, TL, BR]] as Vec3[][]) {
    assert.deepEqual(orderCorners(order, EYE), [TL, TR, BR, BL]);
  }
  // Seen from the other side (inside the shop), left and right swap.
  assert.deepEqual(orderCorners([TL, TR, BR, BL], [0, 1.6, -10]), [TR, TL, BL, BR]);
  // A tall, narrow board on a side wall (x = 3), seen from the alley.
  const side: Vec3[] = [[3, 4, -2], [3, 4, -2.5], [3, 1, -2.5], [3, 1, -2]];
  assert.deepEqual(orderCorners([side[2], side[0], side[3], side[1]], [0, 1.6, -2.2]), [[3, 4, -2.5], [3, 4, -2], [3, 1, -2], [3, 1, -2.5]]);
  // Three points, or four in a line, are no sign.
  assert.equal(orderCorners([TL, TR, BR], EYE), null);
  assert.equal(orderCorners([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], EYE), null);
});

test("a board slightly out of true (clicks are never exact) is still ordered", () => {
  const wobbly: Vec3[] = [[-1.02, 3.01, -5.03], [0.98, 2.97, -4.96], [1.01, 2.42, -5.02], [-0.99, 2.38, -4.98]];
  const got = orderCorners([wobbly[3], wobbly[1], wobbly[0], wobbly[2]], EYE)!;
  assert.deepEqual(got, wobbly);
});

test("the sign's frame faces the street; its size is the board's", () => {
  const f = signFrame([TL, TR, BR, BL])!;
  assert.ok(near(f.center, [0, 2.7, -5]));
  assert.ok(near(f.right, [1, 0, 0]) && near(f.up, [0, 1, 0]) && near(f.out, [0, 0, 1]));
  assert.ok(Math.abs(f.width - 2) < 1e-9 && Math.abs(f.height - 0.6) < 1e-9);
  assert.equal(signFrame([TL, TL, TL, TL]), null);
});

test("the image is lifted toward the street, the backing grown round it", () => {
  const c: Corners = [TL, TR, BR, BL];
  assert.ok(near(lift(c, 0.02)[0], [-1, 3, -4.98]));
  const g = grow(c, 0.03);
  assert.ok(near(g[0], [-1.03, 3.03, -5]) && near(g[2], [1.03, 2.37, -5]));
});

test("the hidden box spans the board and its cover, just in front of it to behind it", () => {
  const b = hideBox([TL, TR, BR, BL], 0.03)!;
  assert.ok(near(b.half, [1 + 0.05, 0.3 + 0.05, (HIDE_FRONT + HIDE_BACK) / 2]));
  // Its front face is HIDE_FRONT in front of the board; its back HIDE_BACK behind.
  assert.ok(Math.abs(b.center[2] + b.half[2] - (-5 + HIDE_FRONT)) < 1e-9);
  assert.ok(Math.abs(b.center[2] - b.half[2] - (-5 - HIDE_BACK)) < 1e-9);
});

test("a click that misses the splats falls on the plane of the corners so far", () => {
  const p = planeOf([TL, TR, BR])!;
  assert.ok(near(p.normal.map(Math.abs), [0, 0, 1]));
  assert.ok(near(rayPlane(EYE, [-1, 0.8, -5], p)!, [-1, 2.4, -5]));
  // Parallel to it, or pointing away: no point.
  assert.equal(rayPlane(EYE, [1, 0, 0], p), null);
  assert.equal(rayPlane(EYE, [0, 0, 1], p), null);
  assert.equal(planeOf([TL, TR]), null);
});

test("glow: a little under full brightness unlit, brighter lit, never beyond", () => {
  assert.ok(glowGain(0) < 1 && glowGain(1) > 1);
  assert.equal(glowGain(5), glowGain(1));
});
