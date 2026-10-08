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
};

/** "full": the restored street. "gentle": cleaned, still clearly the filmed place. */
export const PRESETS: Record<"gentle" | "full", RetouchParams> = {
  full: BASE,
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
  const cellOf = new Uint32Array(n);
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
  const start = new Uint32Array(cells + 1);
  for (let i = 0; i < n; i++) if (cellOf[i] !== NONE) start[cellOf[i] + 1]++;
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cells);
  const order = new Uint32Array(start[cells]);
  for (let i = 0; i < n; i++) if (cellOf[i] !== NONE) order[fill[cellOf[i]]++] = i;
  return { size, dims, axes, origin, cells, cellOf, start, order, key: key.subarray(0, cells * 3), tKey, tId, mask };
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
          if (e2 > edge2) continue;
          const dn = (dx * nx + dy * ny + dz * nz) * usePlane;
          const w = alpha[j] * Math.exp(-(d2 * invS + dn * dn * invN + e2 * invR));
          W += w;
          SR += w * rgb[j * 3]; SG += w * rgb[j * 3 + 1]; SB += w * rgb[j * 3 + 2];
        }
      }
      out.fine[i * 3] = SR / W; out.fine[i * 3 + 1] = SG / W; out.fine[i * 3 + 2] = SB / W;
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

/**
 * Ground splats: per column (cell `size` across, looking down `up`), the
 * lowest dense layer of ground-like splats — the lowest height window `tol`
 * thick holding at least a tenth of the column's densest window (so stray
 * splats below the street do not count). Columns with no ground take their
 * neighbours'. Marks `ground[i] = 1` for ground-like splats within `tol`.
 */
export function findGround(
  s: Splats, candidate: Uint8Array, up: Vec3, size: number, tol: number,
): { ground: Uint8Array; columns: number; withGround: number } {
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
  // Fill gaps (under a parked cart, a dark corner) from the columns around.
  const nb = new Int32Array(9);
  const filled = level.slice();
  for (let c = 0; c < g.cells; c++) {
    if (!Number.isNaN(level[c])) continue;
    const m = neighbourCells(g, c, nb);
    let sum = 0, cnt = 0;
    for (let t = 0; t < m; t++) if (!Number.isNaN(level[nb[t]])) { sum += level[nb[t]]; cnt++; }
    if (cnt) filled[c] = sum / cnt;
  }
  const ground = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = g.cellOf[i];
    if (c === NONE) continue;
    const l = filled[c];
    if (!Number.isNaN(l) && Math.abs(heightOf(i) - l) <= tol) ground[i] = 1;
  }
  return { ground, columns: g.cells, withGround };
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
};

/** Per coarse cell and orientation class: mean colour, its texture (luma std), centroid; then each one's clean regional colour. */
export function coarseStats(s: Splats, start: Float32Array, eligible: Uint8Array, cls: Uint8Array, fine: Grid, size: number, p: RetouchParams): Coarse {
  const n = s.count;
  const grid = buildGrid(s.pos, n, size, { include: eligible });
  const K = grid.cells * 3;
  const cnt = new Float32Array(K), mean = new Float32Array(K * 3), std = new Float32Array(K), centroid = new Float32Array(K * 3), clean = new Float32Array(K * 3);
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
  return { grid, cnt, mean, std, centroid, clean };
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
) {
  const g = co.grid;
  const nb = new Int32Array(27);
  const invL = 1 / (2 * (0.6 * g.size) ** 2);
  const invC = 1 / (2 * 0.2 ** 2);
  for (let c = c0; c < c1; c++) {
    const m = neighbourCells(g, c, nb);
    for (let t = g.start[c]; t < g.start[c + 1]; t++) {
      const i = g.order[t];
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

// ── The whole retouch ───────────────────────────────────────────────────────

export type RetouchReport = {
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
  asphaltLuma: number;
  tally: Tally;
  ms: Record<string, number>;
};

export type RetouchHooks = {
  /** Called between blocks of work: give the event loop a turn (a server job) — or nothing (a CLI). */
  pause?: () => Promise<void> | void;
  step?: (what: string) => void;
};

/**
 * Retouch `s` in place: its colours (SH DC) restored, its view-dependent SH
 * scaled by `shKeep`. Returns `keep` (0 for floaters to leave out when
 * writing) and a report. Positions, scales and rotations are never touched.
 */
export async function retouch(s: Splats, params: Partial<RetouchParams> & { preset?: RetouchPreset } = {}, hooks: RetouchHooks = {}) {
  const p: RetouchParams = { ...PRESETS[params.preset ?? "full"], ...stripUndefined(params) };
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

  // Colours.
  step("measuring");
  const rgb = new Float32Array(n * 3);
  for (let k = 0; k < n * 3; k++) rgb[k] = 0.5 + SH_C0 * s.dc[k];
  lap("measure");

  // a. The fine voxel hash (every splat: floaters are found there too).
  step("indexing");
  const fine = fineGrid(s, p.cellTarget, null);
  const scaleCap = Math.log(p.maxScaleCells * fine.size);
  const eligible = new Uint8Array(n);
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
  const fp: FinePass = { fine: new Float32Array(n * 3), normal: new Float32Array(fine.cells * 3), planarity: new Float32Array(fine.cells), floater: new Uint8Array(n) };
  const BLOCK = 2000; // fine cells between pauses (~50 ms at 9M splats)
  for (let c = 0; c < fine.cells; c += BLOCK) {
    finePass(s, rgb, eligible, fine, p, fp, c, Math.min(fine.cells, c + BLOCK));
    await pause();
  }
  const start = fp.fine;
  for (let k = 0; k < n * 3; k++) start[k] = rgb[k] + p.smooth * (start[k] - rgb[k]);
  lap("smooth");

  const up = refineUp(fine, fp.normal, fp.planarity, p.up);
  const cls = cellClasses(fine, fp.normal, fp.planarity, up);
  fp.normal = new Float32Array(0);

  // c. The ground.
  step("finding the ground");
  const coarseSize = p.coarseCell > 0 ? Math.max(p.coarseCell, 2 * fine.size) : fine.size * p.coarseFactor;
  const candidate = new Uint8Array(n);
  for (let i = 0; i < n; i++) candidate[i] = eligible[i] === EVIDENCE && cls[fine.cellOf[i]] === H ? 1 : 0;
  const gr = findGround(s, candidate, up, coarseSize, p.groundTol * fine.size);
  lap("ground");
  await pause();

  // d. Local and clean regional colours.
  step("reading the surfaces");
  const co = coarseStats(s, start, eligible, cls, fine, coarseSize, p);
  const groundShare = new Float32Array(co.cnt.length);
  for (let i = 0; i < n; i++) if (gr.ground[i] && co.grid.cellOf[i] !== NONE) groundShare[co.grid.cellOf[i] * 3 + H]++;
  for (let k = 0; k < groundShare.length; k++) groundShare[k] = co.cnt[k] ? groundShare[k] / co.cnt[k] : 0;
  const asphaltLuma = asphaltReference(co, groundShare, p);
  lap("surfaces");
  await pause();

  step("restoring");
  const tally: Tally = { retouched: 0, ground: 0, asphalt: 0, walls: 0, brick: 0 };
  const out = rgb; // restored in place of the original colours (no longer needed)
  for (let k = 0; k < n * 3; k++) if (eligible[(k / 3) | 0]) out[k] = start[k];
  const CB = 300; // coarse cells between pauses
  for (let c = 0; c < co.grid.cells; c += CB) {
    restorePass(s, start, eligible, cls, fine, gr.ground, co, asphaltLuma, p, out, tally, c, Math.min(co.grid.cells, c + CB));
    await pause();
  }
  lap("restore");

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
  let kept = 0;
  for (let i = 0; i < n; i++) if (!fp.floater[i]) { keep[i] = 1; kept++; }
  lap("finish");

  const report: RetouchReport = {
    splats: n, kept, floaters: n - kept, eligible: nEligible,
    fineCell: fine.size, coarseCell: coarseSize, fineCells: fine.cells, coarseCells: co.grid.cells,
    up, groundColumns: gr.columns, asphaltLuma, tally, ms,
  };
  return { keep, report };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && k !== "preset") (r as Record<string, unknown>)[k] = v;
  return r;
}
