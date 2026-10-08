// Reading and writing splats for the 3D retouch: a .ply round trip, and .spz
// (versions 2 and 3) decoded as Spark decodes them.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { emptySplats, readPly, readSpz, writePly } from "./splat-io.ts";

const dir = mkdtempSync(join(tmpdir(), "sk-splat-io-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const close = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

test(".ply: written and read back the same, floaters left out, SH degree capped on reading", () => {
  const s = emptySplats(3, 1);
  s.pos.set([1, 2, 3, -4, 5.5, 6, 7, 8, -9]);
  s.dc.set([0.1, 0.2, 0.3, -1, 0, 1, 2, 2, 2]);
  s.alpha.set([0.9, 0.5, 0.01]);
  s.logScale.set([-4, -5, -6, -3, -3, -3, -2, -2, -2]);
  s.rot.set([1, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0, 1, 0, 0]);
  s.sh.set(Array.from({ length: 27 }, (_, k) => k / 100));
  const path = join(dir, "a.ply");
  assert.equal(writePly(path, s, new Uint8Array([1, 0, 1])), 2);
  const r = readPly(path);
  assert.equal(r.count, 2);
  assert.equal(r.shDegree, 1);
  assert.deepEqual([...r.pos], [1, 2, 3, 7, 8, -9]);
  assert.ok(close(r.alpha[0], 0.9, 1e-6) && close(r.alpha[1], 0.01, 1e-6));
  assert.ok([...r.dc].every((v, k) => close(v, [0.1, 0.2, 0.3, 2, 2, 2][k], 1e-6)));
  assert.deepEqual([...r.rot], [1, 0, 0, 0, 0, 1, 0, 0]);
  assert.ok([...r.sh].every((v, k) => close(v, (k < 9 ? k : k + 9) / 100, 1e-6)));
  assert.equal(readPly(path, 0).sh.length, 0);
});

/** An .spz of two splats, as Spark/Niantic write it. */
function spz(version: 2 | 3): Buffer {
  const n = 2, frac = 12;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(0x5053474e, 0);
  head.writeUInt32LE(version, 4);
  head.writeUInt32LE(n, 8);
  head[12] = 1; // SH degree
  head[13] = frac;
  const parts: number[] = [];
  const i24 = (v: number) => {
    const x = Math.round(v * 2 ** frac) & 0xffffff;
    parts.push(x & 255, (x >> 8) & 255, (x >> 16) & 255);
  };
  [[1.5, -2.25, 3], [-0.5, 0.125, -10]].forEach((p) => p.forEach(i24));
  parts.push(255, 128); // alphas
  parts.push(128, 0, 255, 64, 64, 64); // colours
  parts.push(160, 96, 80, 0, 255, 128); // scales
  if (version === 3) {
    // Identity (w largest: index 3, the others zero) and a 90° turn about x
    // (x = w = √½: largest index 0, w stored as +511, y = z = 0).
    const pack = (largest: number, vals: [number, number][]) => {
      let c = 0;
      for (const [mag, neg] of vals) c = (c << 10) | (neg << 9) | mag;
      return ((largest << 30) | c) >>> 0;
    };
    for (const c of [pack(3, [[0, 0], [0, 0], [0, 0]]), pack(0, [[0, 0], [0, 0], [511, 0]])]) parts.push(c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24);
  } else {
    parts.push(128, 128, 128, 255, 128, 128);
  }
  // SH degree 1: 9 bytes per splat, coefficient-major.
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) parts.push(128 + (i ? -k : k) * 8);
  return gzipSync(Buffer.concat([head, Buffer.from(parts)]));
}

for (const version of [2, 3] as const) {
  test(`.spz v${version}: decoded as Spark decodes it, rotations as w x y z`, async () => {
    const path = join(dir, `v${version}.spz`);
    writeFileSync(path, spz(version));
    const s = await readSpz(path);
    assert.equal(s.count, 2);
    assert.deepEqual([...s.pos], [1.5, -2.25, 3, -0.5, 0.125, -10]);
    assert.ok(close(s.alpha[0], 1, 1e-6) && close(s.alpha[1], 128 / 255, 1e-6));
    assert.ok(close(s.dc[0], (128 / 255 - 0.5) / 0.15, 1e-6) && close(s.dc[2], 0.5 / 0.15, 1e-6));
    assert.ok(close(s.logScale[0], 0, 1e-9) && close(s.logScale[3], -10, 1e-9) && close(s.logScale[5], -2, 1e-9));
    assert.ok([1, 0, 0, 0].every((v, k) => close(s.rot[k], v, 0.01))); // v2: bytes, 128 is 0.004
    if (version === 3) assert.ok([Math.SQRT1_2, Math.SQRT1_2, 0, 0].every((v, k) => close(s.rot[4 + k], v, 1e-3)));
    else assert.ok(close(s.rot[5], 1, 1e-2) && close(s.rot[4], 0, 0.1));
    // Channel-major like the .ply: red's three coefficients first.
    assert.ok(close(s.sh[0], 0, 1e-9) && close(s.sh[1], 24 / 128, 1e-9) && close(s.sh[3], 8 / 128, 1e-9));
    assert.ok(close(s.sh[9 + 1], -24 / 128, 1e-9));
  });
}

test(".spz: a level-of-detail file is refused", async () => {
  const raw = Buffer.alloc(16);
  raw.writeUInt32LE(0x5053474e, 0);
  raw.writeUInt32LE(3, 4);
  raw[14] = 0x80;
  const path = join(dir, "lod.spz");
  writeFileSync(path, gzipSync(raw));
  await assert.rejects(readSpz(path), /level-of-detail/);
});

test(".ply: new splats (the deep retouch's ground) are written after the kept ones", () => {
  const s = emptySplats(2, 0);
  s.pos.set([1, 1, 1, 2, 2, 2]);
  s.alpha.set([0.5, 0.5]);
  const extra = emptySplats(1, 0);
  extra.pos.set([9, 9, 9]);
  extra.alpha.set([0.9]);
  extra.rot.set([1, 0, 0, 0]);
  const path = join(dir, "extra.ply");
  assert.equal(writePly(path, s, new Uint8Array([0, 1]), extra), 2);
  const r = readPly(path);
  assert.deepEqual([...r.pos], [2, 2, 2, 9, 9, 9]);
  assert.ok(close(r.alpha[1], 0.9, 1e-6));
  assert.throws(() => writePly(path, s, null, emptySplats(1, 1)), /SH degree/);
});
