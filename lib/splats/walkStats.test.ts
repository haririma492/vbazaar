import { test } from "node:test";
import assert from "node:assert/strict";
import { fpsOf, ppdOf } from "./walkStats.ts";
import { flatLens } from "./lens.ts";

test("PPD is the picture's width over the angle it spans", () => {
  assert.equal(ppdOf(3840, null, null), 10.7);
  assert.equal(ppdOf(5760, "equirect", null), 16);
  assert.equal(ppdOf(1920, "flat", flatLens(1920, 1080)), 27.4);
  assert.equal(ppdOf(2160, "flat", flatLens(2160, 3840)), ppdOf(3840, "flat", flatLens(3840, 2160)), "a phone held upright has the same sharpness");
  assert.equal(ppdOf(3840, "eac", null), 14.2);
  assert.equal(ppdOf(1920, "flat", null), null);
  assert.equal(ppdOf(0, null, null), null);
});

test("FPS is the smallest step between frames, once seen three times", () => {
  const f = 1001 / 30000;
  assert.equal(fpsOf([f, f, f, f]), 29.97);
  assert.equal(fpsOf([0.04, 0.04, 0.0401, 0.08, 0.12]), 24.99);
  // Played fast: mostly every 2nd or 3rd frame, a single step now and then.
  assert.equal(fpsOf([2 * f, 3 * f, f, 2 * f, f, 2 * f, f]), 29.97);
  assert.equal(fpsOf([f, f]), null, "not sure yet");
  assert.equal(fpsOf([2 * f, 2 * f, 2 * f, f]), null, "one short step is not enough");
  assert.equal(fpsOf([0, -1, 5]), null);
});
