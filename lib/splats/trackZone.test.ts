// Following the photographer: a dark figure on a light store, moving round.
//
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { ZONE_H, ZONE_W, columnHistograms, zoneThroughWalk } from "./trackZone.ts";

/** A light frame with a dark-orange figure 60° wide centred on `deg`. */
function frame(deg: number): Float32Array {
  const rgba = new Uint8ClampedArray(ZONE_W * ZONE_H * 4);
  for (let y = 0; y < ZONE_H; y++) {
    for (let x = 0; x < ZONE_W; x++) {
      const p = (y * ZONE_W + x) * 4;
      const d = ((((x - 180 - deg) % 360) + 540) % 360) - 180;
      const person = Math.abs(d) < 30;
      const tile = (x >> 3) % 2 ? 230 : 200; // a patterned light store
      rgba[p] = person ? (y % 2 ? 30 : 220) : tile;
      rgba[p + 1] = person ? (y % 2 ? 30 : 90) : tile;
      rgba[p + 2] = person ? 30 : tile - 20;
      rgba[p + 3] = 255;
    }
  }
  return columnHistograms(rgba);
}

test("the zone follows the photographer round the picture, through the seam, both ways from a lock", () => {
  const path = Array.from({ length: 40 }, (_, i) => 120 + i * 4); // 120° … 276° (= −84°): across ±180
  const frames = path.map(frame);
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
