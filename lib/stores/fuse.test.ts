// One photo from several frames (`fuse.ts`): lined up to a fraction of a pixel, noise averaged away.
import test from "node:test";
import assert from "node:assert/strict";
import { alignTo, fuse, grey, type Rgb } from "./fuse.ts";

/** A page of print: blobs and strokes that never repeat, the same every time; seen shifted by (sx, sy) with noise. */
const hash = (x: number, y: number) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
function smoothNoise(u: number, v: number): number {
  const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
  const f = (t: number) => t * t * (3 - 2 * t);
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return (a * (1 - f(tx)) + b * f(tx)) * (1 - f(ty)) + (c * (1 - f(tx)) + d * f(tx)) * f(ty);
}
function page(n: number, sx: number, sy: number, noise: number, seed: number): Rgb {
  const px = new Float32Array(n * n * 3);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x + sx, v = y + sy;
    const ink = 40 + 120 * smoothNoise(u / 3, v / 3) + 60 * smoothNoise(u / 9 + 50, v / 9) + 30 * smoothNoise(u / 1.5 + 9, v / 1.5);
    for (let c = 0; c < 3; c++) px[(y * n + x) * 3 + c] = ink + rnd();
  }
  return { n, px };
}
const rmsDiff = (a: Float32Array, b: Float32Array, n: number) => {
  let s = 0, k = 0;
  for (let y = 16; y < n - 16; y++) for (let x = 16; x < n - 16; x++) { s += (a[y * n + x] - b[y * n + x]) ** 2; k++; }
  return Math.sqrt(s / k);
};

test("frames of one product are lined up to a fraction of a pixel", () => {
  const n = 128;
  const a = grey(page(n, 0, 0, 0, 1)), b = grey(page(n, 3.4, -2.3, 0, 1));
  const s = alignTo(a, b, n);
  // b at (x + dx) is a at x: b was seen shifted by (3.4, −2.3), so dx ≈ −3.4, dy ≈ +2.3.
  assert.ok(Math.abs(s.dx + 3.4) < 0.25 && Math.abs(s.dy - 2.3) < 0.25, `found ${s.dx.toFixed(2)}, ${s.dy.toFixed(2)}`);
  assert.ok(s.score > 0.95);
});

test("five noisy frames combined are closer to the print than the best one alone", () => {
  const n = 128;
  const truth = grey(page(n, 0, 0, 0, 1));
  const frames = [[0, 0], [1.6, -0.7], [-2.2, 1.3], [0.5, 2.8], [-1.1, -1.9]].map(([sx, sy], i) => page(n, sx, sy, 30, 7 + i));
  const one = rmsDiff(grey(frames[0]), truth, n);
  const { img, used } = fuse(frames);
  const fused = rmsDiff(grey(img), truth, n);
  assert.equal(used, 5);
  assert.ok(fused < one * 0.75, `combined ${fused.toFixed(1)} vs one frame ${one.toFixed(1)} grey levels off`);
});

test("a frame of something else is left out, not blended in", () => {
  const n = 96;
  const good = [page(n, 0, 0, 5, 1), page(n, 1, 0, 5, 2)];
  const other = page(n, 500, 300, 5, 3); // another book: a different page of print
  assert.equal(fuse([...good, other]).used, 2);
});
