import { test } from "node:test";
import assert from "node:assert/strict";
import { flatDir, flatFrac, flatLens, flatLooks, inFlat, lensAspect, parseLens, pinsFromFlat, pinsToFlat, sizeFromFlat, sizeToFlat, v360In, FLAT_LONG_FOV } from "./lens.ts";
import { panoPixel, renderView, viewDir } from "./projection.ts";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

test("a flat video's lens: 70° along its long side, the other side from its shape", () => {
  const land = flatLens(3840, 2160);
  near(land.hfov, FLAT_LONG_FOV);
  near(lensAspect(land), 16 / 9);
  const port = flatLens(2160, 3840);
  near(port.vfov, FLAT_LONG_FOV);
  near(lensAspect(port), 9 / 16);
  assert.ok(port.hfov < port.vfov);
});

test("a place in the frame and its direction are the same thing, both ways", () => {
  const lens = flatLens(1920, 1080);
  for (const [x, y] of [[0.5, 0.5], [0, 0], [1, 1], [0.8, 0.3], [0.15, 0.85]]) {
    const d = flatDir(x, y, lens), f = flatFrac(d.lon, d.lat, lens);
    near(f.x, x, 1e-9);
    near(f.y, y, 1e-9);
  }
  // The middle looks straight ahead; right of it is +lon, above it +lat; the frame's edge is half the lens away.
  assert.deepEqual(flatDir(0.5, 0.5, lens), { lon: 0, lat: 0 });
  near(flatDir(1, 0.5, lens).lon, lens.hfov / 2);
  near(flatDir(0.5, 0, lens).lat, lens.vfov / 2);
});

test("a direction outside the picture, or behind the camera, is not in it", () => {
  const lens = flatLens(1920, 1080);
  assert.ok(inFlat(0, 0, lens));
  assert.ok(!inFlat(lens.hfov / 2 + 0.01, 0, lens));
  assert.ok(!inFlat(Math.PI, 0, lens));
  assert.ok(!inFlat(lens.hfov / 2 - 0.001, 0, lens, 0.01));
});

test("a light's pins and outline go to fractions of the frame and back", () => {
  const lens = flatLens(3840, 2160);
  const pins = [{ t: 1, x: -0.3, y: 0.1 }, { t: 1.1, x: -0.28, y: 0.1 }, { t: 1.2, x: 0.25, y: -0.2 }];
  const flat = pinsToFlat(pins, lens);
  for (const p of flat) assert.ok(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1);
  assert.ok(flat[0].x < 0.5 && flat[0].y < 0.5, "left of and above the middle");
  const back = pinsFromFlat(flat, lens);
  back.forEach((p, i) => { near(p.x, pins[i].x, 2e-3); near(p.y, pins[i].y, 2e-3); assert.equal(p.t, pins[i].t); });
  const size = { w: 0.1, h: 0.06 };
  const f = sizeToFlat(size, { lon: 0.2, lat: -0.1 }, lens);
  near(f.w, 0.1 / lens.hfov, 0.02);
  const at = flatFrac(0.2, -0.1, lens);
  const s = sizeFromFlat(f, at, lens);
  near(s.w, size.w, 5e-3);
  near(s.h, size.h, 5e-3);
});

test("the crew's views on a flat video cover the frame, and stay inside it", () => {
  for (const lens of [flatLens(3840, 2160), flatLens(2160, 3840), flatLens(1920, 1920)]) {
    const fov = (26 * Math.PI) / 180;
    const looks = flatLooks(lens, fov);
    assert.equal(new Set(looks.map((l) => l.id)).size, looks.length);
    for (const l of looks) assert.ok(inFlat(l.heading, l.pitch, lens), "a view's middle is in the picture");
    // Every place of the frame is inside some view.
    for (let x = 0.02; x < 1; x += 0.06) {
      for (let y = 0.02; y < 1; y += 0.06) {
        const d = flatDir(x, y, lens);
        const seen = looks.some((l) => {
          // The place, in the view's own picture (the inverse of `viewDir`, by search over its pixels' corners).
          const N = 64;
          for (let py = 0; py <= N; py += 2) for (let px = 0; px <= N; px += 2) {
            const v = viewDir(l.heading, l.pitch, fov, N, px, py);
            if (Math.abs(v.lon - d.lon) < 0.012 && Math.abs(v.lat - d.lat) < 0.012) return true;
          }
          return false;
        });
        assert.ok(seen, `nothing looks at ${x.toFixed(2)}, ${y.toFixed(2)}`);
      }
    }
  }
  assert.equal(flatLooks(flatLens(3840, 2160), (26 * Math.PI) / 180).length, 6);
});

test("ffmpeg is told the flat frame's lens; a 360° walk is the panorama as before", () => {
  assert.equal(v360In(null), "input=e");
  assert.equal(v360In(), "input=e");
  assert.match(v360In(flatLens(1920, 1080)), /^input=flat:ih_fov=70\.000:iv_fov=42\.9\d\d$/);
});

test("a lens read from a file is checked", () => {
  assert.deepEqual(parseLens({ hfov: 1.2, vfov: 0.7, more: 1 }), { hfov: 1.2, vfov: 0.7 });
  assert.equal(parseLens({ hfov: 1.2 }), null);
  assert.equal(parseLens({ hfov: 9, vfov: 0.7 }), null);
  assert.equal(parseLens("flat"), null);
});

test("a view cut out of a flat frame reads the frame's own pixels", () => {
  // A frame whose brightness is its column: a view aimed at a place has that place's column in its middle.
  const W = 320, H = 180, lens = flatLens(W, H);
  const frame = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) frame[y * W + x] = x;
  const d = flatDir(0.7, 0.4, lens);
  const p = panoPixel(d.lon, d.lat, lens, W, H);
  near(p.x, 0.7 * W, 1e-6);
  near(p.y, 0.4 * H, 1e-6);
  const N = 32, v = renderView(frame, W, H, lens, d.lon, d.lat, 0.2, N);
  near((v[(N / 2) * N + N / 2] + v[(N / 2 - 1) * N + N / 2 - 1]) / 2, 0.7 * W - 0.5, 0.6);
});
