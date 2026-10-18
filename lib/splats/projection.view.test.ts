// A normal camera's view cut out of a 360° frame, and a product followed
// through 360° frames with it (the label stays on the product as the camera
// walks past).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { panoPixel, renderView, viewDir } from "./projection.ts";
import { followStep, patchAt } from "./track.ts";

const deg = Math.PI / 180;

test("the view's middle is its own direction; right is + yaw, up is + pitch", () => {
  const c = viewDir(0.7, -0.2, 40 * deg, 96, 48, 48);
  assert.ok(Math.abs(c.lon - 0.7) < 1e-9 && Math.abs(c.lat + 0.2) < 1e-9);
  assert.ok(viewDir(0, 0, 40 * deg, 96, 90, 48).lon > 0, "right");
  assert.ok(viewDir(0, 0, 40 * deg, 96, 48, 5).lat > 0, "up");
  assert.deepEqual(panoPixel(0, 0, "equirect", 2000, 1000), { x: 1000, y: 500 }, "yaw 0 is the panorama's middle");
  const e = panoPixel(0, 0, "eac", 3000, 2000);
  assert.ok(Math.abs(e.x - 1500) < 1e-6 && Math.abs(e.y - 500) < 1e-6, "the cube map's front face, top row middle");
});

/** A 360° panorama of noise with a bright square «product» at (lon, lat). */
function frame(W: number, H: number, lon: number, lat: number): Float32Array {
  const f = new Float32Array(W * H);
  let s = 7;
  for (let i = 0; i < f.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; f[i] = 40 + (s % 30); }
  const p = panoPixel(lon, lat, "equirect", W, H);
  for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
    const v = (Math.abs(x) < 4 && Math.abs(y) < 7) ? 250 : (x + y) % 3 === 0 ? 200 : 120;
    f[Math.round(p.y + y) * W + ((Math.round(p.x + x) % W) + W) % W] = v;
  }
  return f;
}

test("a product sliding past the camera is followed in the cut views, not left behind", () => {
  const W = 1440, H = 720, N = 96, fov = 36 * deg, size = 15;
  // The camera walks on: the product, 50° to the right, slides back 2° a step and a little down.
  const truth = (i: number) => ({ lon: (50 + 2 * i) * deg, lat: (-5 - 0.3 * i) * deg });
  let at = truth(0);
  let template = patchAt(renderView(frame(W, H, at.lon, at.lat), W, H, "equirect", at.lon, at.lat, fov, N), N, N / 2, N / 2, size);
  for (let i = 1; i <= 15; i++) {
    const t = truth(i);
    const view = renderView(frame(W, H, t.lon, t.lat), W, H, "equirect", at.lon, at.lat, fov, N);
    const r = followStep(view, N, N, template, size, { x: N / 2, y: N / 2 }, 20);
    assert.ok(r, `step ${i}: found`);
    at = viewDir(at.lon, at.lat, fov, N, r!.x, r!.y);
    template = r!.template;
  }
  const end = truth(15);
  assert.ok(Math.abs(at.lon - end.lon) < 1.2 * deg, `yaw ${at.lon / deg} vs ${end.lon / deg}`);
  assert.ok(Math.abs(at.lat - end.lat) < 1.2 * deg, `pitch ${at.lat / deg} vs ${end.lat / deg}`);
});
