// Following the photographer: a dark figure on a light store, moving round.
//
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { ZONE_H, ZONE_W, columnHistograms, shotBreaks, stretchesOf, zoneThroughWalk } from "./trackZone.ts";

/** A light frame with a dark-orange figure 60° wide centred on `deg` (`room` 1: another place, other colours). */
function frame(deg: number, room = 0): Float32Array {
  const rgba = new Uint8ClampedArray(ZONE_W * ZONE_H * 4);
  for (let y = 0; y < ZONE_H; y++) {
    for (let x = 0; x < ZONE_W; x++) {
      const p = (y * ZONE_W + x) * 4;
      const d = ((((x - 180 - deg) % 360) + 540) % 360) - 180;
      const person = Math.abs(d) < 30;
      const tile = (x >> 3) % 2 ? 230 : 200; // a patterned light store
      rgba[p] = person ? (y % 2 ? 30 : 220) : room ? 60 : tile;
      rgba[p + 1] = person ? (y % 2 ? 30 : 90) : room ? tile - 120 : tile;
      rgba[p + 2] = person ? 30 : room ? tile : tile - 20;
      rgba[p + 3] = 255;
    }
  }
  return columnHistograms(rgba);
}

test("the zone follows the photographer round the picture, through the seam, both ways from a lock", () => {
  const path = Array.from({ length: 40 }, (_, i) => 120 + i * 4); // 120° … 276° (= −84°): across ±180
  const frames = path.map((d) => frame(d));
  assert.deepEqual(shotBreaks(frames), [], "walking and turning is not a cut");
  const rad = (d: number) => (d * Math.PI) / 180;
  const at = zoneThroughWalk(frames, 0.5, [{ t: 10, yaw: rad(path[20] > 180 ? path[20] - 360 : path[20]), width: rad(60) }]);
  assert.equal(at.length, 40);
  for (let i = 0; i < 40; i++) {
    const want = ((path[i] + 180) % 360) - 180;
    const got = (at[i].yaw * 180) / Math.PI;
    const err = Math.abs(((got - want + 540) % 360) - 180);
    assert.ok(err <= 3, `frame ${i}: ${got.toFixed(0)}° for ${want}°`);
  }
});

test("a cut in the walk: found, and the lock never follows or blends across it (Saraye Bamdad, 1:28–1:33)", () => {
  // 20 frames in one place (the operator at 100°), then a cut to another place (the operator at −60°).
  const path = [...Array.from({ length: 20 }, (_, i) => 100 + i), ...Array.from({ length: 20 }, (_, i) => -60 + i)];
  const frames = path.map((d, i) => frame(d, i < 20 ? 0 : 1));
  assert.deepEqual(shotBreaks(frames), [20]);
  assert.deepEqual(stretchesOf(40, [20]), [[0, 20], [20, 40]]);
  const rad = (d: number) => (d * Math.PI) / 180;
  const locks = [{ t: 2, yaw: rad(path[4]), width: rad(60) }, { t: 15, yaw: rad(path[30]), width: rad(60) }];
  const at = zoneThroughWalk(frames, 0.5, locks, shotBreaks(frames));
  for (let i = 0; i < 40; i++) {
    const got = (at[i].yaw * 180) / Math.PI;
    const err = Math.abs(((got - path[i] + 540) % 360) - 180);
    assert.ok(err <= 4, `frame ${i}: ${got.toFixed(0)}° for ${path[i]}°`);
  }
  // Without the cut known, the blend across it puts the lock beside the operator before the cut.
  const blind = zoneThroughWalk(frames, 0.5, locks);
  assert.ok(blind.some((z, i) => Math.abs(((((z.yaw * 180) / Math.PI) - path[i] + 540) % 360) - 180) > 10), "the old way was off");
});
