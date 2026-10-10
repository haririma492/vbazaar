// The photographer's turns, read from the picture: a band round the horizon
// comes back rotated by the turn.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { TURN_COLS, bandProfile, ringShift, turnRate } from "./walkTurn.ts";

/** A horizon band of a made-up street: blobs of light and dark round the ring, `rot` columns turned. */
function band(rot: number, w = TURN_COLS, h = 6, seed = 7): Uint8ClampedArray {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blobs = Array.from({ length: 18 }, () => ({ at: rnd() * w, wide: 2 + rnd() * 10, v: rnd() * 200 }));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let x = 0; x < w; x++) {
    // What the camera shows in column x, turned `rot` columns right, is the world's x + rot.
    const wx = x + rot;
    let v = 30;
    for (const b of blobs) {
      const d = Math.min(Math.abs(wx - b.at), w - Math.abs(wx - b.at));
      v += b.v * Math.exp(-(d * d) / (2 * b.wide * b.wide));
    }
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = Math.min(255, v + (y % 2) * 3);
      out[i + 3] = 255;
    }
  }
  return out;
}

test("a camera turned right reads as a positive shift, to a fraction of a column", () => {
  const a = bandProfile(band(0), TURN_COLS, 6);
  for (const rot of [0, 3, -5, 2.5, 12]) {
    const r = ringShift(a, bandProfile(band(rot), TURN_COLS, 6), 32);
    assert.ok(Math.abs(r.shift - rot) < 0.35, `turned ${rot}: read ${r.shift}`);
    assert.ok(r.score > 0.9);
  }
});

test("the shift becomes radians per second of video", () => {
  // A quarter of the ring in 2 s: a right-angle corner, taken at walking pace.
  assert.ok(Math.abs(turnRate(TURN_COLS / 4, TURN_COLS, 2) - Math.PI / 4) < 1e-12);
  assert.equal(turnRate(5, TURN_COLS, 0), 0);
});

test("a flat grey band has no profile (and no turn to read)", () => {
  const grey = new Uint8ClampedArray(TURN_COLS * 4 * 4).fill(128);
  assert.ok(bandProfile(grey, TURN_COLS, 4).every((v) => v === 0));
});
