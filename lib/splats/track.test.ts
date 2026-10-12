// Following a product through a phone video: find the tapped patch again in
// the next frames, stop when it is lost or leaves the frame.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { MIN_MATCH, clampCentre, followStep, matchPatch, patchAt, toGray } from "./track.ts";

const W = 160, H = 240;

/** A made-up shelf: blobs of grey, the whole picture slid by (dx, dy) — the camera walking past. */
function shelf(dx: number, dy: number, seed = 5): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blobs = Array.from({ length: 260 }, () => ({ x: rnd() * W * 1.8, y: rnd() * H, r: 3 + rnd() * 8, v: 40 + rnd() * 200 }));
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 60;
    for (const b of blobs) if ((x + dx - b.x) ** 2 + (y + dy - b.y) ** 2 < b.r * b.r) v = b.v;
    const i = (y * W + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  return toGray(rgba, W, H);
}

test("a patch is found again where the picture slid to", () => {
  const a = shelf(0, 0), b = shelf(6, -3);
  const size = 24;
  const c = clampCentre(80, 120, W, H, size);
  const m = matchPatch(b, W, H, patchAt(a, W, c.x, c.y, size), size, c.x, c.y, 16);
  // The camera moved right 6 and up 3, so the product is 6 left and 3 down on screen.
  assert.equal(m.x, c.x - 6);
  assert.equal(m.y, c.y + 3);
  assert.ok(m.score > 0.99);
});

test("a follow steps with the product and stops at the frame's edge", () => {
  const size = 24;
  let at = clampCentre(40, 120, W, H, size);
  let template = patchAt(shelf(0, 0), W, at.x, at.y, size);
  const xs: number[] = [];
  for (let step = 1; step < 40; step++) {
    // The camera walks right 4 px a step: the product drifts left until it leaves.
    const r = followStep(shelf(step * 4, 0), W, H, template, size, at, 12);
    if (!r) break;
    at = r;
    template = r.template;
    xs.push(r.x);
  }
  assert.ok(xs.length >= 5, `followed ${xs.length} steps`);
  assert.deepEqual(xs.slice(0, 4), [36, 32, 28, 24]);
  assert.ok(xs[xs.length - 1] <= 20, "stopped near the left edge");
});

test("a product that is gone is not followed", () => {
  const size = 24;
  const at = clampCentre(80, 120, W, H, size);
  const template = patchAt(shelf(0, 0), W, at.x, at.y, size);
  const elsewhere = shelf(0, 0, 99); // another shelf altogether
  const r = followStep(elsewhere, W, H, template, size, at, 12);
  assert.ok(r === null || r.score >= MIN_MATCH);
  assert.equal(matchPatch(elsewhere, W, H, new Float32Array(size * size).fill(7), size, at.x, at.y, 4).score, 0, "a flat patch matches nothing");
});
