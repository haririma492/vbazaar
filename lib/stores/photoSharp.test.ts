// The product photo (`photoSharp.ts`): the video's own pixels, and a cut walk's times taken back to the upload's.
import test from "node:test";
import assert from "node:assert/strict";
import { nativeSize, originalTime } from "./photoSharp.ts";

test("a photo is as many pixels as the product covers in the source, never blown up much", () => {
  // A 0.3 rad view on an 8K (7680) panorama: 367 px of source → 458 → at least MIN_PX.
  assert.equal(nativeSize(0.3, 7680), 480);
  assert.equal(nativeSize(0.8, 7680), 1222);
  assert.equal(nativeSize(0.8, 3840), 612);
});

test("a time in the cut walk is the same moment in the original", () => {
  const parts = [{ from: 0, to: 10 }, { from: 20, to: 25 }, { from: 40, to: 50 }];
  assert.equal(originalTime(parts, 5), 5);
  assert.equal(originalTime(parts, 12), 22);
  assert.equal(originalTime(parts, 16), 41);
  assert.equal(originalTime(parts, 30), 50, "past the end: the last moment");
});
