// Joining by the pictures: the common area both films saw is fitted onto
// itself, even from a poor first guess.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { register, thin, type Place } from "./register.ts";

/** mulberry32: a small, well-spread repeatable random. */
function rand(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hall: floor, walls with a doorway, a few pillars and shop fronts — something with shape. */
function hall(r: () => number, n: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.35) pts.push(r() * 16 - 8, 0, r() * 16 - 8); // floor
    else if (k < 0.55) pts.push(-8, r() * 4, r() * 16 - 8); // west wall
    else if (k < 0.7) pts.push(r() * 16 - 8, r() * 4, -8); // north wall
    else if (k < 0.8) { const z = r() * 16 - 8; if (Math.abs(z) > 1.5) pts.push(8, r() * 4, z); } // east wall, a doorway
    else { const c = [[-3, -2], [2, 3], [4, -4]][Math.floor(r() * 3)]; const a = r() * 6.283; pts.push(c[0] + 0.5 * Math.cos(a), r() * 4, c[1] + 0.5 * Math.sin(a)); } // pillars
  }
  return pts;
}

const inverse = (p: Place, x: number, y: number, z: number) => {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const X = (x - p.offset[0]) / p.scale, Y = (y - p.offset[1]) / p.scale, Z = (z - p.offset[2]) / p.scale;
  return [X * c - Z * s, Y, X * s + Z * c];
};

function joinCase(truth: Place, guess: Place, seed: number) {
  const r = rand(seed);
  const a = hall(r, 20000);
  // The second scene: the same hall (its own noisy points) in its own coordinates, plus an alley the first never saw.
  const b: number[] = [];
  for (const [i, v] of hall(rand(99), 15000).entries()) b.push(v + (r() - 0.5) * 0.04 * (i % 3 === 1 ? 0 : 1));
  const bl: number[] = [];
  for (let i = 0; i < b.length; i += 3) bl.push(...inverse(truth, b[i], b[i + 1], b[i + 2]));
  for (let i = 0; i < 4000; i++) bl.push(...inverse(truth, 8 + r() * 10, r() * 4, (r() - 0.5) * 3));
  const fit = register(Float32Array.from(a), Float32Array.from(bl), guess, 2)!;
  const yawErr = Math.abs(Math.atan2(Math.sin(fit.place.yaw - truth.yaw), Math.cos(fit.place.yaw - truth.yaw)));
  assert.ok(yawErr < 0.03, `yaw off by ${yawErr}`);
  assert.ok(Math.hypot(fit.place.offset[0] - truth.offset[0], fit.place.offset[2] - truth.offset[2]) < 0.15, `offset ${fit.place.offset}`);
  assert.ok(Math.abs(fit.place.offset[1] - truth.offset[1]) < 0.1, `height ${fit.place.offset[1]}`);
  assert.ok(Math.abs(fit.place.scale - truth.scale) < 0.03, `scale ${fit.place.scale}`);
  assert.ok(fit.share > 0.5);
}

test("the second film's view of the hall is laid onto the first's, from a guess 50° and 1.5 off", () => {
  joinCase({ offset: [3, 0.4, -2], yaw: 1.1, scale: 1.08 }, { offset: [4.5, 0.4, -0.5], yaw: 1.97, scale: 1 }, 7);
});

test("…and from a guess turned the wrong way round, the second film a little smaller", () => {
  joinCase({ offset: [-1, -0.2, 4], yaw: -2.5, scale: 0.9 }, { offset: [0, 0, 2], yaw: 0.4, scale: 1 }, 11);
});

test("thinning keeps the shape, not the count", () => {
  const pts = Float32Array.from(hall(rand(3), 50000));
  const t = thin(pts, 5000);
  assert.ok(t.length / 3 <= 5000 && t.length / 3 > 2000);
});

test("too few points: no answer rather than a wrong one", () => {
  assert.equal(register(new Float32Array(9), new Float32Array(9), { offset: [0, 0, 0], yaw: 0, scale: 1 }), null);
});
