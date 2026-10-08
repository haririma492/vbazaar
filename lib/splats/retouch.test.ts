// The 3D retouch on a small synthetic street corner: stained, grainy asphalt,
// a paving strip, a brick wall with grime, a sign with sharp letters, and
// floaters — restored with the geometry left exactly as it was.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGrid, findGround, neighbourCells, planeOf, PRESETS, retouch, SH_C0, valueNoise, type Splats,
} from "./retouch.ts";

// ── The scene (y up, metres) ────────────────────────────────────────────────

const K = { Asphalt: 0, Stain: 1, Stone: 2, Joint: 3, Brick: 4, Grime: 5, Board: 6, Letter: 7, Floater: 8 } as const;
type K = (typeof K)[keyof typeof K];

function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function street(): { s: Splats; kind: Uint8Array; nearEdge: Uint8Array } {
  const r = rng(99);
  const g = () => (r() + r() + r() - 1.5) * 0.8; // ~N(0, 0.4²)
  const pts: { p: number[]; c: number[]; a: number; k: K; n: "h" | "v" | "r"; e?: boolean }[] = [];
  const step = 0.025;
  // Ground: x −1.5..1.5 (asphalt, x < 0.9) and a paving strip (x ≥ 0.9), z 0..3.
  const stain = { x: -0.5, z: 1.5, r: 0.35 };
  for (let x = -1.5; x < 1.5; x += step) for (let z = 0; z < 3; z += step) {
    const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
    if (px >= 0.9) {
      const joint = (px - 0.9) % 0.2 < 0.025 || pz % 0.2 < 0.025;
      const v = joint ? 0.33 : 0.6;
      pts.push({ p: [px, 0, pz], c: [v + g() * 0.03, v * 0.95 + g() * 0.03, v * 0.88 + g() * 0.03], a: 0.95, k: joint ? K.Joint : K.Stone, n: "h" });
    } else {
      const m = Math.exp(-((px - stain.x) ** 2 + (pz - stain.z) ** 2) / (stain.r * stain.r) * 1.5);
      const v = 0.27 * (1 - 0.45 * m) + g() * 0.05;
      pts.push({ p: [px, 0, pz], c: [v, v, v * 1.04], a: 0.95, k: m > 0.35 ? K.Stain : K.Asphalt, n: "h" });
    }
  }
  // Wall: x = 1.5, y 0..2.5, z 0..3, brick with a grime blotch and a sign.
  const grime = { y: 0.8, z: 0.8, r: 0.35 };
  for (let y = 0.02; y < 2.5; y += step) for (let z = 0; z < 3; z += step) {
    const py = y + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
    if (py > 1.6 && py < 2.1 && pz > 1.5 && pz < 2.7) {
      // The sign: white board, black vertical strokes 4 cm wide every 15 cm.
      const u = (pz - 1.6) % 0.15;
      const stroke = pz > 1.6 && pz < 2.6 && py > 1.7 && py < 2.0 && u < 0.04;
      const edge = pz > 1.6 && pz < 2.6 && py > 1.7 && py < 2.0 && (Math.abs(u) < 0.012 || Math.abs(u - 0.04) < 0.012);
      const c = stroke ? [0.06, 0.06, 0.07] : [0.92, 0.92, 0.88];
      pts.push({ p: [1.49, py, pz], c: c.map((v) => v + g() * 0.02), a: 0.97, k: stroke ? K.Letter : K.Board, n: "v", e: edge });
      continue;
    }
    const m = Math.exp(-((py - grime.y) ** 2 + (pz - grime.z) ** 2) / (grime.r * grime.r) * 1.5);
    const base = [0.62, 0.3, 0.21];
    const l = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
    const c = base.map((v) => (v + (l - v) * 0.6 * m) * (1 - 0.5 * m) + g() * 0.03);
    pts.push({ p: [1.5, py, pz], c, a: 0.95, k: m > 0.35 ? K.Grime : K.Brick, n: "v" });
  }
  // Floaters: faint, alone, in the air.
  for (let i = 0; i < 40; i++) pts.push({ p: [-1 + r() * 2, 1 + r() * 1.5, r() * 3], c: [r(), r(), r()], a: 0.2, k: K.Floater, n: "r" });

  const n = pts.length;
  const s: Splats = {
    count: n, shDegree: 1,
    pos: new Float32Array(n * 3), dc: new Float32Array(n * 3), alpha: new Float32Array(n),
    logScale: new Float32Array(n * 3), rot: new Float32Array(n * 4), sh: new Float32Array(n * 9),
  };
  const kind = new Uint8Array(n), nearEdge = new Uint8Array(n);
  pts.forEach((q, i) => {
    s.pos.set(q.p, i * 3);
    s.dc.set(q.c.map((v) => (v - 0.5) / SH_C0), i * 3);
    s.alpha[i] = q.a;
    const big = Math.log(0.015), thin = Math.log(0.002);
    s.logScale.set(q.n === "h" ? [big, thin, big] : q.n === "v" ? [thin, big, big] : [big, big, big], i * 3);
    s.rot.set([1, 0, 0, 0], i * 4);
    for (let k = 0; k < 9; k++) s.sh[i * 9 + k] = (r() - 0.5) * 0.04;
    kind[i] = q.k;
    nearEdge[i] = q.e ? 1 : 0;
  });
  return { s, kind, nearEdge };
}

const clone = (s: Splats): Splats => ({
  ...s, pos: s.pos.slice(), dc: s.dc.slice(), alpha: s.alpha.slice(), logScale: s.logScale.slice(), rot: s.rot.slice(), sh: s.sh.slice(),
});
const lumaOf = (s: Splats, i: number) => {
  const c = [0, 1, 2].map((d) => 0.5 + SH_C0 * s.dc[i * 3 + d]);
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
};
function stats(s: Splats, kind: Uint8Array, k: K, keep?: Uint8Array) {
  let n = 0, m = 0, m2 = 0;
  for (let i = 0; i < s.count; i++) {
    if (kind[i] !== k || (keep && !keep[i])) continue;
    const l = lumaOf(s, i);
    n++; m += l; m2 += l * l;
  }
  m /= n;
  return { n, mean: m, std: Math.sqrt(Math.max(0, m2 / n - m * m)) };
}

const UP = { up: [0, 1, 0] as [number, number, number] };
const scene = street();
const full = clone(scene.s);
const fullRun = retouch(full, { preset: "full", ...UP });
const gentle = clone(scene.s);
const gentleRun = retouch(gentle, { preset: "gentle", ...UP });

// ── a. The voxel hash ───────────────────────────────────────────────────────

test("the voxel hash finds every splat within a cell of any other", () => {
  const r = rng(5);
  const n = 4000;
  const pos = new Float32Array(n * 3).map(() => r() * 2 - 1);
  const h = 0.15;
  const g = buildGrid(pos, n, h);
  assert.equal(g.start[g.cells], n);
  const nb = new Int32Array(27);
  for (let q = 0; q < n; q += 37) {
    const found = new Set<number>();
    const m = neighbourCells(g, g.cellOf[q], nb);
    for (let a = 0; a < m; a++) for (let t = g.start[nb[a]]; t < g.start[nb[a] + 1]; t++) found.add(g.order[t]);
    for (let j = 0; j < n; j++) {
      const d = Math.hypot(pos[j * 3] - pos[q * 3], pos[j * 3 + 1] - pos[q * 3 + 1], pos[j * 3 + 2] - pos[q * 3 + 2]);
      if (d <= h) assert.ok(found.has(j), `splat ${j} at ${d.toFixed(3)} of ${q} missed`);
    }
  }
});

test("a surface's normal and planarity", () => {
  const out = new Float64Array(3);
  // Points on z = 0.3 x, spread in x and y: covariance of that plane.
  const pts: number[][] = [];
  const r = rng(3);
  for (let i = 0; i < 500; i++) {
    const x = r() - 0.5, y = r() - 0.5;
    pts.push([x, y, 0.3 * x]);
  }
  const m = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  const cov = (a: number, b: number) => pts.reduce((s, p) => s + (p[a] - m[a]) * (p[b] - m[b]), 0) / pts.length;
  const pl = planeOf(cov(0, 0), cov(0, 1), cov(0, 2), cov(1, 1), cov(1, 2), cov(2, 2), out);
  const want = [-0.3, 0, 1].map((v) => v / Math.hypot(0.3, 1));
  assert.ok(Math.abs(Math.abs(out[0] * want[0] + out[1] * want[1] + out[2] * want[2]) - 1) < 1e-6);
  assert.ok(pl > 0.99);
});

// ── c. The ground ───────────────────────────────────────────────────────────

test("the ground is the lowest dense layer: floor yes, wall and splats below the street no", () => {
  const n = 3000;
  const s: Splats = {
    count: n, shDegree: 0, pos: new Float32Array(n * 3), dc: new Float32Array(n * 3), alpha: new Float32Array(n).fill(1),
    logScale: new Float32Array(n * 3), rot: new Float32Array(n * 4), sh: new Float32Array(0),
  };
  const r = rng(11);
  for (let i = 0; i < n; i++) {
    // y is DOWN here (a capture's own axes): the floor at y = 0.5, a ledge above it at y = −1, strays below at y = 1.5.
    const y = i < 2000 ? 0.5 : i < 2900 ? -1 : 1.5;
    s.pos.set([r() * 2, y + (r() - 0.5) * 0.01, r() * 2], i * 3);
  }
  const { ground } = findGround(s, new Uint8Array(n).fill(1), [0, -1, 0], 0.5, 0.05);
  let floor = 0, other = 0;
  for (let i = 0; i < n; i++) (i < 2000 ? (floor += ground[i]) : (other += ground[i]));
  assert.equal(floor, 2000);
  assert.equal(other, 0);
});

// ── The whole retouch ───────────────────────────────────────────────────────

test("geometry is identical: only colours change, and only floaters go", async () => {
  const { keep, report } = await fullRun;
  const { s, kind } = scene;
  assert.deepEqual(full.pos, s.pos);
  assert.deepEqual(full.logScale, s.logScale);
  assert.deepEqual(full.rot, s.rot);
  assert.deepEqual(full.alpha, s.alpha);
  let floatersKept = 0, surfaceDropped = 0;
  for (let i = 0; i < s.count; i++) {
    if (kind[i] === K.Floater) floatersKept += keep[i];
    else surfaceDropped += 1 - keep[i];
  }
  assert.equal(surfaceDropped, 0);
  assert.ok(floatersKept <= 2, `${floatersKept} floaters kept`);
  assert.equal(report.kept, s.count - report.floaters);
  assert.ok(Math.abs(report.up[1] - 1) < 1e-3);
});

test("new asphalt: grain cut, the stain mostly gone, charcoal", async () => {
  await fullRun;
  const { s, kind } = scene;
  const a0 = stats(s, kind, K.Asphalt), a1 = stats(full, kind, K.Asphalt);
  const st0 = stats(s, kind, K.Stain), st1 = stats(full, kind, K.Stain);
  assert.ok(a1.std < 0.5 * a0.std, `asphalt grain ${a0.std.toFixed(4)} → ${a1.std.toFixed(4)}`);
  const c0 = a0.mean - st0.mean, c1 = a1.mean - st1.mean;
  assert.ok(c1 < 0.5 * c0, `stain contrast ${c0.toFixed(3)} → ${c1.toFixed(3)}`);
  assert.ok(a1.mean < a0.mean && Math.abs(a1.mean - 0.17) < 0.05, `asphalt luma ${a1.mean.toFixed(3)}`);
});

test("paving keeps its pattern", async () => {
  await fullRun;
  const { s, kind } = scene;
  const c0 = stats(s, kind, K.Stone).mean - stats(s, kind, K.Joint).mean;
  const c1 = stats(full, kind, K.Stone).mean - stats(full, kind, K.Joint).mean;
  assert.ok(c1 > 0.85 * c0, `stone − joint ${c0.toFixed(3)} → ${c1.toFixed(3)}`);
});

test("walls: grime lifted toward the clean brick, brick a little brighter and richer", async () => {
  await fullRun;
  const { s, kind } = scene;
  const b0 = stats(s, kind, K.Brick), b1 = stats(full, kind, K.Brick);
  const c0 = b0.mean - stats(s, kind, K.Grime).mean;
  const c1 = b1.mean - stats(full, kind, K.Grime).mean;
  assert.ok(c1 < 0.6 * c0, `grime contrast ${c0.toFixed(3)} → ${c1.toFixed(3)}`);
  assert.ok(b1.mean > b0.mean, "brick lifted");
});

test("the sign stays crisp: letters keep their contrast, their edges barely move", async () => {
  await fullRun;
  const { s, kind, nearEdge } = scene;
  const c0 = stats(s, kind, K.Board).mean - stats(s, kind, K.Letter).mean;
  const c1 = stats(full, kind, K.Board).mean - stats(full, kind, K.Letter).mean;
  assert.ok(c1 > 0.95 * c0, `board − letters ${c0.toFixed(3)} → ${c1.toFixed(3)}`);
  let change = 0, n = 0;
  for (let i = 0; i < s.count; i++) {
    if (!nearEdge[i]) continue;
    change += Math.abs(lumaOf(full, i) - lumaOf(s, i));
    n++;
  }
  assert.ok(n > 100 && change / n < 0.06, `edge splats moved ${(change / n).toFixed(3)} on average`);
});

test("full drops the view-dependent glare (SH), gentle keeps it; gentle does less", async () => {
  await Promise.all([fullRun, gentleRun]);
  const { s, kind } = scene;
  assert.ok(full.sh.every((v) => v === 0));
  assert.deepEqual(gentle.sh, s.sh);
  const stain = (x: Splats) => stats(x, kind, K.Asphalt).mean - stats(x, kind, K.Stain).mean;
  assert.ok(stain(full) < stain(gentle) && stain(gentle) < stain(s));
  assert.equal(PRESETS.gentle.shKeep, 1);
});

// ── Deep: cars and people out, the ground filled, the rest kept ─────────────

/** A plain street 8 × 8 m (y up): asphalt, a wall at x = 4 with a kiosk against it, a pillar, a parked car, a person. */
function parked(): { s: Splats; what: Uint8Array } {
  const r = rng(7);
  const W = { ground: 0, wall: 1, car: 2, person: 3, kiosk: 4, pillar: 5 };
  const pts: { p: number[]; c: number[]; n: "h" | "x" | "z" | "r"; w: number }[] = [];
  const step = 0.04;
  const car = { x0: -1, x1: 0.8, z0: 1.5, z1: 5.9, h0: 0.18, h1: 1.45 };
  const under = (x: number, z: number) => (x > car.x0 && x < car.x1 && z > car.z0 && z < car.z1) || Math.hypot(x - 2, z - 1.5) < 0.25;
  for (let x = -4; x < 4; x += step) for (let z = 0; z < 8; z += step) {
    const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
    if (under(px, pz) || (px > 3 && pz > 3 && pz < 4.5)) continue;
    const v = 0.27 + (r() - 0.5) * 0.06;
    pts.push({ p: [px, 0, pz], c: [v, v, v * 1.04], n: "h", w: W.ground });
  }
  for (let y = 0.02; y < 3; y += step) for (let z = 0; z < 8; z += step) {
    if (z > 3 && z < 4.5 && y < 2) continue; // behind the kiosk
    pts.push({ p: [4, y + (r() - 0.5) * step, z + (r() - 0.5) * step], c: [0.62, 0.3, 0.21], n: "x", w: W.wall });
  }
  const box = (b: { x0: number; x1: number; z0: number; z1: number; h0: number; h1: number }, col: number[], w: number) => {
    for (let x = b.x0; x <= b.x1; x += step) for (let z = b.z0; z <= b.z1; z += step) pts.push({ p: [x, b.h1, z], c: col, n: "h", w });
    for (let h = b.h0; h <= b.h1; h += step) {
      for (let x = b.x0; x <= b.x1; x += step) { pts.push({ p: [x, h, b.z0], c: col, n: "z", w }); pts.push({ p: [x, h, b.z1], c: col, n: "z", w }); }
      for (let z = b.z0; z <= b.z1; z += step) { pts.push({ p: [b.x0, h, z], c: col, n: "x", w }); pts.push({ p: [b.x1, h, z], c: col, n: "x", w }); }
    }
  };
  box(car, [0.7, 0.1, 0.1], W.car);
  box({ x0: 3, x1: 3.98, z0: 3, z1: 4.5, h0: 0.02, h1: 2 }, [0.2, 0.5, 0.3], W.kiosk); // against the wall
  box({ x0: -3, x1: -2.7, z0: 6, z1: 6.3, h0: 0.02, h1: 4 }, [0.6, 0.6, 0.58], W.pillar); // 4 m: too tall
  for (let h = 0; h < 1.75; h += step) for (let t = 0; t < 2 * Math.PI; t += step / 0.25) {
    pts.push({ p: [2 + 0.25 * Math.cos(t), h, 1.5 + 0.25 * Math.sin(t)], c: [0.2, 0.25, 0.4], n: "r", w: W.person });
  }
  const n = pts.length;
  const s: Splats = {
    count: n, shDegree: 1, pos: new Float32Array(n * 3), dc: new Float32Array(n * 3), alpha: new Float32Array(n).fill(0.95),
    logScale: new Float32Array(n * 3), rot: new Float32Array(n * 4), sh: new Float32Array(n * 9).fill(0.01),
  };
  const what = new Uint8Array(n);
  const big = Math.log(0.02), thin = Math.log(0.002);
  pts.forEach((q, i) => {
    s.pos.set(q.p, i * 3);
    s.dc.set(q.c.map((v) => (v - 0.5) / SH_C0), i * 3);
    s.logScale.set(q.n === "h" ? [big, thin, big] : q.n === "x" ? [thin, big, big] : q.n === "z" ? [big, big, thin] : [big, big, big], i * 3);
    s.rot.set([1, 0, 0, 0], i * 4);
    what[i] = q.w;
  });
  return { s, what };
}

const deepScene = parked();
const deepIn = clone(deepScene.s);
const deepRun = retouch(deepScene.s, { preset: "deep", up: [0, 1, 0] });

test("deep: the parked car and the person are removed; wall, kiosk against it and a tall pillar stay", async () => {
  const { keep, report } = await deepRun;
  const { what } = deepScene;
  const gone = [0, 0, 0, 0, 0, 0], all = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < keep.length; i++) { all[what[i]]++; if (!keep[i]) gone[what[i]]++; }
  assert.ok(gone[2] / all[2] > 0.98, `car ${gone[2]}/${all[2]}`);
  // Its feet (the lowest few cm) are within the ground's thickness and stay.
  assert.ok(gone[3] / all[3] > 0.95, `person ${gone[3]}/${all[3]}`);
  for (const k of [1, 4, 5]) assert.equal(gone[k], 0, `kind ${k}: ${gone[k]} removed`);
  assert.ok(gone[0] < 0.002 * all[0], `ground ${gone[0]} removed`);
  const kinds = report.deep!.objects.map((o) => o.kind).sort();
  assert.deepEqual(kinds, ["person", "vehicle"]);
  const car = report.deep!.objects.find((o) => o.kind === "vehicle")!;
  assert.ok(Math.abs(car.size[0] - 4.4) < 0.3 && Math.abs(car.size[1] - 1.8) < 0.3 && Math.abs(car.size[2] - 1.45) < 0.2, `car ${car.size}`);
  assert.ok(report.deep!.rejected.some((o) => /tall|over it/.test(o.reason)), "the pillar is kept for its height");
  assert.ok(report.roofColumns > 0, "the car's roof was not taken for ground");
});

test("deep: the car's footprint is new ground — flat, on the street, as dense, asphalt-coloured", async () => {
  const { added, report } = await deepRun;
  assert.ok(added && added.count === report.deep!.filledSplats);
  let inside = 0;
  for (let i = 0; i < added!.count; i++) {
    const x = added!.pos[i * 3], y = added!.pos[i * 3 + 1], z = added!.pos[i * 3 + 2];
    assert.ok(Math.abs(y) < 0.02, `height ${y}`);
    if (x > -1 && x < 0.8 && z > 1.5 && z < 5.9) inside++;
    // Lying flat: the splat's +z turned onto up (+y), its thinnest axis.
    const [w, qx] = [added!.rot[i * 4], added!.rot[i * 4 + 1]];
    assert.ok(Math.abs(Math.abs(w) - Math.SQRT1_2) < 1e-3 && Math.abs(Math.abs(qx) - Math.SQRT1_2) < 1e-3);
    assert.ok(added!.logScale[i * 3 + 2] < added!.logScale[i * 3]);
    const l = 0.299 * (0.5 + SH_C0 * added!.dc[i * 3]) + 0.587 * (0.5 + SH_C0 * added!.dc[i * 3 + 1]) + 0.114 * (0.5 + SH_C0 * added!.dc[i * 3 + 2]);
    assert.ok(l > 0.08 && l < 0.3, `fill luma ${l}`);
  }
  const density = inside / (1.8 * 4.4), street = 1 / 0.04 ** 2;
  assert.ok(density > 0.8 * street && density < 1.25 * street, `${density.toFixed(0)}/m² vs ${street}/m²`);
  assert.ok(added!.sh.every((v) => v === 0));
});

test("deep: kept splats keep their exact geometry, and the result is the same every time", async () => {
  const { keep, added } = await deepRun;
  const s = deepScene.s;
  for (let i = 0; i < s.count; i++) {
    if (!keep[i]) continue;
    for (let d = 0; d < 3; d++) assert.equal(s.pos[i * 3 + d], deepIn.pos[i * 3 + d]);
    for (let d = 0; d < 4; d++) assert.equal(s.rot[i * 4 + d], deepIn.rot[i * 4 + d]);
  }
  assert.ok(s.sh.every((v) => v === 0), "deep: no glare");
  const again = clone(deepIn);
  const second = await retouch(again, { preset: "deep", up: [0, 1, 0] });
  assert.deepEqual(again.dc, s.dc);
  assert.deepEqual(second.added!.pos, added!.pos);
  assert.deepEqual(second.added!.dc, added!.dc);
});

test("the fresh asphalt's grain is fixed in space and small", () => {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 2000; k++) {
    const v = valueNoise(k * 0.37, k * 0.11, -k * 0.23);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    assert.equal(v, valueNoise(k * 0.37, k * 0.11, -k * 0.23));
  }
  assert.ok(lo >= -1 && hi <= 1 && hi - lo > 1);
  assert.equal(PRESETS.deep.shKeep, 0);
  assert.equal(PRESETS.full.deep, false);
});
