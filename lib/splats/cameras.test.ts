// The route from a reconstruction's exported cameras: both common shapes,
// filming order, the viewer's upright turn, thinning.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { routeFromCameras } from "./cameras.ts";

test("cameras.json (3DGS): positions in filming order by image name, thinned", () => {
  const cams = [];
  for (let i = 0; i < 30; i++) cams.push({ id: i, img_name: `frame_${i}`, position: [0, 1.6, -i * 0.1], rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
  cams.reverse(); // the file need not be in order
  const r = routeFromCameras(cams, false)!;
  assert.equal(r.cameras, 30);
  assert.deepEqual(r.route[0], [0, 1.6, -0]);
  assert.ok(r.route.length >= 5 && r.route.length <= 7, `${r.route.length}`); // 2.9 walked, a point every 0.5
  assert.ok(r.route[r.route.length - 1][2] < -2);
});

test("frame_10 comes after frame_9", () => {
  const r = routeFromCameras([
    { img_name: "frame_10", position: [0, 0, -10] },
    { img_name: "frame_9", position: [0, 0, -9] },
    { img_name: "frame_1", position: [0, 0, -1] },
  ], false)!;
  assert.deepEqual(r.route.map((p) => p[2]), [-1, -9, -10]);
});

test("transforms.json (Nerfstudio): the camera-to-world matrix's last column", () => {
  const frame = (n: number, x: number, z: number) => ({
    file_path: `images/frame_${String(n).padStart(5, "0")}.jpg`,
    transform_matrix: [[1, 0, 0, x], [0, 1, 0, 1.5], [0, 0, 1, z], [0, 0, 0, 1]],
  });
  const r = routeFromCameras({ camera_model: "OPENCV", frames: [frame(2, 0, -2), frame(1, 0, -1), frame(3, 1, -3)] }, false)!;
  assert.deepEqual(r.route, [[0, 1.5, -1], [0, 1.5, -2], [1, 1.5, -3]]);
});

test("the splat's upright turn is applied as the viewer applies it", () => {
  const r = routeFromCameras({ cameras: [{ img_name: "a", position: [1, 2, 3] }, { img_name: "b", position: [1, 2, 9] }] }, true)!;
  assert.deepEqual(r.route[0], [1, -2, -3]);
});

test("a file without camera positions is refused", () => {
  assert.equal(routeFromCameras({ scenes: [] }, false), null);
  assert.equal(routeFromCameras([{ name: "x" }, { name: "y" }], false), null);
  assert.equal(routeFromCameras([{ position: [0, 0, 0] }], false), null);
  assert.equal(routeFromCameras("hello", false), null);
});
