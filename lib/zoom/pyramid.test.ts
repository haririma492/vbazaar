import { test } from "node:test";
import assert from "node:assert/strict";
import { baseLevel, baseOf, clampView, fitScale, levelFor, levelSize, MAX_SCALE, parsePyramid, tileUrl, visibleTiles, zoomAbout, type Pyramid } from "./pyramid.ts";

// The stitcher's own answer for the test shelf: 5604×17842 (100 MP), 512 px tiles.
const P: Pyramid = { type: "dzi", w: 5604, h: 17842, tile: 512, overlap: 0, format: "jpg", maxLevel: 15, files: "shelf_files", thumb: "thumb.jpg" };

test("a manifest is read, and what is not one is refused", () => {
  assert.deepEqual(parsePyramid(JSON.parse(JSON.stringify(P))), P);
  assert.equal(parsePyramid({ ...P, files: "../x" }), null);
  assert.equal(parsePyramid({ ...P, w: 0 }), null);
  assert.equal(parsePyramid(null), null);
});

test("the levels are Deep Zoom's: the top one is the photo, each below half, the base one a single tile", () => {
  assert.deepEqual(levelSize(P, 15), { w: 5604, h: 17842, cols: 11, rows: 35, shrink: 1 });
  assert.deepEqual(levelSize(P, 14), { w: 2802, h: 8921, cols: 6, rows: 18, shrink: 2 });
  assert.equal(baseLevel(P), 9);
  const b = levelSize(P, baseLevel(P));
  assert.equal(b.cols * b.rows, 1);
  // 545 tiles in all, as the stitcher counted.
  let n = 0;
  for (let l = 0; l <= P.maxLevel; l++) { const s = levelSize(P, l); n += s.cols * s.rows; }
  assert.equal(n, 545);
});

test("the level drawn is the first at least as sharp as the screen, never past the photo's own pixels", () => {
  assert.equal(levelFor(P, 1), 15);
  assert.equal(levelFor(P, 0.5), 14);
  assert.equal(levelFor(P, 0.3), 14);
  assert.equal(levelFor(P, 0.25), 13);
  assert.equal(levelFor(P, 0.25, 2), 14, "a phone's sharper screen takes the next level");
  assert.equal(levelFor(P, 2), 15);
  assert.equal(levelFor(P, 0.0001), baseLevel(P));
});

test("only the tiles on screen are asked for", () => {
  // A 1000×700 viewport at full size on the photo's middle: 3×2 or 3×3 tiles of 187 at this level, not hundreds.
  const tiles = visibleTiles(P, 15, { cx: 2800, cy: 9000, scale: 1 }, 1000, 700);
  assert.ok(tiles.length <= 9 && tiles.length >= 4, String(tiles.length));
  for (const t of tiles) assert.ok(t.x < 3300 && t.x + t.w > 2300 && t.y < 9350 && t.y + t.h > 8650);
  // The whole photo fitted in 700 px of height: level 11 (351×1116), its three tiles, and no more.
  const fit = fitScale(P, 1000, 700);
  assert.equal(levelFor(P, fit), 11);
  assert.equal(visibleTiles(P, levelFor(P, fit), { cx: P.w / 2, cy: P.h / 2, scale: fit }, 1000, 700).length, 3);
  // The last column and row are the photo's ragged edge, not a whole tile.
  const edge = visibleTiles(P, 15, { cx: P.w, cy: P.h, scale: 1 }, 400, 400).at(-1)!;
  assert.equal(edge.x + edge.w, P.w);
  assert.equal(edge.y + edge.h, P.h);
  assert.equal(tileUrl(baseOf("https://cdn.x/scenes/store-a/zoom/g1/manifest.json"), P, { level: 15, col: 3, row: 7 }), "https://cdn.x/scenes/store-a/zoom/g1/shelf_files/15/3_7.jpg");
});

test("a shopper cannot pan off the shelf, nor zoom out past the whole shelf, nor in past twice its pixels", () => {
  const vw = 1000, vh = 700, fit = fitScale(P, vw, vh);
  // Dragged far past the top-left corner at full size: stopped with the photo's corner in the viewport's corner.
  assert.deepEqual(clampView(P, { cx: -5000, cy: -5000, scale: 1 }, vw, vh), { cx: 500, cy: 350, scale: 1 });
  assert.deepEqual(clampView(P, { cx: 1e6, cy: 1e6, scale: 1 }, vw, vh), { cx: P.w - 500, cy: P.h - 350, scale: 1 });
  // Zoomed out too far: the whole shelf, in the middle.
  assert.deepEqual(clampView(P, { cx: 10, cy: 10, scale: fit / 10 }, vw, vh), { cx: P.w / 2, cy: P.h / 2, scale: fit });
  assert.equal(clampView(P, { cx: 100, cy: 100, scale: 50 }, vw, vh).scale, MAX_SCALE);
  // Fitted by height: narrower than the viewport, so centred sideways whatever is asked.
  assert.equal(clampView(P, { cx: 0, cy: 9000, scale: fit * 1.2 }, vw, vh).cx, P.w / 2);
});

test("zooming keeps the point under the finger where it is", () => {
  const vw = 1000, vh = 700, v = { cx: 2800, cy: 9000, scale: 0.5 };
  const sx = 700, sy = 200;
  const before = { x: v.cx + (sx - vw / 2) / v.scale, y: v.cy + (sy - vh / 2) / v.scale };
  const z = zoomAbout(P, v, 1.5, sx, sy, vw, vh);
  assert.ok(Math.abs(z.cx + (sx - vw / 2) / z.scale - before.x) < 1e-6);
  assert.ok(Math.abs(z.cy + (sy - vh / 2) / z.scale - before.y) < 1e-6);
});
