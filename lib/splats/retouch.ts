/**
 * THE 3D RETOUCH (founder, 2026-10-08: "really big for commercialization"):
 * a restored copy of a filmed street — new asphalt, bright bricks, stains and
 * grime gone — made offline on our server, CPU only. Only colours change (and
 * isolated floaters go); every kept splat keeps its place, size and turn, so
 * the geometry is identical.
 *
 * Like skin retouching, it works by separating scales ("frequency
 * separation"), on the surface the splats lie on:
 *
 *   F  each splat's colour after an edge-preserving (bilateral) filter over
 *      its neighbours on the same surface: noise gone, edges crisp.
 *   L  the surface's local mean colour, a few fine cells across.
 *   R  the surface's CLEAN regional colour, a metre or so across, leaning to
 *      its brighter parts (stains and grime are darker).
 *
 *   restored = R + (L − R)·(1 − s_low) + (F − L)·(1 − s_high)
 *
 * (L − R) is the blotch (oil stain, grime, water mark): taken out with
 * s_low, unless it is a strong, coloured difference — a sign, a door, a
 * shop front — or a shadow (same hue, only darker). (F − L) is the texture
 * (mortar lines, paving joints, letters): kept, except on plain asphalt,
 * where it is cut ("new asphalt") unless it is structured (paving) or a
 * road marking. Then warm brick tones get vibrance and a little light.
 *
 * "deep" (founder: "remove cars, make the walls and asphalt new, doors and
 * store signs as if new") goes further, still without learning or a GPU:
 * cars, vans, scooters and people found by shape on the ground model and
 * deleted, their ground filled with new splats; asphalt replaced by fresh
 * charcoal with a fixed grain, markings repainted; paving stones and joints
 * each one even colour; walls split into patches and pulled to their clean
 * colour (brick, light-grey mortar), dirt and streaks gone, strong structure
 * kept; doors and shutters repainted; signs only sharpened. It never invents
 * what the cameras did not see — under a car it lays plain new ground.
 *
 * The heavy passes run on worker threads when the caller gives a pool
 * (`scripts/retouch.mts` does); the arrays live on shared memory, and every
 * pass writes each splat on its own, so the result does not depend on the
 * threads.
 *
 * Distances are measured in cells sized from the scene's own density (a
 * capture's units are arbitrary), so the same parameters work at any scale.
 * Everything is typed arrays and a voxel hash: 9M splats in ~1.5 GB.
 *
 * ⚠️ IMPORT-FREE (types only), so `node --test --experimental-strip-types`
 * and the CLI load it as is. Reading and writing files: `splat-io.ts`.
 */

export const SH_C0 = 0.28209479177387814;

/** A scene's splats, as typed arrays (see `splat-io.ts`). */
export type Splats = {
  count: number;
  /** Degree of `sh` (0–3). */
  shDegree: number;
  pos: Float32Array; // 3n
  /** SH DC (colour = 0.5 + SH_C0·dc). */
  dc: Float32Array; // 3n
  /** Opacity 0..1. */
  alpha: Float32Array; // n
  logScale: Float32Array; // 3n
  /** w x y z (as the .ply's rot_0..3). */
  rot: Float32Array; // 4n
  /** View-dependent SH, n × 3 channels × coefficients, channel-major. */
  sh: Float32Array;
};

export type Vec3 = [number, number, number];

export type RetouchParams = {
  /** Which way is up in the file (the tour's `flip`: y-down files → [0, −1, 0]). Refined from the ground's own tilt. */
  up: Vec3;
  /** Splats a splat sees in its own fine cell (sets the fine scale). */
  cellTarget: number;
  /** Coarse cell (the local mean L) = this × fine cell. */
  coarseFactor: number;
  /**
   * Or the coarse cell in the file's own units (0: from the density, as
   * above). The blotches taken out reach ~2·regionRadius coarse cells, so a
   * denser capture of the same street otherwise gets a smaller reach.
   */
  coarseCell: number;
  /** The clean regional colour R gathers coarse cells this far each way. */
  regionRadius: number;
  /** R is the mean of the region's cells brighter than this weighted quantile of their luma (0: plain mean). */
  cleanQuantile: number;
  /** Splats at least this opaque are the evidence (the surface's colour is read from them). */
  minAlpha: number;
  /** Splats at least this opaque are retouched (fainter ones are left as they are). */
  receiveAlpha: number;
  /** Splats larger than this many fine cells (sky, far walls, blur) are left alone. */
  maxScaleCells: number;
  /** 0..1: how much of the fine bilateral filter (noise) to apply. */
  smooth: number;
  /** Colour difference (RGB 0..1) the fine filter averages over. */
  rangeSigma: number;
  /** Neighbours further than this in colour are ignored: edges and signs stay crisp. */
  edgeCut: number;
  /** 0..1: darker blotches taken out on surfaces other than walls and asphalt (paving, …). */
  blemish: number;
  /** 0..1: lighter blotches (dried paint, glare) taken out. */
  blemishLight: number;
  /** Blotch size |L − R| over which it is a feature and kept: ramp [from, to]. */
  contrastKeep: [number, number];
  /** Darker, neutral blotches may be this many times stronger and still count as dirt. */
  darkWiden: number;
  /** 0..1: on coloured surfaces, a darker patch of the same hue is shade, kept. */
  shadowKeep: number;
  /** 0..1: dark grime on walls taken out. */
  grime: number;
  /** 0..1: plain asphalt's colour pulled toward `charcoal` (shading kept). */
  asphaltPull: number;
  /** 0..1: asphalt texture (grain, patches) cut. */
  asphaltCut: number;
  /** 0..1: asphalt blotches (oil, water marks) taken out. */
  asphaltStain: number;
  /** Ground counts as asphalt when its clean colour is darker than this and at most this saturated. */
  asphaltMaxLum: number;
  asphaltMaxSat: number;
  charcoal: Vec3;
  /** Local texture (luma std) from which ground is "structured" (paving), its texture kept: ramp. */
  texture: [number, number];
  /** Texture contrast from which a mark on asphalt (lane paint) is kept: ramp. */
  marking: [number, number];
  /** Brick vibrance (warm reds and oranges) and brightness lift. */
  vibrance: number;
  lift: number;
  /** Ground: within this many fine cells of the column's lowest dense layer. */
  groundTol: number;
  /** Floaters: less opaque than this, with fewer neighbours than `floaterNeighbours` — dropped. */
  floaterAlpha: number;
  floaterNeighbours: number;
  /** 0..1: view-dependent SH kept (0: none — no glare, colour as seen head-on). */
  shKeep: number;

  // ── "deep" only (see `deepPrepare`, `deepPass`, `findObjects`, `fillFootprints`) ──
  /** The deep stages: objects removed and their ground filled, new asphalt, walls, doors, signs. */
  deep: boolean;
  /** File units per metre (sizes of cars, people, doors are in metres). Our scenes: 1. */
  metres: number;
  /** Remove parked cars, vans, scooters, carts and people (deletes splats, fills the ground). */
  removeObjects: boolean;
  /** Fresh asphalt: grain amplitude (share of its colour), and how much of the light across it is flattened. */
  asphaltGrain: number;
  asphaltFlatten: number;
  /** Road markings repainted. */
  markingWhite: Vec3;
  markingYellow: Vec3;
  /** 0..1: each paving stone (and joint) pulled to its neighbourhood's clean stone (joint) colour. */
  pavePull: number;
  /** 0..1: wall splats pulled to their wall's clean colour (brick, mortar, plaster); strong structure kept. */
  wallPull: number;
  mortarGrey: Vec3;
  /** Doors and shutters: saturation added to their dominant colour; share of the ribs kept. */
  doorSat: number;
  ribKeep: number;
  /** Signs: left as they are, but for this much more contrast and saturation (and the denoise). */
  signContrast: number;
  signSat: number;
  /** A wall cell is part of a sign when its luma varies this much (letters on a board). */
  signStd: number;
};

const BASE: RetouchParams = {
  up: [0, -1, 0],
  cellTarget: 6,
  coarseFactor: 6,
  coarseCell: 0,
  regionRadius: 5,
  cleanQuantile: 0.5,
  minAlpha: 0.35,
  receiveAlpha: 0.02,
  maxScaleCells: 8,
  smooth: 1,
  rangeSigma: 0.1,
  edgeCut: 0.3,
  blemish: 0.85,
  blemishLight: 0.5,
  contrastKeep: [0.18, 0.4],
  darkWiden: 1.8,
  shadowKeep: 0.8,
  grime: 0.9,
  asphaltPull: 0.8,
  asphaltCut: 0.85,
  asphaltStain: 0.9,
  asphaltMaxLum: 0.42,
  asphaltMaxSat: 0.18,
  charcoal: [0.158, 0.162, 0.17],
  texture: [0.035, 0.07],
  marking: [0.15, 0.3],
  vibrance: 0.3,
  lift: 0.06,
  groundTol: 2,
  floaterAlpha: 0.5,
  floaterNeighbours: 3,
  shKeep: 0,
  deep: false,
  metres: 1,
  removeObjects: false,
  asphaltGrain: 0.05,
  asphaltFlatten: 0.7,
  markingWhite: [0.93, 0.93, 0.9],
  markingYellow: [0.95, 0.78, 0.16],
  pavePull: 0.85,
  wallPull: 0.85,
  mortarGrey: [0.8, 0.79, 0.76],
  doorSat: 0.35,
  ribKeep: 0.8,
  signContrast: 0.1,
  signSat: 0.15,
  signStd: 0.13,
};

/**
 * "full": the restored street. "gentle": cleaned, still clearly the filmed
 * place. "deep": as new — cars and people gone (their ground filled), fresh
 * asphalt and paving, walls repainted to their clean colour, doors and
 * shutters repainted, signs kept (sharpened). The only preset that changes
 * geometry.
 */
export const PRESETS: Record<"gentle" | "full" | "deep", RetouchParams> = {
  full: BASE,
  deep: {
    ...BASE,
    deep: true,
    removeObjects: true,
    asphaltPull: 1,
    asphaltCut: 1,
    asphaltStain: 1,
    grime: 1,
    blemish: 1,
    // Floaters as in «full» (was 0.7 / 6): on iranianplaza1 that dropped 17% of
    // the scene — Splatica's soft, half-transparent surface splats among them.
    floaterAlpha: 0.5,
    floaterNeighbours: 3,
  },
  gentle: {
    ...BASE,
    smooth: 0.6,
    cleanQuantile: 0.35,
    regionRadius: 3,
    blemish: 0.5,
    blemishLight: 0.25,
    grime: 0.55,
    asphaltPull: 0.4,
    asphaltCut: 0.5,
    asphaltStain: 0.55,
    vibrance: 0.15,
    lift: 0.03,
    shKeep: 1,
  },
};

export type RetouchPreset = keyof typeof PRESETS;

/** SH coefficients per colour channel beyond DC, by degree. */
const shCoeffs = (degree: number) => [0, 3, 8, 15][degree] ?? 0;

// ── Small colour helpers ────────────────────────────────────────────────────

export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b);
  return mx <= 1e-6 ? 0 : (mx - Math.min(r, g, b)) / mx;
};
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};

// ── Shared memory (worker threads) ──────────────────────────────────────────

type TypedCtor<T> = { new (buffer: ArrayBuffer): T; BYTES_PER_ELEMENT: number };

/**
 * A typed array on a SharedArrayBuffer (where there is one), so worker
 * threads read and write the same memory instead of copies.
 */
export function shared<T>(C: TypedCtor<T>, n: number): T {
  const B = (typeof SharedArrayBuffer === "function" ? SharedArrayBuffer : ArrayBuffer) as unknown as { new (n: number): ArrayBuffer };
  return new C(new B(Math.max(0, n) * C.BYTES_PER_ELEMENT));
}
function sharedCopy<T extends { length: number; set(a: ArrayLike<number>): void }>(C: TypedCtor<T>, a: ArrayLike<number>): T {
  const t = shared(C, a.length);
  t.set(a);
  return t;
}

// ── a. The voxel hash ───────────────────────────────────────────────────────

/** Cells per axis: 17 bits each, so a cell's three coordinates pack exactly into a double. */
const DIM = 1 << 17;
const NONE = 0xffffffff;

/**
 * A voxel hash of splats: each splat's cell (`cellOf`), and the splats of
 * each cell together (`order[start[c] .. start[c+1]]`). Coordinates are
 * `axes`·p (rows), so the same index serves ground columns (2 axes).
 * Memory: two Uint32 per splat, a few numbers per cell.
 */
export type Grid = {
  size: number;
  dims: 2 | 3;
  axes: number[];
  origin: number[];
  cells: number;
  cellOf: Uint32Array;
  start: Uint32Array;
  order: Uint32Array;
  /** Integer coordinates of each cell. */
  key: Int32Array;
  tKey: Float64Array;
  tId: Int32Array;
  mask: number;
};

const hash3 = (x: number, y: number, z: number) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;

/** Robust extent of the splats along each axis (sampled; far outliers are clamped into the edge cells). */
function frameFor(pos: Float32Array, n: number, axes: number[], dims: number, size: number, include?: Uint8Array | null) {
  const step = Math.max(1, Math.floor(n / 200_000));
  const origin = [0, 0, 0];
  for (let a = 0; a < dims; a++) {
    const v: number[] = [];
    for (let i = 0; i < n; i += step) {
      if (include && !include[i]) continue;
      v.push(axes[a * 3] * pos[i * 3] + axes[a * 3 + 1] * pos[i * 3 + 1] + axes[a * 3 + 2] * pos[i * 3 + 2]);
    }
    if (!v.length) continue;
    v.sort((p, q) => p - q);
    let lo = v[Math.floor(v.length * 0.001)];
    let hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.999))];
    const pad = (hi - lo) * 0.05 + 2 * size;
    lo -= pad;
    hi += pad;
    if ((hi - lo) / size > DIM - 4) lo = (lo + hi) / 2 - (DIM / 2 - 2) * size;
    origin[a] = lo;
  }
  return origin;
}

export function buildGrid(
  pos: Float32Array, n: number, size: number,
  opts: { axes?: number[]; dims?: 2 | 3; include?: Uint8Array | null } = {},
): Grid {
  const axes = opts.axes ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const dims = opts.dims ?? 3;
  const include = opts.include ?? null;
  const origin = frameFor(pos, n, axes, dims, size, include);
  const inv = 1 / size;
  let cap = 1 << 12;
  while (cap < Math.min(n, 1 << 22) / 2) cap <<= 1;
  let tKey = new Float64Array(cap);
  let tId = new Int32Array(cap).fill(-1);
  let mask = cap - 1;
  let key = new Int32Array(Math.max(3, Math.min(n, cap) * 3));
  let cells = 0;
  const cellOf = shared(Uint32Array, n);
  const clampC = (v: number) => (v < 0 ? 0 : v >= DIM ? DIM - 1 : v);
  for (let i = 0; i < n; i++) {
    if (include && !include[i]) {
      cellOf[i] = NONE;
      continue;
    }
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cx = clampC(Math.floor((axes[0] * x + axes[1] * y + axes[2] * z - origin[0]) * inv));
    const cy = clampC(Math.floor((axes[3] * x + axes[4] * y + axes[5] * z - origin[1]) * inv));
    const cz = dims === 3 ? clampC(Math.floor((axes[6] * x + axes[7] * y + axes[8] * z - origin[2]) * inv)) : 0;
    const k = cx + cy * DIM + cz * DIM * DIM;
    let h = hash3(cx, cy, cz) & mask;
    let id = tId[h];
    while (id >= 0 && tKey[h] !== k) {
      h = (h + 1) & mask;
      id = tId[h];
    }
    if (id < 0) {
      id = cells++;
      tId[h] = id;
      tKey[h] = k;
      if (id * 3 + 3 > key.length) {
        const k2 = new Int32Array(key.length * 2);
        k2.set(key);
        key = k2;
      }
      key[id * 3] = cx;
      key[id * 3 + 1] = cy;
      key[id * 3 + 2] = cz;
      if (cells * 2 > cap) {
        // Grow: rehash every cell.
        cap <<= 1;
        mask = cap - 1;
        tKey = new Float64Array(cap);
        tId = new Int32Array(cap).fill(-1);
        for (let c = 0; c < cells; c++) {
          const a = key[c * 3], b = key[c * 3 + 1], d = key[c * 3 + 2];
          let g = hash3(a, b, d) & mask;
          while (tId[g] >= 0) g = (g + 1) & mask;
          tId[g] = c;
          tKey[g] = a + b * DIM + d * DIM * DIM;
        }
      }
    }
    cellOf[i] = id;
  }
  const start = shared(Uint32Array, cells + 1);
  for (let i = 0; i < n; i++) if (cellOf[i] !== NONE) start[cellOf[i] + 1]++;
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cells);
  const order = shared(Uint32Array, start[cells]);
  for (let i = 0; i < n; i++) if (cellOf[i] !== NONE) order[fill[cellOf[i]]++] = i;
  return {
    size, dims, axes, origin, cells, cellOf, start, order,
    key: sharedCopy(Int32Array, key.subarray(0, cells * 3)), tKey: sharedCopy(Float64Array, tKey), tId: sharedCopy(Int32Array, tId), mask,
  };
}

/** The cell at integer coordinates, or −1. */
export function cellAt(g: Grid, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= DIM || y >= DIM || z >= DIM) return -1;
  const k = x + y * DIM + z * DIM * DIM;
  let h = hash3(x, y, z) & g.mask;
  for (;;) {
    const id = g.tId[h];
    if (id < 0) return -1;
    if (g.tKey[h] === k) return id;
    h = (h + 1) & g.mask;
  }
}

/** Cells within `r` cells of cell `c` (itself included) into `out`; returns how many. */
export function neighbourCells(g: Grid, c: number, out: Int32Array, r = 1): number {
  const x = g.key[c * 3], y = g.key[c * 3 + 1], z = g.key[c * 3 + 2];
  let m = 0;
  const rz = g.dims === 3 ? r : 0;
  for (let dz = -rz; dz <= rz; dz++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const id = cellAt(g, x + dx, y + dy, z + dz);
        if (id >= 0) out[m++] = id;
      }
  return m;
}

/** Splat-weighted mean occupancy: how many splats a splat shares its cell with. */
export function occupancy(g: Grid): number {
  let s = 0;
  for (let c = 0; c < g.cells; c++) {
    const k = g.start[c + 1] - g.start[c];
    s += k * k;
  }
  return g.start[g.cells] ? s / g.start[g.cells] : 0;
}

/**
 * The fine grid, its cell sized so a splat shares its cell with about
 * `target` others (the scene's own density decides the scale).
 */
export function fineGrid(s: Splats, target: number, include: Uint8Array | null): Grid {
  const n = s.count;
  const step = Math.max(1, Math.floor(n / 50_000));
  const v: number[] = [];
  for (let i = 0; i < n; i += step) {
    if (include && !include[i]) continue;
    v.push(Math.exp(Math.max(s.logScale[i * 3], s.logScale[i * 3 + 1], s.logScale[i * 3 + 2])));
  }
  v.sort((a, b) => a - b);
  let size = Math.max(1e-6, 3 * (v[v.length >> 1] ?? 0.01));
  let g = buildGrid(s.pos, n, size, { include });
  for (let tries = 0; tries < 5; tries++) {
    const m = occupancy(g);
    if (m <= 0 || Math.abs(Math.log(m / target)) < Math.log(1.4)) break;
    // On a surface, occupancy grows with the cell's area.
    size *= Math.min(3, Math.max(1 / 3, Math.sqrt(target / m)));
    g = buildGrid(s.pos, n, size, { include });
  }
  return g;
}

// ── Surface orientation ─────────────────────────────────────────────────────

/**
 * Normal of the smallest eigenvalue of a symmetric 3×3 (covariance), into
 * `out`; returns planarity 0..1 (1: the points lie on a plane).
 */
export function planeOf(a00: number, a01: number, a02: number, a11: number, a12: number, a22: number, out: Float64Array): number {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12;
  const q = (a00 + a11 + a22) / 3;
  const p2 = (a00 - q) ** 2 + (a11 - q) ** 2 + (a22 - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  if (p < 1e-12 * (Math.abs(q) + 1e-30) || p === 0) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    return 0;
  }
  const b00 = (a00 - q) / p, b11 = (a11 - q) / p, b22 = (a22 - q) / p, b01 = a01 / p, b02 = a02 / p, b12 = a12 / p;
  const det = b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
  const r = Math.min(1, Math.max(-1, det / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * q - e1 - e3;
  // Eigenvector of e3: the largest cross product of two rows of (A − e3 I).
  const r0 = [a00 - e3, a01, a02], r1 = [a01, a11 - e3, a12], r2 = [a02, a12, a22 - e3];
  let best = -1;
  for (const [u, w] of [[r0, r1], [r0, r2], [r1, r2]]) {
    const cx = u[1] * w[2] - u[2] * w[1], cy = u[2] * w[0] - u[0] * w[2], cz = u[0] * w[1] - u[1] * w[0];
    const m = cx * cx + cy * cy + cz * cz;
    if (m > best) {
      best = m;
      out[0] = cx; out[1] = cy; out[2] = cz;
    }
  }
  const len = Math.sqrt(best) || 1;
  out[0] /= len; out[1] /= len; out[2] /= len;
  return e2 > 0 ? Math.max(0, 1 - Math.max(e3, 0) / e2) : 0;
}

/** Orientation classes: ground-like, wall-like, neither (rough, round). */
export const H = 0, V = 1, O = 2;

/** `eligible` per splat: left alone, retouched, or retouched and read as evidence. */
export const UNTOUCHED = 0, RECEIVES = 1, EVIDENCE = 2;

// ── b. Fine pass: surface normals, bilateral colour, floaters ───────────────

export type FinePass = {
  /** Colour after the bilateral filter (RGB, 3n). */
  fine: Float32Array;
  /** Per fine cell: unit normal (3), planarity. */
  normal: Float32Array;
  planarity: Float32Array;
  /** Splats to drop (isolated faint floaters). */
  floater: Uint8Array;
  /** Share of each splat's neighbours across a strong colour edge (0–255): sharp structure. */
  edge: Uint8Array;
};

/**
 * One pass over fine cells `c0..c1`: each cell's surface normal (from the
 * splats around it), each eligible splat's bilateral colour (neighbours on
 * the same surface, near in space and in colour; none across a strong edge)
 * and each faint splat's neighbour count (floaters).
 */
export function finePass(
  s: Splats, rgb: Float32Array, eligible: Uint8Array, g: Grid, p: RetouchParams, out: FinePass, c0 = 0, c1 = g.cells,
) {
  const { pos, alpha } = s;
  const h = g.size;
  const R2 = (1.5 * h) ** 2;
  const invS = 1 / (2 * (0.6 * h) ** 2);
  const invN = 1 / (2 * (0.3 * h) ** 2);
  const invR = 1 / (2 * p.rangeSigma ** 2);
  const edge2 = p.edgeCut ** 2;
  const nb = new Int32Array(27);
  const nv = new Float64Array(3);
  for (let c = c0; c < c1; c++) {
    const m = neighbourCells(g, c, nb);
    // Cell centre.
    const cx = g.origin[0] + (g.key[c * 3] + 0.5) * h, cy = g.origin[1] + (g.key[c * 3 + 1] + 0.5) * h, cz = g.origin[2] + (g.key[c * 3 + 2] + 0.5) * h;
    // The surface here: covariance of the eligible splats around.
    let w0 = 0, sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, sxz = 0, syy = 0, syz = 0, szz = 0, near = 0;
    for (let a = 0; a < m; a++) {
      const cc = nb[a];
      near += g.start[cc + 1] - g.start[cc];
      for (let t = g.start[cc]; t < g.start[cc + 1]; t++) {
        const j = g.order[t];
        if (eligible[j] !== EVIDENCE) continue;
        const x = pos[j * 3] - cx, y = pos[j * 3 + 1] - cy, z = pos[j * 3 + 2] - cz;
        const w = alpha[j];
        w0 += w; sx += w * x; sy += w * y; sz += w * z;
        sxx += w * x * x; sxy += w * x * y; sxz += w * x * z; syy += w * y * y; syz += w * y * z; szz += w * z * z;
      }
    }
    let nx = 0, ny = 0, nz = 0, pl = 0;
    if (w0 > 0) {
      const mx = sx / w0, my = sy / w0, mz = sz / w0;
      pl = planeOf(sxx / w0 - mx * mx, sxy / w0 - mx * my, sxz / w0 - mx * mz, syy / w0 - my * my, syz / w0 - my * mz, szz / w0 - mz * mz, nv);
      if (w0 < 3) pl = 0;
      nx = nv[0]; ny = nv[1]; nz = nv[2];
    }
    out.normal[c * 3] = nx; out.normal[c * 3 + 1] = ny; out.normal[c * 3 + 2] = nz;
    out.planarity[c] = pl;
    const usePlane = pl > 0.5 ? 1 : 0;

    for (let t = g.start[c]; t < g.start[c + 1]; t++) {
      const i = g.order[t];
      if (!eligible[i]) {
        out.fine[i * 3] = rgb[i * 3]; out.fine[i * 3 + 1] = rgb[i * 3 + 1]; out.fine[i * 3 + 2] = rgb[i * 3 + 2];
        // A faint splat with (almost) nothing around: a floater.
        if (alpha[i] < p.floaterAlpha && near - 1 < p.floaterNeighbours) out.floater[i] = 1;
        continue;
      }
      if (alpha[i] < p.floaterAlpha && near - 1 < p.floaterNeighbours) out.floater[i] = 1;
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      const r = rgb[i * 3], gg = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      let W = eligible[i] === EVIDENCE ? alpha[i] : 1e-6, SR = r * W, SG = gg * W, SB = b * W;
      let seen = 0, across = 0;
      for (let a = 0; a < m; a++) {
        const cc = nb[a];
        for (let u = g.start[cc]; u < g.start[cc + 1]; u++) {
          const j = g.order[u];
          if (j === i || eligible[j] !== EVIDENCE) continue;
          const dx = pos[j * 3] - px, dy = pos[j * 3 + 1] - py, dz = pos[j * 3 + 2] - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R2) continue;
          const dr = rgb[j * 3] - r, dg = rgb[j * 3 + 1] - gg, db = rgb[j * 3 + 2] - b;
          const e2 = dr * dr + dg * dg + db * db;
          seen++;
          if (e2 > edge2) {
            across++;
            continue;
          }
          const dn = (dx * nx + dy * ny + dz * nz) * usePlane;
          const w = alpha[j] * Math.exp(-(d2 * invS + dn * dn * invN + e2 * invR));
          W += w;
          SR += w * rgb[j * 3]; SG += w * rgb[j * 3 + 1]; SB += w * rgb[j * 3 + 2];
        }
      }
      out.fine[i * 3] = SR / W; out.fine[i * 3 + 1] = SG / W; out.fine[i * 3 + 2] = SB / W;
      out.edge[i] = seen ? Math.round((255 * across) / seen) : 0;
    }
  }
}

/** Refine `up` from the ground-like cells' normals (a filmed street is rarely exactly level in the file). */
export function refineUp(g: Grid, normal: Float32Array, planarity: Float32Array, hint: Vec3): Vec3 {
  const len = Math.hypot(...hint) || 1;
  const u = [hint[0] / len, hint[1] / len, hint[2] / len];
  let x = 0, y = 0, z = 0;
  for (let c = 0; c < g.cells; c++) {
    if (planarity[c] < 0.6) continue;
    const nx = normal[c * 3], ny = normal[c * 3 + 1], nz = normal[c * 3 + 2];
    const d = nx * u[0] + ny * u[1] + nz * u[2];
    if (Math.abs(d) < 0.94) continue; // within 20° of the hint
    const w = (g.start[c + 1] - g.start[c]) * Math.sign(d);
    x += w * nx; y += w * ny; z += w * nz;
  }
  const m = Math.hypot(x, y, z);
  return m > 0 ? [x / m, y / m, z / m] : [u[0], u[1], u[2]];
}

/** Orientation class of each fine cell, against `up`. */
export function cellClasses(g: Grid, normal: Float32Array, planarity: Float32Array, up: Vec3): Uint8Array {
  const cls = new Uint8Array(g.cells);
  for (let c = 0; c < g.cells; c++) {
    if (planarity[c] < 0.4) {
      cls[c] = O;
      continue;
    }
    const d = Math.abs(normal[c * 3] * up[0] + normal[c * 3 + 1] * up[1] + normal[c * 3 + 2] * up[2]);
    cls[c] = d > 0.8 ? H : d < 0.4 ? V : O;
  }
  return cls;
}

// ── c. The ground ───────────────────────────────────────────────────────────

/** Two unit vectors across `up`. */
function across(up: Vec3): [Vec3, Vec3] {
  const t: Vec3 = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const a: Vec3 = [up[1] * t[2] - up[2] * t[1], up[2] * t[0] - up[0] * t[2], up[0] * t[1] - up[1] * t[0]];
  const la = Math.hypot(...a);
  a[0] /= la; a[1] /= la; a[2] /= la;
  const b: Vec3 = [up[1] * a[2] - up[2] * a[1], up[2] * a[0] - up[0] * a[2], up[0] * a[1] - up[1] * a[0]];
  return [a, b];
}

/** The ground: which splats are on it, and its height under any point. */
export type GroundModel = {
  ground: Uint8Array;
  columns: number;
  withGround: number;
  /** Columns whose lowest layer stood well above the street around (a car's roof, a stall's top): not ground. */
  roofs: number;
  /** Column grid (axes `a`, `b` across `up`) and each column's ground height along `up` (NaN: unknown). */
  grid: Grid;
  level: Float64Array;
  up: Vec3;
  a: Vec3;
  b: Vec3;
};

/**
 * Ground splats: per column (cell `size` across, looking down `up`), the
 * lowest dense layer of ground-like splats — the lowest height window `tol`
 * thick holding at least a tenth of the column's densest window (so stray
 * splats below the street do not count). A column whose layer stands more
 * than `roofTol` above the low part of the street around it (within
 * `around`) is a roof — a parked car's, a stall's — not ground. Columns with
 * no ground take their neighbours', spreading inward (under a car). Marks
 * `ground[i] = 1` for ground-like splats within `tol`.
 */
export function findGround(
  s: Splats, candidate: Uint8Array, up: Vec3, size: number, tol: number, roofTol = Infinity, around = 0,
): GroundModel {
  const n = s.count;
  const [a, b] = across(up);
  const g = buildGrid(s.pos, n, size, { axes: [...a, ...b, 0, 0, 0], dims: 2, include: candidate });
  const heightOf = (i: number) => s.pos[i * 3] * up[0] + s.pos[i * 3 + 1] * up[1] + s.pos[i * 3 + 2] * up[2];
  const level = new Float64Array(g.cells).fill(NaN);
  let scratch = new Float32Array(1024);
  let withGround = 0;
  for (let c = 0; c < g.cells; c++) {
    const k = g.start[c + 1] - g.start[c];
    if (k < 3) continue;
    if (k > scratch.length) scratch = new Float32Array(k * 2);
    for (let t = 0; t < k; t++) scratch[t] = heightOf(g.order[g.start[c] + t]);
    const hs = scratch.subarray(0, k).sort();
    let best = 0;
    for (let lo = 0, hi = 0; lo < k; lo++) {
      while (hi < k && hs[hi] - hs[lo] <= tol) hi++;
      best = Math.max(best, hi - lo);
    }
    const need = Math.max(3, best / 10);
    for (let lo = 0, hi = 0; lo < k; lo++) {
      while (hi < k && hs[hi] - hs[lo] <= tol) hi++;
      if (hi - lo >= need) {
        level[c] = hs[(lo + hi - 1) >> 1];
        withGround++;
        break;
      }
    }
  }
  // Roofs: well above the low part (20th percentile) of the levels around.
  let roofs = 0;
  const r = Math.max(1, Math.ceil(around / size));
  if (Number.isFinite(roofTol) && around > 0) {
    const nbr = new Int32Array((2 * r + 1) ** 2);
    const v: number[] = [];
    const roof = new Uint8Array(g.cells);
    for (let c = 0; c < g.cells; c++) {
      if (Number.isNaN(level[c])) continue;
      const m = neighbourCells(g, c, nbr, r);
      v.length = 0;
      for (let t = 0; t < m; t++) if (!Number.isNaN(level[nbr[t]])) v.push(level[nbr[t]]);
      v.sort((x, y) => x - y);
      if (level[c] > v[Math.floor(v.length * 0.2)] + roofTol) roof[c] = 1;
    }
    for (let c = 0; c < g.cells; c++) if (roof[c]) { level[c] = NaN; roofs++; withGround--; }
  }
  // Fill gaps (under a parked car, a dark corner) from the columns around, ring by ring.
  const nb = new Int32Array(9);
  const filled = level.slice();
  for (let pass = 0; pass < 64; pass++) {
    let changed = 0;
    const prev = filled.slice();
    for (let c = 0; c < g.cells; c++) {
      if (!Number.isNaN(prev[c])) continue;
      const m = neighbourCells(g, c, nb);
      let sum = 0, cnt = 0;
      for (let t = 0; t < m; t++) if (!Number.isNaN(prev[nb[t]])) { sum += prev[nb[t]]; cnt++; }
      if (cnt) { filled[c] = sum / cnt; changed++; }
    }
    if (!changed) break;
  }
  const ground = shared(Uint8Array, n);
  for (let i = 0; i < n; i++) {
    const c = g.cellOf[i];
    if (c === NONE) continue;
    const l = filled[c];
    if (!Number.isNaN(l) && Math.abs(heightOf(i) - l) <= tol) ground[i] = 1;
  }
  return { ground, columns: g.cells, withGround, roofs, grid: g, level: filled, up, a, b };
}

/** The ground's height (along `up`) under a point: its column's, or the nearest columns' around (NaN: none within 3). */
export function groundLevelAt(gm: GroundModel, x: number, y: number, z: number): number {
  const g = gm.grid;
  const u = gm.a[0] * x + gm.a[1] * y + gm.a[2] * z, v = gm.b[0] * x + gm.b[1] * y + gm.b[2] * z;
  const cx = Math.floor((u - g.origin[0]) / g.size), cy = Math.floor((v - g.origin[1]) / g.size);
  for (let r = 0; r <= 3; r++) {
    let sum = 0, cnt = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = cellAt(g, cx + dx, cy + dy, 0);
        if (c >= 0 && !Number.isNaN(gm.level[c])) { sum += gm.level[c]; cnt++; }
      }
    if (cnt) return sum / cnt;
  }
  return NaN;
}

// ── d. Coarse statistics: local mean L, clean regional colour R ─────────────

export type Coarse = {
  grid: Grid;
  /** Per coarse cell × class (index c·3 + class): weight, mean RGB, luma std, centroid, clean colour R. */
  cnt: Float32Array;
  mean: Float32Array;
  std: Float32Array;
  centroid: Float32Array;
  clean: Float32Array;
  /** Mean colour of the cell's lighter and darker splats (split at its mean luma): stone/joint, mortar/brick. */
  hi: Float32Array;
  lo: Float32Array;
};

/** Per coarse cell and orientation class: mean colour, its texture (luma std), centroid; then each one's clean regional colour. */
export function coarseStats(s: Splats, start: Float32Array, eligible: Uint8Array, cls: Uint8Array, fine: Grid, size: number, p: RetouchParams): Coarse {
  const n = s.count;
  const grid = buildGrid(s.pos, n, size, { include: eligible });
  const K = grid.cells * 3;
  const cnt = shared(Float32Array, K), mean = shared(Float32Array, K * 3), std = shared(Float32Array, K), centroid = shared(Float32Array, K * 3), clean = shared(Float32Array, K * 3);
  const hi = shared(Float32Array, K * 3), lo = shared(Float32Array, K * 3);
  const sq = new Float64Array(K);
  for (let i = 0; i < n; i++) {
    const c = grid.cellOf[i];
    if (c === NONE || eligible[i] !== EVIDENCE) continue;
    const k = c * 3 + cls[fine.cellOf[i]];
    const r = start[i * 3], g = start[i * 3 + 1], b = start[i * 3 + 2];
    cnt[k]++;
    mean[k * 3] += r; mean[k * 3 + 1] += g; mean[k * 3 + 2] += b;
    centroid[k * 3] += s.pos[i * 3]; centroid[k * 3 + 1] += s.pos[i * 3 + 1]; centroid[k * 3 + 2] += s.pos[i * 3 + 2];
    sq[k] += luma(r, g, b) ** 2;
  }
  for (let k = 0; k < K; k++) {
    if (!cnt[k]) continue;
    for (let d = 0; d < 3; d++) {
      mean[k * 3 + d] /= cnt[k];
      centroid[k * 3 + d] /= cnt[k];
    }
    const l = luma(mean[k * 3], mean[k * 3 + 1], mean[k * 3 + 2]);
    std[k] = Math.sqrt(Math.max(0, sq[k] / cnt[k] - l * l));
  }
  // Lighter and darker halves.
  const nHi = new Float32Array(K), nLo = new Float32Array(K);
  for (let i = 0; i < n; i++) {
    const c = grid.cellOf[i];
    if (c === NONE || eligible[i] !== EVIDENCE) continue;
    const k = c * 3 + cls[fine.cellOf[i]];
    const r = start[i * 3], g = start[i * 3 + 1], b = start[i * 3 + 2];
    const into = luma(r, g, b) >= luma(mean[k * 3], mean[k * 3 + 1], mean[k * 3 + 2]) ? hi : lo;
    (into === hi ? nHi : nLo)[k]++;
    into[k * 3] += r; into[k * 3 + 1] += g; into[k * 3 + 2] += b;
  }
  for (let k = 0; k < K; k++) {
    for (let d = 0; d < 3; d++) {
      hi[k * 3 + d] = nHi[k] ? hi[k * 3 + d] / nHi[k] : mean[k * 3 + d];
      lo[k * 3 + d] = nLo[k] ? lo[k * 3 + d] / nLo[k] : mean[k * 3 + d];
    }
  }
  // The clean regional colour: the cells around (same orientation, near in
  // colour), and of those the brighter part — above the weighted
  // `cleanQuantile` of their luma: grime and stains are darker.
  const r = Math.max(1, Math.round(p.regionRadius));
  const nb = new Int32Array((2 * r + 1) ** 3);
  const invD = 1 / (2 * (0.7 * r * size) ** 2);
  const invC = 1 / (2 * 0.2 ** 2);
  const ws = new Float64Array(nb.length), ls = new Float64Array(nb.length);
  const idx: number[] = [];
  const byLuma = (a: number, b: number) => ls[a] - ls[b];
  for (let c = 0; c < grid.cells; c++) {
    const m = neighbourCells(grid, c, nb, r);
    for (let cl = 0; cl < 3; cl++) {
      const k = c * 3 + cl;
      if (!cnt[k]) continue;
      const mr = mean[k * 3], mg = mean[k * 3 + 1], mb = mean[k * 3 + 2];
      let W = 0;
      idx.length = 0;
      for (let t = 0; t < m; t++) {
        const q = nb[t] * 3 + cl;
        if (cnt[q] < 3 && q !== k) continue;
        const dx = centroid[q * 3] - centroid[k * 3], dy = centroid[q * 3 + 1] - centroid[k * 3 + 1], dz = centroid[q * 3 + 2] - centroid[k * 3 + 2];
        const dr = mean[q * 3] - mr, dg = mean[q * 3 + 1] - mg, db = mean[q * 3 + 2] - mb;
        const w = cnt[q] * Math.exp(-(dx * dx + dy * dy + dz * dz) * invD - (dr * dr + dg * dg + db * db) * invC);
        if (!(w > 0)) continue;
        ws[t] = w;
        ls[t] = luma(mean[q * 3], mean[q * 3 + 1], mean[q * 3 + 2]);
        W += w;
        idx.push(t);
      }
      idx.sort(byLuma);
      let acc = 0, W2 = 0, R = 0, G = 0, B = 0;
      for (const t of idx) {
        acc += ws[t];
        if (acc < p.cleanQuantile * W && W2 === 0 && t !== idx[idx.length - 1]) continue;
        const q = nb[t] * 3 + cl;
        W2 += ws[t]; R += ws[t] * mean[q * 3]; G += ws[t] * mean[q * 3 + 1]; B += ws[t] * mean[q * 3 + 2];
      }
      clean[k * 3] = R / W2; clean[k * 3 + 1] = G / W2; clean[k * 3 + 2] = B / W2;
    }
  }
  return { grid, cnt, mean, std, centroid, clean, hi, lo };
}

/** Typical luma of plain asphalt (clean colour of ground-like, neutral, dark cells): the shade the charcoal is set against. */
export function asphaltReference(co: Coarse, groundShare: Float32Array, p: RetouchParams): number {
  const v: [number, number][] = [];
  for (let c = 0; c < co.grid.cells; c++) {
    const k = c * 3 + H;
    if (co.cnt[k] < 3 || groundShare[k] < 0.5) continue;
    const r = co.clean[k * 3], g = co.clean[k * 3 + 1], b = co.clean[k * 3 + 2];
    const l = luma(r, g, b);
    if (l < p.asphaltMaxLum && sat(r, g, b) <= p.asphaltMaxSat) v.push([l, co.cnt[k]]);
  }
  if (!v.length) return luma(...p.charcoal);
  v.sort((a, b) => a[0] - b[0]);
  const total = v.reduce((t, x) => t + x[1], 0);
  let acc = 0;
  for (const [l, w] of v) if ((acc += w) >= total / 2) return l;
  return v[v.length - 1][0];
}

// ── The restoration of each splat ───────────────────────────────────────────

const gain = (to: number, from: number) => Math.min(3, Math.max(0.5, to / Math.max(from, 0.02)));

export type Tally = { retouched: number; ground: number; asphalt: number; walls: number; brick: number };

/**
 * Restore the colours of the splats in coarse cells `c0..c1` into `out`
 * (RGB), from their denoised colour `start`.
 */
export function restorePass(
  s: Splats, start: Float32Array, eligible: Uint8Array, cls: Uint8Array, fine: Grid, ground: Uint8Array,
  co: Coarse, asphaltRef: number, p: RetouchParams, out: Float32Array, tally: Tally, c0 = 0, c1 = co.grid.cells,
  aspht: Uint8Array | null = null,
) {
  const g = co.grid;
  const nb = new Int32Array(27);
  const invL = 1 / (2 * (0.6 * g.size) ** 2);
  const invC = 1 / (2 * 0.2 ** 2);
  for (let c = c0; c < c1; c++) {
    const m = neighbourCells(g, c, nb);
    for (let t = g.start[c]; t < g.start[c + 1]; t++) {
      const i = g.order[t];
      if (!eligible[i]) continue;
      const cl = cls[fine.cellOf[i]];
      const px = s.pos[i * 3], py = s.pos[i * 3 + 1], pz = s.pos[i * 3 + 2];
      const Sr = start[i * 3], Sg = start[i * 3 + 1], Sb = start[i * 3 + 2];
      // L and R around the splat: its own orientation, and cells near its
      // colour (so a kerb, a door's edge or a sign's border does not mix two surfaces).
      let W = 0, Lr = 0, Lg = 0, Lb = 0, Rr = 0, Rg = 0, Rb = 0, tex = 0;
      for (let a = 0; a < m; a++) {
        const k = nb[a] * 3 + cl;
        const cn = co.cnt[k];
        if (!cn) continue;
        const dx = co.centroid[k * 3] - px, dy = co.centroid[k * 3 + 1] - py, dz = co.centroid[k * 3 + 2] - pz;
        const er = co.mean[k * 3] - Sr, eg = co.mean[k * 3 + 1] - Sg, eb = co.mean[k * 3 + 2] - Sb;
        const w = cn * Math.exp(-(dx * dx + dy * dy + dz * dz) * invL - (er * er + eg * eg + eb * eb) * invC);
        W += w;
        Lr += w * co.mean[k * 3]; Lg += w * co.mean[k * 3 + 1]; Lb += w * co.mean[k * 3 + 2];
        Rr += w * co.clean[k * 3]; Rg += w * co.clean[k * 3 + 1]; Rb += w * co.clean[k * 3 + 2];
        tex += w * co.std[k];
      }
      if (!(W > 1e-12)) {
        out[i * 3] = Sr; out[i * 3 + 1] = Sg; out[i * 3 + 2] = Sb;
        continue;
      }
      Lr /= W; Lg /= W; Lb /= W; Rr /= W; Rg /= W; Rb /= W; tex /= W;
      // The blotch (L − R) and the texture (F − L).
      let Br = Lr - Rr, Bg = Lg - Rg, Bb = Lb - Rb;
      let Dr = Sr - Lr, Dg = Sg - Lg, Db = Sb - Lb;
      const bl = luma(Br, Bg, Bb);
      const bmag = Math.sqrt(Br * Br + Bg * Bg + Bb * Bb);
      const Rl = luma(Rr, Rg, Rb);
      const Rs = sat(Rr, Rg, Rb);
      // Darker in every channel (dirt, or shade): may be stronger than other
      // blotches and still be dirt. A sign or a painted door changes hue.
      const darkDirt = bl < 0 && Br <= 0.02 && Bg <= 0.02 && Bb <= 0.02;
      const widen = darkDirt ? p.darkWiden : 1;
      const feature = smoothstep(p.contrastKeep[0] * widen, p.contrastKeep[1] * widen, bmag);
      // Shade: on a coloured surface, darker with the same chromaticity.
      let shade = 0;
      if (bl < 0 && Rs > 0.15) {
        const sL = Lr + Lg + Lb || 1e-6, sR = Rr + Rg + Rb || 1e-6;
        const shift = Math.abs(Lr / sL - Rr / sR) + Math.abs(Lg / sL - Rg / sR) + Math.abs(Lb / sL - Rb / sR);
        shade = p.shadowKeep * (1 - smoothstep(0.01, 0.05, shift));
      }
      // How much this is plain asphalt (smooth, so no speckle where the road meets the pavement).
      const isGround = ground[i] === 1 && cl === H;
      const asph = isGround
        ? (1 - smoothstep(p.asphaltMaxLum - 0.05, p.asphaltMaxLum + 0.05, Rl)) * (1 - smoothstep(p.asphaltMaxSat - 0.04, p.asphaltMaxSat + 0.04, Rs))
        : 0;
      const other = bl < 0 ? (cl === V ? p.grime : p.blemish) : p.blemishLight;
      const sLow = (other + asph * (p.asphaltStain - other)) * (1 - feature) * (1 - shade);
      let sHigh = 0;
      if (asph > 0) {
        const structured = smoothstep(p.texture[0], p.texture[1], tex);
        const dmag = Math.sqrt(Dr * Dr + Dg * Dg + Db * Db);
        sHigh = asph * p.asphaltCut * (1 - structured) * (1 - smoothstep(p.marking[0], p.marking[1], dmag));
      }
      if (aspht) aspht[i] = Math.round(asph * 255);
      if (asph > 0.5) tally.asphalt++;
      else if (cl === V) tally.walls++;
      if (isGround) tally.ground++;
      Br *= 1 - sLow; Bg *= 1 - sLow; Bb *= 1 - sLow;
      Dr *= 1 - sHigh; Dg *= 1 - sHigh; Db *= 1 - sHigh;
      // New asphalt: the clean colour toward charcoal, keeping the light it is in.
      const pull = asph * p.asphaltPull;
      const shadeK = Math.min(1.4, Math.max(0.6, Rl / (asphaltRef || 1e-6)));
      const Pr = Rr + pull * (p.charcoal[0] * shadeK - Rr), Pg = Rg + pull * (p.charcoal[1] * shadeK - Rg), Pb = Rb + pull * (p.charcoal[2] * shadeK - Rb);
      let r = Pr + Br + Dr, gg = Pg + Bg + Dg, b = Pb + Bb + Db;
      if (darkDirt && asph < 1) {
        // Dirt darkens the surface's own colour: undone as a gain per channel,
        // so what lies under it (mortar lines, joints) comes back in proportion.
        const k = 1 - asph;
        r += k * (Sr * gain(Rr + Br, Lr) - r); gg += k * (Sg * gain(Rg + Bg, Lg) - gg); b += k * (Sb * gain(Rb + Bb, Lb) - b);
      }
      // Brick: warm reds and oranges, mid tones, on walls — vibrance and a little light.
      if (cl === V && (p.vibrance || p.lift)) {
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        const sa = mx > 1e-6 ? (mx - mn) / mx : 0;
        if (sa > 0.1 && mx === r) {
          const hue = (((gg - b) / (mx - mn)) * 60 + 360) % 360; // red sector: −60°..60°
          const warm = hue <= 50 ? 1 - smoothstep(35, 50, hue) : smoothstep(330, 350, hue);
          const l = luma(r, gg, b);
          const mid = smoothstep(0.08, 0.18, l) * (1 - smoothstep(0.65, 0.85, l));
          const mem = warm * mid * smoothstep(0.12, 0.25, sa);
          if (mem > 0) {
            const k = 1 + p.vibrance * mem * (1 - sa);
            const lift = 1 + p.lift * mem;
            r = (l + (r - l) * k) * lift; gg = (l + (gg - l) * k) * lift; b = (l + (b - l) * k) * lift;
            tally.brick++;
          }
        }
      }
      out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
      tally.retouched++;
    }
  }
}

// ── Deep: noise and fresh asphalt ───────────────────────────────────────────

const hashUnit = (a: number, b: number, c: number) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth value noise in [−1, 1], fixed in world space (the same grain every time the scene is made). */
export function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let v = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
    v += w * hashUnit(xi + dx, yi + dy, zi + dz);
  }
  return v * 2 - 1;
}

/** Fresh asphalt at a point: charcoal, in `shade` of the light there, with a fine low grain. */
export function freshAsphalt(x: number, y: number, z: number, grain: number, p: RetouchParams, shade: number, out: Float64Array) {
  const g = 0.65 * valueNoise(x / grain, y / grain, z / grain) + 0.35 * valueNoise(x / (3 * grain) + 17.3, y / (3 * grain) - 5.1, z / (3 * grain) + 9.7);
  const k = shade * (1 + p.asphaltGrain * g);
  out[0] = p.charcoal[0] * k; out[1] = p.charcoal[1] * k; out[2] = p.charcoal[2] * k;
}

// ── Deep 1: cars, vans, scooters, carts, people ─────────────────────────────

export type FoundObject = {
  kind: "vehicle" | "small" | "person";
  /** Splats removed with it. */
  splats: number;
  /** Long side, short side, height — metres. */
  size: [number, number, number];
  /** Middle of its footprint, on the ground (file coordinates). */
  centre: Vec3;
  /** Footprint in the ground frame: centre (u, v), unit long axis, half-lengths, top above the ground (file units). */
  cu: number; cv: number; ax: [number, number]; hl: number; hw: number; top: number;
};
export type RejectedObject = { reason: string; splats: number; size: [number, number, number]; centre: Vec3 };
export type ObjectScan = { removed: Uint8Array; objects: FoundObject[]; rejected: RejectedObject[]; components: number };

/** Ground height under (u, v) in the ground frame. */
function levelUV(gm: GroundModel, u: number, v: number): number {
  const { a, b } = gm;
  return groundLevelAt(gm, u * a[0] + v * b[0], u * a[1] + v * b[1], u * a[2] + v * b[2]);
}

const pctl = (v: Float64Array | number[], q: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))];

/**
 * Things standing on the street, found by shape alone (no learning): the
 * opaque splats 0.25–3 m above the ground model, joined into connected
 * pieces cell by cell. A piece that is free-standing (not joined to a wall —
 * then it is part of the wall's piece, far too big), has nothing over it
 * (an awning, a roof, the rest of a pillar) and has the size of a car or van
 * (1.2–2.6 × 2.5–6.5 m, 1–2.4 m tall), a scooter or cart (0.25–1.3 × 1–2.5 m,
 * 0.8–1.7 m tall) or a person (0.2–0.8 m across, 1.2–2 m tall) is removed:
 * its splats, and everything not ground below its top inside its footprint.
 */
export function findObjects(s: Splats, fine: Grid, gm: GroundModel, p: RetouchParams): ObjectScan {
  const n = s.count;
  const M = p.metres;
  const { up, a, b } = gm;
  const hag = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (gm.ground[i]) continue;
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
    const l = groundLevelAt(gm, x, y, z);
    if (!Number.isNaN(l)) hag[i] = x * up[0] + y * up[1] + z * up[2] - l;
  }
  const bandLo = 0.25 * M, bandHi = 3 * M;
  const isCand = (i: number) => s.alpha[i] >= 0.3 && hag[i] >= bandLo && hag[i] <= bandHi;
  const occ = new Uint32Array(fine.cells);
  for (let i = 0; i < n; i++) if (isCand(i)) occ[fine.cellOf[i]]++;
  // Connected pieces: union-find over occupied fine cells (26-neighbours).
  const parent = new Int32Array(fine.cells).fill(-1);
  for (let c = 0; c < fine.cells; c++) if (occ[c]) parent[c] = c;
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const fwd: number[][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dz > 0 || (dz === 0 && (dy > 0 || (dy === 0 && dx > 0)))) fwd.push([dx, dy, dz]);
  }
  for (let c = 0; c < fine.cells; c++) {
    if (!occ[c]) continue;
    const x = fine.key[c * 3], y = fine.key[c * 3 + 1], z = fine.key[c * 3 + 2];
    for (const [dx, dy, dz] of fwd) {
      const d = cellAt(fine, x + dx, y + dy, z + dz);
      if (d >= 0 && occ[d]) {
        const r1 = find(c), r2 = find(d);
        if (r1 !== r2) parent[Math.max(r1, r2)] = Math.min(r1, r2);
      }
    }
  }
  // Group cells by piece.
  const compOf = new Int32Array(fine.cells).fill(-1);
  const sizes: number[] = [];
  const rootIdx = new Map<number, number>();
  for (let c = 0; c < fine.cells; c++) {
    if (!occ[c]) continue;
    const r = find(c);
    let k = rootIdx.get(r);
    if (k === undefined) { k = sizes.length; rootIdx.set(r, k); sizes.push(0); }
    compOf[c] = k;
    sizes[k] += occ[c];
  }
  const minSplats = 60;
  const big: number[] = [];
  sizes.forEach((k, idx) => { if (k >= minSplats) big.push(idx); });
  const cellsOf = new Map<number, number[]>();
  for (const k of big) cellsOf.set(k, []);
  for (let c = 0; c < fine.cells; c++) if (compOf[c] >= 0 && cellsOf.has(compOf[c])) cellsOf.get(compOf[c])!.push(c);

  // An index of everything standing above the ground (for "is anything over it?").
  let above: Grid | null = null;
  const aboveGrid = () => {
    if (above) return above;
    const inc = new Uint8Array(n);
    for (let i = 0; i < n; i++) inc[i] = s.alpha[i] >= 0.3 && hag[i] > bandLo ? 1 : 0;
    above = buildGrid(s.pos, n, 0.25 * M, { axes: [...a, ...b, 0, 0, 0], dims: 2, include: inc });
    return above;
  };

  const objects: FoundObject[] = [];
  const rejected: RejectedObject[] = [];
  for (const k of big) {
    const us: number[] = [], vs: number[] = [], hs: number[] = [];
    for (const c of cellsOf.get(k)!) {
      for (let t = fine.start[c]; t < fine.start[c + 1]; t++) {
        const i = fine.order[t];
        if (!isCand(i)) continue;
        const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
        us.push(x * a[0] + y * a[1] + z * a[2]);
        vs.push(x * b[0] + y * b[1] + z * b[2]);
        hs.push(hag[i]);
      }
    }
    const m = us.length;
    let mu = 0, mv = 0;
    for (let t = 0; t < m; t++) { mu += us[t]; mv += vs[t]; }
    mu /= m; mv /= m;
    let cuu = 0, cuv = 0, cvv = 0;
    for (let t = 0; t < m; t++) {
      const du = us[t] - mu, dv = vs[t] - mv;
      cuu += du * du; cuv += du * dv; cvv += dv * dv;
    }
    const th = 0.5 * Math.atan2(2 * cuv, cuu - cvv);
    const ax: [number, number] = [Math.cos(th), Math.sin(th)];
    const along = new Float64Array(m), side = new Float64Array(m);
    for (let t = 0; t < m; t++) {
      const du = us[t] - mu, dv = vs[t] - mv;
      along[t] = du * ax[0] + dv * ax[1];
      side[t] = -du * ax[1] + dv * ax[0];
    }
    along.sort(); side.sort();
    const hsa = Float64Array.from(hs).sort();
    const a0 = pctl(along, 0.01), a1 = pctl(along, 0.99), s0 = pctl(side, 0.01), s1 = pctl(side, 0.99);
    const top = pctl(hsa, 0.98);
    const cu = mu + ax[0] * (a0 + a1) / 2 - ax[1] * (s0 + s1) / 2;
    const cv = mv + ax[1] * (a0 + a1) / 2 + ax[0] * (s0 + s1) / 2;
    let hl = (a1 - a0) / 2, hw = (s1 - s0) / 2;
    let axis = ax;
    if (hw > hl) { [hl, hw] = [hw, hl]; axis = [-ax[1], ax[0]]; }
    const L = (2 * hl) / M, W = (2 * hw) / M, Ht = top / M;
    const lvl = levelUV(gm, cu, cv);
    const centre: Vec3 = [cu * a[0] + cv * b[0] + lvl * up[0], cu * a[1] + cv * b[1] + lvl * up[1], cu * a[2] + cv * b[2] + lvl * up[2]];
    const size: [number, number, number] = [+L.toFixed(2), +W.toFixed(2), +Ht.toFixed(2)];
    const kind: FoundObject["kind"] | null =
      Ht >= 1 && Ht <= 2.4 && W >= 1.2 && W <= 2.6 && L >= 2.5 && L <= 6.5 ? "vehicle"
      : Ht >= 0.8 && Ht <= 1.7 && W >= 0.25 && W <= 1.3 && L >= 1 && L <= 2.5 ? "small"
      : Ht >= 1.2 && Ht <= 2 && W >= 0.2 && W <= 0.8 && L >= 0.25 && L <= 0.9 && W / L > 0.35 ? "person"
      : null;
    if (!kind) {
      if (L > 0.5 || Ht > 0.5) rejected.push({ reason: L > 6.5 || W > 2.6 ? "too big (a wall, a row of stalls)" : Ht > 2.4 ? "too tall" : "not the size of a car, scooter or person", splats: m, size, centre });
      continue;
    }
    // Anything over it — an awning, a roof, the rest of a pillar: part of the street's fabric, kept.
    const g2 = aboveGrid();
    let over = 0;
    const ext = hl + Math.abs(hw);
    const gx0 = Math.floor((cu - ext - g2.origin[0]) / g2.size), gx1 = Math.floor((cu + ext - g2.origin[0]) / g2.size);
    const gy0 = Math.floor((cv - ext - g2.origin[1]) / g2.size), gy1 = Math.floor((cv + ext - g2.origin[1]) / g2.size);
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
      const c = cellAt(g2, gx, gy, 0);
      if (c < 0) continue;
      for (let t = g2.start[c]; t < g2.start[c + 1]; t++) {
        const i = g2.order[t];
        if (!(hag[i] > top + 0.15 * M && hag[i] < top + 2.5 * M)) continue;
        const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
        const du = x * a[0] + y * a[1] + z * a[2] - cu, dv = x * b[0] + y * b[1] + z * b[2] - cv;
        if (Math.abs(du * axis[0] + dv * axis[1]) <= 0.9 * hl && Math.abs(-du * axis[1] + dv * axis[0]) <= 0.9 * hw) over++;
      }
    }
    if (over >= Math.max(10, 0.02 * m)) {
      rejected.push({ reason: "something over it (awning, roof, pillar)", splats: m, size, centre });
      continue;
    }
    objects.push({ kind, splats: 0, size, centre, cu, cv, ax: axis, hl, hw, top });
  }
  // Remove: everything not ground, below the top, inside the footprint (+10 cm).
  const removed = shared(Uint8Array, n);
  const pad = 0.1 * M;
  for (let i = 0; i < n; i++) {
    if (gm.ground[i] || !objects.length) continue;
    const h = hag[i];
    if (Number.isNaN(h)) continue;
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
    const u = x * a[0] + y * a[1] + z * a[2], v = x * b[0] + y * b[1] + z * b[2];
    for (const o of objects) {
      if (h > o.top + pad || h < -0.3 * M) continue;
      const du = u - o.cu, dv = v - o.cv;
      if (Math.abs(du * o.ax[0] + dv * o.ax[1]) <= o.hl + pad && Math.abs(-du * o.ax[1] + dv * o.ax[0]) <= o.hw + pad) {
        removed[i] = 1;
        o.splats++;
        break;
      }
    }
  }
  return { removed, objects, rejected, components: sizes.length };
}

/** A quaternion (w x y z) turning +z onto `n` (unit). */
function zTo(n: Vec3): [number, number, number, number] {
  const w = 1 + n[2];
  if (w < 1e-6) return [0, 1, 0, 0];
  const l = Math.hypot(w, n[1], n[0]);
  return [w / l, -n[1] / l, n[0] / l, 0];
}

/**
 * New ground where removed objects stood: flat discs on the ground model,
 * as dense, as large, as opaque as the ground around (a ring 1 m wide), lying
 * along the ground, coloured as the restored ground around — fresh asphalt
 * where that is asphalt. Only where the ground there is missing.
 */
export function fillFootprints(
  s: Splats, objects: FoundObject[], gm: GroundModel, colour: Float32Array, aspht: Uint8Array | null, removed: Uint8Array, p: RetouchParams, grain: number,
): { added: Splats; perObject: number[] } {
  const n = s.count;
  const M = p.metres;
  const { up, a, b } = gm;
  const pad = 0.1 * M, ring = 1.1 * M;
  const K = shCoeffs(s.shDegree);
  type Ring = { n: number; s0: number; s1: number; s2: number; alpha: number; inside: number[]; cells: Map<number, number[]> };
  const rings: Ring[] = objects.map(() => ({ n: 0, s0: 0, s1: 0, s2: 0, alpha: 0, inside: [], cells: new Map() }));
  // The ring is binned in cells this big, in the footprint's own frame: a new splat takes the colour of the nearest.
  const cell = 0.25 * M;
  const cellKey = (x: number, y: number) => (Math.floor(x / cell) + 4096) * 8192 + (Math.floor(y / cell) + 4096);
  const local = (o: FoundObject, i: number) => {
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
    const du = x * a[0] + y * a[1] + z * a[2] - o.cu, dv = x * b[0] + y * b[1] + z * b[2] - o.cv;
    return [du * o.ax[0] + dv * o.ax[1], -du * o.ax[1] + dv * o.ax[0]];
  };
  for (let i = 0; i < n; i++) {
    if (!gm.ground[i] || removed[i]) continue;
    objects.forEach((o, k) => {
      const [x, y] = local(o, i);
      if (Math.abs(x) > o.hl + ring || Math.abs(y) > o.hw + ring) return;
      const R = rings[k];
      if (Math.abs(x) <= o.hl + pad && Math.abs(y) <= o.hw + pad) { R.inside.push(i); return; }
      const ls = [s.logScale[i * 3], s.logScale[i * 3 + 1], s.logScale[i * 3 + 2]].sort((p1, q) => q - p1);
      R.n++;
      R.s0 += ls[0]; R.s1 += ls[1]; R.s2 += ls[2];
      R.alpha += s.alpha[i];
      const key = cellKey(x, y);
      let c = R.cells.get(key);
      if (!c) R.cells.set(key, (c = [0, 0, 0, 0, 0, 0, 0]));
      const l = luma(colour[i * 3], colour[i * 3 + 1], colour[i * 3 + 2]);
      c[0]++; c[1] += colour[i * 3]; c[2] += colour[i * 3 + 1]; c[3] += colour[i * 3 + 2]; c[4] += aspht ? aspht[i] / 255 : 0; c[5] += l * l;
      c[6] += s.pos[i * 3] * up[0] + s.pos[i * 3 + 1] * up[1] + s.pos[i * 3 + 2] * up[2];
    });
  }
  const P: number[] = [], C: number[] = [], S: number[] = [], A: number[] = [];
  const q = zTo(up);
  const perObject: number[] = [];
  const tmp = new Float64Array(3);
  objects.forEach((o, k) => {
    const R = rings[k];
    const before = A.length;
    if (R.n < 20) { perObject.push(0); return; }
    const ringArea = (2 * (o.hl + ring)) * (2 * (o.hw + ring)) - (2 * (o.hl + pad)) * (2 * (o.hw + pad));
    const rho = R.n / ringArea;
    const bs = Math.sqrt(16 / rho);
    const nx = Math.max(1, Math.ceil((2 * (o.hl + pad)) / bs)), ny = Math.max(1, Math.ceil((2 * (o.hw + pad)) / bs));
    const bx = (2 * (o.hl + pad)) / nx, by = (2 * (o.hw + pad)) / ny;
    const have = new Int32Array(nx * ny);
    for (const i of R.inside) {
      const [x, y] = local(o, i);
      const ix = Math.min(nx - 1, Math.max(0, Math.floor((x + o.hl + pad) / bx))), iy = Math.min(ny - 1, Math.max(0, Math.floor((y + o.hw + pad) / by)));
      have[ix + iy * nx]++;
    }
    // The nearest ring cells to a point at its own ground level (not the
    // pavement beside a car parked at the kerb): the first square ring of
    // cells that has any, and the next.
    const near = (x: number, y: number, level: number) => {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const acc = [0, 0, 0, 0, 0, 0, 0];
      let found = -1;
      for (let r = 0; r < 64 && (found < 0 || r <= found + 1); r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const c = R.cells.get((cx + dx + 4096) * 8192 + (cy + dy + 4096));
          if (!c || Math.abs(c[6] / c[0] - level) > 0.05 * M) continue;
          if (found < 0) found = r;
          for (let q = 0; q < 7; q++) acc[q] += c[q];
        }
      }
      return acc;
    };
    const want = rho * bx * by;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const add = Math.round(want - have[ix + iy * nx]);
      for (let t = 0; t < add; t++) {
        const r1 = hashUnit(k * 7919 + ix, iy, t), r2 = hashUnit(iy * 104729 + t, ix, k + 1), r3 = hashUnit(t, k, ix * 31 + iy);
        const x = -o.hl - pad + (ix + r1) * bx, y = -o.hw - pad + (iy + r2) * by;
        const u = o.cu + x * o.ax[0] - y * o.ax[1], v = o.cv + x * o.ax[1] + y * o.ax[0];
        const l = levelUV(gm, u, v);
        if (Number.isNaN(l)) continue;
        const px = u * a[0] + v * b[0] + l * up[0], py = u * a[1] + v * b[1] + l * up[1], pz = u * a[2] + v * b[2] + l * up[2];
        const nc = near(x, y, l);
        if (!nc[0]) continue;
        const mr = nc[1] / nc[0], mg = nc[2] / nc[0], mb = nc[3] / nc[0];
        const ml = luma(mr, mg, mb);
        if (nc[4] / nc[0] > 0.5) freshAsphalt(px, py, pz, grain, p, 1, tmp);
        else {
          const sd = Math.sqrt(Math.max(0, nc[5] / nc[0] - ml * ml));
          const j = 1 + ((r3 * 2 - 1) * sd) / Math.max(ml, 0.05);
          tmp[0] = mr * j; tmp[1] = mg * j; tmp[2] = mb * j;
        }
        P.push(px, py, pz);
        C.push(tmp[0], tmp[1], tmp[2]);
        S.push(R.s0 / R.n, R.s1 / R.n, R.s2 / R.n);
        A.push(R.alpha / R.n);
      }
    }
    perObject.push(A.length - before);
  });
  const m = A.length;
  const added: Splats = {
    count: m, shDegree: s.shDegree,
    pos: Float32Array.from(P), dc: Float32Array.from(C.map((c) => (c - 0.5) / SH_C0)), alpha: Float32Array.from(A),
    logScale: Float32Array.from(S), rot: new Float32Array(m * 4), sh: new Float32Array(m * 3 * K),
  };
  for (let i = 0; i < m; i++) added.rot.set(q, i * 4);
  return { added, perObject };
}

// ── Deep 2–5: patches of wall, doors, signs (per coarse cell) ───────────────

export type DeepTables = {
  /** Per coarse key (c·3 + class V): its wall patch (−1: none), and whether it is part of a sign. */
  patchOf: Int32Array;
  sign: Uint8Array;
  /** Per patch: 0 left alone, 1 wall, 2 door or shutter; its two colours (raw `c`, target `t`) — B only when two-toned (brick and mortar). */
  kind: Uint8Array;
  bimodal: Uint8Array;
  cA: Float32Array;
  cB: Float32Array;
  tA: Float32Array;
  tB: Float32Array;
  report: { patches: number; walls: number; twoTone: number; doors: { colour: Vec3; area: number; centre: Vec3 }[]; signs: number; signCells: number };
};

const canon = [0.6, 0.53, 0.6];

/**
 * Wall patches: wall-like coarse cells joined when they face the same way,
 * lie on one plane and share their clean colour — so a shutter or a painted
 * door set in a brick wall is a patch of its own. Sign cells (letters on a
 * board: their luma varies by `signStd` or more, above 1 m) are kept out.
 * Per patch, its clean colours from its cells without grime: brick and
 * mortar where it is two-toned. Doors and shutters: from the street up to at
 * most 4 m, 1.5–20 m², one even colour.
 */
export function deepPrepare(
  s: Splats, start: Float32Array, eligible: Uint8Array, cls: Uint8Array, fine: Grid, normal: Float32Array, co: Coarse, gm: GroundModel, p: RetouchParams,
): DeepTables {
  const g = co.grid;
  const M = p.metres;
  const hc = g.size;
  const nrm = new Float32Array(g.cells * 3);
  for (let i = 0; i < s.count; i++) {
    const c = g.cellOf[i];
    if (c === NONE || eligible[i] !== EVIDENCE) continue;
    const f = fine.cellOf[i];
    if (cls[f] !== V) continue;
    let nx = normal[f * 3], ny = normal[f * 3 + 1], nz = normal[f * 3 + 2];
    if (nx * canon[0] + ny * canon[1] + nz * canon[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nrm[c * 3] += nx; nrm[c * 3 + 1] += ny; nrm[c * 3 + 2] += nz;
  }
  const hagC = new Float32Array(g.cells).fill(NaN);
  const { up } = gm;
  for (let c = 0; c < g.cells; c++) {
    const k = c * 3 + V;
    const l = Math.hypot(nrm[c * 3], nrm[c * 3 + 1], nrm[c * 3 + 2]) || 1;
    nrm[c * 3] /= l; nrm[c * 3 + 1] /= l; nrm[c * 3 + 2] /= l;
    if (!co.cnt[k]) continue;
    const x = co.centroid[k * 3], y = co.centroid[k * 3 + 1], z = co.centroid[k * 3 + 2];
    const lv = groundLevelAt(gm, x, y, z);
    hagC[c] = Number.isNaN(lv) ? NaN : x * up[0] + y * up[1] + z * up[2] - lv;
  }
  const isWall = (c: number) => co.cnt[c * 3 + V] >= 3;
  // Signs: seeds, grown by one cell.
  const seed = new Uint8Array(g.cells);
  for (let c = 0; c < g.cells; c++) if (isWall(c) && co.std[c * 3 + V] >= p.signStd && hagC[c] >= 1 * M) seed[c] = 1;
  const sign = shared(Uint8Array, g.cells * 3);
  const nb = new Int32Array(27);
  for (let c = 0; c < g.cells; c++) {
    if (!seed[c]) continue;
    const m = neighbourCells(g, c, nb);
    for (let t = 0; t < m; t++) if (co.cnt[nb[t] * 3 + V]) sign[nb[t] * 3 + V] = 1;
  }
  // Union-find over wall cells (not sign).
  const parent = new Int32Array(g.cells).fill(-1);
  for (let c = 0; c < g.cells; c++) if (isWall(c) && !sign[c * 3 + V]) parent[c] = c;
  const find = (x: number) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const signParent = new Int32Array(g.cells).fill(-1);
  for (let c = 0; c < g.cells; c++) if (sign[c * 3 + V]) signParent[c] = c;
  const findS = (x: number) => {
    while (signParent[x] !== x) { signParent[x] = signParent[signParent[x]]; x = signParent[x]; }
    return x;
  };
  // Patches grow by the most alike neighbours first, and two patches join
  // only while their own mean clean colours agree — so a shutter never leaks
  // into the brick round it through the half-and-half cells along its edge.
  const edges: number[] = [];
  const dE: number[] = [];
  for (let c = 0; c < g.cells; c++) {
    const m = neighbourCells(g, c, nb);
    if (parent[c] >= 0) {
      const kc = c * 3 + V;
      for (let t = 0; t < m; t++) {
        const d = nb[t];
        if (d <= c || parent[d] < 0) continue;
        const kd = d * 3 + V;
        const dot = nrm[c * 3] * nrm[d * 3] + nrm[c * 3 + 1] * nrm[d * 3 + 1] + nrm[c * 3 + 2] * nrm[d * 3 + 2];
        if (Math.abs(dot) < 0.9) continue;
        const off = (co.centroid[kd * 3] - co.centroid[kc * 3]) * nrm[c * 3] + (co.centroid[kd * 3 + 1] - co.centroid[kc * 3 + 1]) * nrm[c * 3 + 1] + (co.centroid[kd * 3 + 2] - co.centroid[kc * 3 + 2]) * nrm[c * 3 + 2];
        if (Math.abs(off) > 0.5 * hc) continue;
        const dr = co.clean[kd * 3] - co.clean[kc * 3], dg = co.clean[kd * 3 + 1] - co.clean[kc * 3 + 1], db = co.clean[kd * 3 + 2] - co.clean[kc * 3 + 2];
        const e = Math.sqrt(dr * dr + dg * dg + db * db);
        if (e > 0.1) continue;
        edges.push(c, d);
        dE.push(e);
      }
    }
    if (signParent[c] >= 0) {
      for (let t = 0; t < m; t++) {
        const d = nb[t];
        if (signParent[d] < 0) continue;
        const r1 = findS(c), r2 = findS(d);
        if (r1 !== r2) signParent[Math.max(r1, r2)] = Math.min(r1, r2);
      }
    }
  }
  const byE = Array.from(dE.keys()).sort((x, y) => dE[x] - dE[y] || edges[2 * x] - edges[2 * y] || edges[2 * x + 1] - edges[2 * y + 1]);
  const setW = new Float64Array(g.cells), setC = new Float64Array(g.cells * 3);
  for (let c = 0; c < g.cells; c++) {
    if (parent[c] < 0) continue;
    const k = c * 3 + V, w = co.cnt[k];
    setW[c] = w;
    setC[c * 3] = w * co.clean[k * 3]; setC[c * 3 + 1] = w * co.clean[k * 3 + 1]; setC[c * 3 + 2] = w * co.clean[k * 3 + 2];
  }
  for (const e of byE) {
    const r1 = find(edges[2 * e]), r2 = find(edges[2 * e + 1]);
    if (r1 === r2) continue;
    const d0 = setC[r1 * 3] / setW[r1] - setC[r2 * 3] / setW[r2];
    const d1 = setC[r1 * 3 + 1] / setW[r1] - setC[r2 * 3 + 1] / setW[r2];
    const d2 = setC[r1 * 3 + 2] / setW[r1] - setC[r2 * 3 + 2] / setW[r2];
    if (d0 * d0 + d1 * d1 + d2 * d2 > 0.1 * 0.1) continue;
    const root = Math.min(r1, r2), other = Math.max(r1, r2);
    parent[other] = root;
    setW[root] += setW[other];
    for (let d = 0; d < 3; d++) setC[root * 3 + d] += setC[other * 3 + d];
  }
  let signs = 0, signCells = 0;
  for (let c = 0; c < g.cells; c++) if (signParent[c] >= 0) { signCells++; if (findS(c) === c) signs++; }
  // Patches and their cells.
  const patchOf = shared(Int32Array, g.cells * 3).fill(-1);
  const ids = new Map<number, number>();
  const members: number[][] = [];
  for (let c = 0; c < g.cells; c++) {
    if (parent[c] < 0) continue;
    const r = find(c);
    let id = ids.get(r);
    if (id === undefined) { id = members.length; ids.set(r, id); members.push([]); }
    members[id].push(c);
    patchOf[c * 3 + V] = id;
  }
  const P = members.length;
  const kind = shared(Uint8Array, P), bimodal = shared(Uint8Array, P);
  const cA = shared(Float32Array, P * 3), cB = shared(Float32Array, P * 3), tA = shared(Float32Array, P * 3), tB = shared(Float32Array, P * 3);
  const med = (cells: number[], arr: Float32Array, d: number) => {
    const v = cells.map((c) => arr[(c * 3 + V) * 3 + d]).sort((x, y) => x - y);
    return v[v.length >> 1];
  };
  // The colours of the splats of each small patch (a door's own colour, not its edge cells').
  const small = members.map((cells) => cells.length * (hc / M) ** 2 <= 20);
  const own: number[][] = members.map(() => []);
  for (let i = 0; i < s.count; i++) {
    const c = g.cellOf[i];
    if (c === NONE || eligible[i] !== EVIDENCE || cls[fine.cellOf[i]] !== V) continue;
    const id = patchOf[c * 3 + V];
    if (id >= 0 && small[id]) own[id].push(start[i * 3], start[i * 3 + 1], start[i * 3 + 2]);
  }
  const ownMedian = (v: number[]): Vec3 => [0, 1, 2].map((d) => {
    const x: number[] = [];
    for (let k = d; k < v.length; k += 3) x.push(v[k]);
    x.sort((p1, q) => p1 - q);
    return x[x.length >> 1];
  }) as Vec3;
  const doors: DeepTables["report"]["doors"] = [];
  let walls = 0, twoTone = 0;
  for (let id = 0; id < P; id++) {
    const cells = members[id];
    const area = cells.length * (hc / M) ** 2;
    let lo = Infinity, hi = -Infinity, l1 = 0, l2 = 0;
    for (const c of cells) {
      if (!Number.isNaN(hagC[c])) { lo = Math.min(lo, hagC[c]); hi = Math.max(hi, hagC[c]); }
      const k = c * 3 + V;
      const l = luma(co.clean[k * 3], co.clean[k * 3 + 1], co.clean[k * 3 + 2]);
      l1 += l; l2 += l * l;
    }
    const lstd = Math.sqrt(Math.max(0, l2 / cells.length - (l1 / cells.length) ** 2));
    // Cells without grime: their mean is near their clean colour.
    const cleanCells = cells.filter((c) => {
      const k = c * 3 + V;
      return Math.abs(luma(co.mean[k * 3], co.mean[k * 3 + 1], co.mean[k * 3 + 2]) - luma(co.clean[k * 3], co.clean[k * 3 + 1], co.clean[k * 3 + 2])) < 0.04;
    });
    const use = cleanCells.length >= Math.max(1, cells.length * 0.2) ? cleanCells : cells;
    const A = [0, 1, 2].map((d) => med(use, co.lo, d)) as Vec3;
    const B = [0, 1, 2].map((d) => med(use, co.hi, d)) as Vec3;
    const C = [0, 1, 2].map((d) => med(use, co.clean, d)) as Vec3;
    // Two-toned (brick and mortar) only when large enough to tell: a small patch's cells straddle its edge.
    const two = area >= 4 && luma(...B) - luma(...A) >= 0.12;
    const isDoor = lo <= 0.6 * M && hi <= 4 * M && area >= 1.5 && area <= 20 && lstd < 0.07 && !two;
    if (area < 0.5 && !isDoor) continue;
    kind[id] = isDoor ? 2 : 1;
    const boost = (c: Vec3, satK: number, valK: number): Vec3 => {
      const l = luma(...c);
      return [0, 1, 2].map((d) => Math.max(0, (l + (c[d] - l) * (1 + satK)) * valK)) as Vec3;
    };
    if (isDoor) {
      const D = own[id].length >= 60 ? ownMedian(own[id]) : C;
      cA.set(D, id * 3);
      tA.set(boost(D, p.doorSat, 1.06), id * 3);
      if (doors.length < 40) {
        const k = cells[cells.length >> 1] * 3 + V;
        doors.push({ colour: tA.slice(id * 3, id * 3 + 3).map((v) => +v.toFixed(3)) as unknown as Vec3, area: +area.toFixed(1), centre: [co.centroid[k * 3], co.centroid[k * 3 + 1], co.centroid[k * 3 + 2]].map((v) => +v.toFixed(2)) as Vec3 });
      }
    } else if (two) {
      twoTone++;
      bimodal[id] = 1;
      // Mortar: the less saturated of the two; brick: the other.
      const aMortar = sat(...A) < sat(...B);
      const mortar = aMortar ? A : B, brick = aMortar ? B : A;
      const mT = [0, 1, 2].map((d) => mortar[d] + 0.7 * (p.mortarGrey[d] - mortar[d])) as Vec3;
      const bT = boost(brick, p.vibrance * 0.5, 1 + p.lift);
      cA.set(A, id * 3); cB.set(B, id * 3);
      tA.set(aMortar ? mT : bT, id * 3); tB.set(aMortar ? bT : mT, id * 3);
    } else {
      cA.set(C, id * 3);
      tA.set(boost(C, p.vibrance * 0.3, 1 + p.lift * 0.5), id * 3);
    }
    if (!isDoor) walls++;
  }
  return { patchOf, sign, kind, bimodal, cA, cB, tA, tB, report: { patches: P, walls, twoTone, doors, signs, signCells } };
}

export type DeepTally = { asphalt: number; markings: number; stones: number; joints: number; wall: number; structure: number; dirt: number; door: number; sign: number };
export const emptyDeepTally = (): DeepTally => ({ asphalt: 0, markings: 0, stones: 0, joints: 0, wall: 0, structure: 0, dirt: 0, door: 0, sign: 0 });

/**
 * The deep colours of the splats in coarse cells `c0..c1`, over their
 * restored colour `out`: fresh asphalt and clean markings; paving stones
 * and joints each one even colour; walls pulled to their patch's clean
 * colour (structure kept, dirt not); doors and shutters repainted, their
 * ribs kept; signs only sharpened.
 */
export function deepPass(
  s: Splats, start: Float32Array, out: Float32Array, eligible: Uint8Array, cls: Uint8Array, fine: Grid, ground: Uint8Array,
  aspht: Uint8Array, edge: Uint8Array, co: Coarse, tb: DeepTables, asphaltRef: number, grain: number, p: RetouchParams,
  tally: DeepTally, c0 = 0, c1 = co.grid.cells,
) {
  const g = co.grid;
  const nb = new Int32Array(27);
  const invL = 1 / (2 * (0.6 * g.size) ** 2);
  const invC = 1 / (2 * 0.2 ** 2);
  const fresh = new Float64Array(3);
  const mix = (i: number, r: number, gg: number, b: number, w: number) => {
    out[i * 3] += w * (r - out[i * 3]); out[i * 3 + 1] += w * (gg - out[i * 3 + 1]); out[i * 3 + 2] += w * (b - out[i * 3 + 2]);
  };
  for (let c = c0; c < c1; c++) {
    const m = neighbourCells(g, c, nb);
    for (let t = g.start[c]; t < g.start[c + 1]; t++) {
      const i = g.order[t];
      if (!eligible[i]) continue;
      const cl = cls[fine.cellOf[i]];
      if (cl === O) continue;
      const px = s.pos[i * 3], py = s.pos[i * 3 + 1], pz = s.pos[i * 3 + 2];
      const Sr = start[i * 3], Sg = start[i * 3 + 1], Sb = start[i * 3 + 2];
      let W = 0, Lr = 0, Lg = 0, Lb = 0, Rl = 0, tex = 0, Hr = 0, Hg = 0, Hb = 0, Or = 0, Og = 0, Ob = 0;
      for (let a = 0; a < m; a++) {
        const k = nb[a] * 3 + cl;
        const cn = co.cnt[k];
        if (!cn) continue;
        const dx = co.centroid[k * 3] - px, dy = co.centroid[k * 3 + 1] - py, dz = co.centroid[k * 3 + 2] - pz;
        const er = co.mean[k * 3] - Sr, eg = co.mean[k * 3 + 1] - Sg, eb = co.mean[k * 3 + 2] - Sb;
        const w = cn * Math.exp(-(dx * dx + dy * dy + dz * dz) * invL - (er * er + eg * eg + eb * eb) * invC);
        W += w;
        Lr += w * co.mean[k * 3]; Lg += w * co.mean[k * 3 + 1]; Lb += w * co.mean[k * 3 + 2];
        Rl += w * luma(co.clean[k * 3], co.clean[k * 3 + 1], co.clean[k * 3 + 2]);
        tex += w * co.std[k];
        Hr += w * co.hi[k * 3]; Hg += w * co.hi[k * 3 + 1]; Hb += w * co.hi[k * 3 + 2];
        Or += w * co.lo[k * 3]; Og += w * co.lo[k * 3 + 1]; Ob += w * co.lo[k * 3 + 2];
      }
      if (!(W > 1e-12)) continue;
      Lr /= W; Lg /= W; Lb /= W; Rl /= W; tex /= W; Hr /= W; Hg /= W; Hb /= W; Or /= W; Og /= W; Ob /= W;
      const Sl = luma(Sr, Sg, Sb), Ll = luma(Lr, Lg, Lb);
      if (cl === H) {
        if (!ground[i]) continue;
        const asph = aspht[i] / 255;
        if (asph > 0) {
          const shadeK = Math.min(1.4, Math.max(0.6, Rl / (asphaltRef || 1e-6)));
          freshAsphalt(px, py, pz, grain, p, 1 + (shadeK - 1) * (1 - p.asphaltFlatten), fresh);
          mix(i, fresh[0], fresh[1], fresh[2], asph);
          if (asph > 0.5) tally.asphalt++;
          // Road markings: bright on the asphalt — repainted clean white or yellow.
          const mk = smoothstep(0.1, 0.22, Sl - Ll) * smoothstep(0.38, 0.5, Sl) * asph;
          if (mk > 0) {
            const yellow = Sr - Sb > 0.12 && Sg - Sb > 0.08;
            const col = yellow ? p.markingYellow : p.markingWhite;
            mix(i, col[0], col[1], col[2], mk);
            if (mk > 0.5) tally.markings++;
          }
        }
        if (asph < 0.5 && tex >= p.texture[0]) {
          // Paving: stones one even colour, joints clean.
          const thr = (luma(Hr, Hg, Hb) + luma(Or, Og, Ob)) / 2;
          const w = p.pavePull * (1 - asph) * smoothstep(p.texture[0], p.texture[1], tex);
          if (Sl >= thr) {
            mix(i, Hr, Hg, Hb, w);
            tally.stones++;
          } else {
            const jl = luma(Or, Og, Ob) * 1.15;
            mix(i, (Or + jl) / 2, (Og + jl) / 2, (Ob + jl) / 2, w);
            tally.joints++;
          }
        }
        continue;
      }
      // Walls (V).
      const kv = c * 3 + V;
      if (tb.sign[kv]) {
        // A sign: as it is, denoised, a little more contrast and colour.
        let r = Lr + (Sr - Lr) * (1 + p.signContrast), gg = Lg + (Sg - Lg) * (1 + p.signContrast), b = Lb + (Sb - Lb) * (1 + p.signContrast);
        const l = luma(r, gg, b);
        r = l + (r - l) * (1 + p.signSat); gg = l + (gg - l) * (1 + p.signSat); b = l + (b - l) * (1 + p.signSat);
        out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
        tally.sign++;
        continue;
      }
      const id = tb.patchOf[kv];
      if (id < 0 || !tb.kind[id]) continue;
      const or = out[i * 3], og = out[i * 3 + 1], ob = out[i * 3 + 2];
      const ol = luma(or, og, ob);
      let T0: number, T1: number, T2: number, C0: number, C1: number, C2: number;
      if (tb.kind[id] === 2) {
        // Door or shutter: its dominant colour; ribs kept as a gentle stripe.
        const Ol = luma(0.5 + SH_C0 * s.dc[i * 3], 0.5 + SH_C0 * s.dc[i * 3 + 1], 0.5 + SH_C0 * s.dc[i * 3 + 2]);
        const rib = 1 + (p.ribKeep * (Ol - Ll)) / Math.max(Ll, 0.05);
        T0 = tb.tA[id * 3] * rib; T1 = tb.tA[id * 3 + 1] * rib; T2 = tb.tA[id * 3 + 2] * rib;
        C0 = tb.cA[id * 3]; C1 = tb.cA[id * 3 + 1]; C2 = tb.cA[id * 3 + 2];
        tally.door++;
      } else {
        let useB = false;
        // Which tone this splat is (brick or mortar): lighter or darker than
        // the middle of the local two — dirt darkens both, so it does not decide.
        if (tb.bimodal[id]) useB = Sl >= (luma(Hr, Hg, Hb) + luma(Or, Og, Ob)) / 2;
        const T = useB ? tb.tB : tb.tA, Cc = useB ? tb.cB : tb.cA;
        T0 = T[id * 3]; T1 = T[id * 3 + 1]; T2 = T[id * 3 + 2];
        C0 = Cc[id * 3]; C1 = Cc[id * 3 + 1]; C2 = Cc[id * 3 + 2];
        tally.wall++;
      }
      const dist = Math.sqrt((or - C0) ** 2 + (og - C1) ** 2 + (ob - C2) ** 2);
      const cl2 = luma(C0, C1, C2);
      const dirt = ol < cl2 && sat(or, og, ob) <= sat(C0, C1, C2) + 0.08;
      const structure = dirt ? (edge[i] >= 90 && ol < 0.45 * cl2 ? 1 : 0) : smoothstep(0.18, 0.32, dist);
      if (structure > 0.5) tally.structure++;
      else if (dirt && dist > 0.05) tally.dirt++;
      mix(i, T0, T1, T2, p.wallPull * (1 - structure));
    }
  }
}

// ── Work in parallel ────────────────────────────────────────────────────────

export type TaskName = "fine" | "restore" | "deep";

/**
 * Worker threads (`scripts/retouch-worker.mts`): `run` sends each range of
 * cells, with `ctx` (its big arrays on shared memory, so not copied), to a
 * free worker, which calls `runTask`; results come back in range order.
 */
export type Pool = { size: number; run(task: TaskName, ctx: object, ranges: [number, number][]): Promise<unknown[]> };

/** One range of one pass — in a worker, or here. */
export function runTask(task: TaskName, ctx: any, from: number, to: number): unknown {
  switch (task) {
    case "fine":
      finePass(ctx.s, ctx.rgb, ctx.eligible, ctx.g, ctx.p, ctx.out, from, to);
      return null;
    case "restore": {
      const t: Tally = { retouched: 0, ground: 0, asphalt: 0, walls: 0, brick: 0 };
      restorePass(ctx.s, ctx.start, ctx.eligible, ctx.cls, ctx.fine, ctx.ground, ctx.co, ctx.asphaltRef, ctx.p, ctx.out, t, from, to, ctx.aspht);
      return t;
    }
    case "deep": {
      const t = emptyDeepTally();
      deepPass(ctx.s, ctx.start, ctx.out, ctx.eligible, ctx.cls, ctx.fine, ctx.ground, ctx.aspht, ctx.edge, ctx.co, ctx.tb, ctx.asphaltRef, ctx.grain, ctx.p, t, from, to);
      return t;
    }
  }
}

function addUp<T extends Record<string, number>>(into: T, parts: unknown[]) {
  for (const x of parts) if (x) for (const k of Object.keys(into)) (into as Record<string, number>)[k] += (x as Record<string, number>)[k];
  return into;
}

// ── The whole retouch ───────────────────────────────────────────────────────

export type DeepReport = {
  objects: FoundObject[];
  rejected: RejectedObject[];
  components: number;
  removedSplats: number;
  filledSplats: number;
  filledPerObject: number[];
  tables: DeepTables["report"];
  tally: DeepTally;
};

export type RetouchReport = {
  preset: string;
  splats: number;
  kept: number;
  floaters: number;
  eligible: number;
  fineCell: number;
  coarseCell: number;
  fineCells: number;
  coarseCells: number;
  up: Vec3;
  groundColumns: number;
  roofColumns: number;
  asphaltLuma: number;
  tally: Tally;
  deep: DeepReport | null;
  threads: number;
  ms: Record<string, number>;
};

export type RetouchHooks = {
  /** Called between blocks of work: give the event loop a turn (a server job) — or nothing (a CLI). */
  pause?: () => Promise<void> | void;
  step?: (what: string) => void;
  /** Worker threads for the heavy passes (the CLI makes them); none: all here, in blocks. */
  pool?: Pool;
};

/**
 * Retouch `s` in place: its colours (SH DC) restored, its view-dependent SH
 * scaled by `shKeep`. Returns `keep` (0 for floaters — and, in "deep", for
 * removed cars and people — to leave out when writing), `added` (deep: the
 * new ground where they stood; null otherwise) and a report. Positions,
 * scales and rotations of kept splats are never touched.
 */
export async function retouch(s: Splats, params: Partial<RetouchParams> & { preset?: RetouchPreset } = {}, hooks: RetouchHooks = {}) {
  const preset = params.preset ?? "full";
  const p: RetouchParams = { ...PRESETS[preset], ...stripUndefined(params) };
  const n = s.count;
  const ms: Record<string, number> = {};
  let t0 = Date.now();
  const lap = (name: string) => {
    const t = Date.now();
    ms[name] = t - t0;
    t0 = t;
  };
  const pause = hooks.pause ?? (() => {});
  const step = hooks.step ?? (() => {});
  const pool = hooks.pool && hooks.pool.size > 1 ? hooks.pool : null;
  /** Run `task` over `cells` cells: on the workers in many ranges, or here in blocks with pauses. */
  const spread = async (task: TaskName, ctx: object, cells: number, block: number): Promise<unknown[]> => {
    if (pool) {
      const parts = Math.min(cells, pool.size * 32);
      const ranges: [number, number][] = [];
      for (let k = 0; k < parts; k++) ranges.push([Math.floor((k * cells) / parts), Math.floor(((k + 1) * cells) / parts)]);
      return pool.run(task, ctx, ranges);
    }
    const res: unknown[] = [];
    for (let c = 0; c < cells; c += block) {
      res.push(runTask(task, ctx, c, Math.min(cells, c + block)));
      await pause();
    }
    return res;
  };

  // Colours.
  step("measuring");
  const rgb = shared(Float32Array, n * 3);
  for (let k = 0; k < n * 3; k++) rgb[k] = 0.5 + SH_C0 * s.dc[k];
  lap("measure");

  // a. The fine voxel hash (every splat: floaters are found there too).
  step("indexing");
  const fine = fineGrid(s, p.cellTarget, null);
  const scaleCap = Math.log(p.maxScaleCells * fine.size);
  const eligible = shared(Uint8Array, n);
  let nEligible = 0;
  for (let i = 0; i < n; i++) {
    const a = s.alpha[i];
    if (a < p.receiveAlpha || Math.max(s.logScale[i * 3], s.logScale[i * 3 + 1], s.logScale[i * 3 + 2]) > scaleCap) continue;
    eligible[i] = a >= p.minAlpha ? EVIDENCE : RECEIVES;
    nEligible++;
  }
  lap("index");
  await pause();

  // b. Normals, the bilateral filter, floaters.
  step("smoothing");
  const fp: FinePass = {
    fine: shared(Float32Array, n * 3), normal: shared(Float32Array, fine.cells * 3), planarity: shared(Float32Array, fine.cells),
    floater: shared(Uint8Array, n), edge: shared(Uint8Array, n),
  };
  await spread("fine", { s, rgb, eligible, g: fine, p, out: fp }, fine.cells, 2000); // ~50 ms blocks at 9M splats
  const start = fp.fine;
  for (let k = 0; k < n * 3; k++) start[k] = rgb[k] + p.smooth * (start[k] - rgb[k]);
  lap("smooth");

  const up = refineUp(fine, fp.normal, fp.planarity, p.up);
  const cls = sharedCopy(Uint8Array, cellClasses(fine, fp.normal, fp.planarity, up));

  // c. The ground (a parked car's roof is not ground).
  step("finding the ground");
  const coarseSize = p.coarseCell > 0 ? Math.max(p.coarseCell, 2 * fine.size) : fine.size * p.coarseFactor;
  const candidate = new Uint8Array(n);
  for (let i = 0; i < n; i++) candidate[i] = eligible[i] === EVIDENCE && cls[fine.cellOf[i]] === H ? 1 : 0;
  const gm = findGround(s, candidate, up, coarseSize, p.groundTol * fine.size, 0.35 * p.metres, 2 * p.metres);
  lap("ground");
  await pause();

  // Deep 1: cars, vans, scooters, people — out before anything reads the surfaces.
  let scan: ObjectScan | null = null;
  if (p.deep && p.removeObjects) {
    step("finding cars and people");
    scan = findObjects(s, fine, gm, p);
    for (let i = 0; i < n; i++) if (scan.removed[i]) eligible[i] = UNTOUCHED;
    lap("objects");
    await pause();
  }

  // d. Local and clean regional colours.
  step("reading the surfaces");
  const co = coarseStats(s, start, eligible, cls, fine, coarseSize, p);
  const groundShare = new Float32Array(co.cnt.length);
  for (let i = 0; i < n; i++) if (gm.ground[i] && co.grid.cellOf[i] !== NONE) groundShare[co.grid.cellOf[i] * 3 + H]++;
  for (let k = 0; k < groundShare.length; k++) groundShare[k] = co.cnt[k] ? groundShare[k] / co.cnt[k] : 0;
  const asphaltLuma = asphaltReference(co, groundShare, p);
  lap("surfaces");
  await pause();

  step("restoring");
  const out = rgb; // restored in place of the original colours (no longer needed)
  for (let k = 0; k < n * 3; k++) if (eligible[(k / 3) | 0]) out[k] = start[k];
  const aspht = p.deep ? shared(Uint8Array, n) : null;
  const tally = addUp<Tally>({ retouched: 0, ground: 0, asphalt: 0, walls: 0, brick: 0 }, await spread(
    "restore", { s, start, eligible, cls, fine, ground: gm.ground, co, asphaltRef: asphaltLuma, p, out, aspht }, co.grid.cells, 300,
  ));
  lap("restore");

  // Deep 2–5: asphalt, paving, walls, doors, signs.
  const grain = 0.03 * p.metres;
  let tables: DeepTables | null = null;
  let deepTally: DeepTally | null = null;
  if (p.deep && aspht) {
    step("deep: walls, doors, signs");
    tables = deepPrepare(s, start, eligible, cls, fine, fp.normal, co, gm, p);
    lap("deepPrepare");
    step("deep: repainting");
    deepTally = addUp(emptyDeepTally(), await spread(
      "deep", { s, start, out, eligible, cls, fine, ground: gm.ground, aspht, edge: fp.edge, co, tb: tables, asphaltRef: asphaltLuma, grain, p },
      co.grid.cells, 300,
    ));
    lap("deepPass");
  }

  // Back to SH DC, only where retouched (the others keep their exact bits).
  for (let i = 0; i < n; i++) {
    if (!eligible[i]) continue;
    for (let d = 0; d < 3; d++) {
      const orig = 0.5 + SH_C0 * s.dc[i * 3 + d];
      const v = Math.min(Math.max(out[i * 3 + d], Math.min(0, orig)), Math.max(1, orig));
      s.dc[i * 3 + d] = (v - 0.5) / SH_C0;
    }
  }
  if (p.shKeep !== 1) for (let k = 0; k < s.sh.length; k++) s.sh[k] *= p.shKeep;

  const keep = new Uint8Array(n);
  let kept = 0, removedSplats = 0;
  for (let i = 0; i < n; i++) {
    if (scan?.removed[i]) { removedSplats++; continue; }
    if (!fp.floater[i]) { keep[i] = 1; kept++; }
  }
  lap("finish");

  // Deep 1 (end): new ground where the objects stood.
  let added: Splats | null = null;
  let filledPerObject: number[] = [];
  if (scan && scan.objects.length) {
    step("filling the ground");
    const f = fillFootprints(s, scan.objects, gm, out, aspht, scan.removed, p, grain);
    added = f.added;
    filledPerObject = f.perObject;
    lap("fill");
  }

  const report: RetouchReport = {
    preset, splats: n, kept, floaters: n - kept - removedSplats, eligible: nEligible,
    fineCell: fine.size, coarseCell: coarseSize, fineCells: fine.cells, coarseCells: co.grid.cells,
    up, groundColumns: gm.columns, roofColumns: gm.roofs, asphaltLuma, tally,
    deep: p.deep ? {
      objects: scan?.objects ?? [], rejected: scan?.rejected ?? [], components: scan?.components ?? 0,
      removedSplats, filledSplats: added?.count ?? 0, filledPerObject,
      tables: tables!.report, tally: deepTally!,
    } : null,
    threads: pool ? pool.size : 1,
    ms,
  };
  return { keep, added, report };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && k !== "preset") (r as Record<string, unknown>)[k] = v;
  return r;
}
