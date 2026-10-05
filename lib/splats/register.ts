/**
 * JOINING BY THE PICTURES (operator, 2026-10-05: "I recorded a 360 video from
 * the middle of the common area then I went to the alley — this is not an
 * integration, it is a jump").
 *
 * Two films that both saw the common area give two reconstructions of it.
 * Placing the second from the paths alone (`joinAtEnd`) guesses its turn
 * from the cameraman's first steps — and a cameraman turning round in the
 * middle of a hall makes that guess poor: the view jumps where they meet.
 *
 * Here the guess is corrected the way photos are stitched: the points both
 * scenes have of the common area are fitted onto each other (ICP — closest
 * points, best turn/move/size, repeat). Turning only about the vertical and
 * one size, as `Place` allows. Several starting turns are tried, so a bad
 * first guess cannot trap it.
 *
 * Pure. Points are flat xyz triples: `a` in the world, `b` in the second
 * scene's own coordinates (what `Place` maps from).
 */

export type Vec3 = [number, number, number];
export type Place = { offset: Vec3; yaw: number; scale: number };

/** At most this many points of each scene are fitted (evenly thinned). */
export const MAX_POINTS = 12_000;

/** Keep about `max` points, one per small cube of space, so dense spots do not dominate. */
export function thin(points: Float32Array, max = MAX_POINTS): Float32Array {
  const n = points.length / 3;
  if (n <= max) return points;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = points[i * 3 + k];
    if (v < lo[k]) lo[k] = v;
    if (v > hi[k]) hi[k] = v;
  }
  const vol = Math.max(1e-9, (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]));
  // From fine to coarser until few enough: points lie on surfaces, not filling space.
  let cell = Math.cbrt(vol / max) / 4;
  for (let round = 0; round < 14; round++) {
    const seen = new Set<string>();
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x, y, z);
    }
    if (out.length / 3 <= max * 1.2) return Float32Array.from(out.slice(0, max * 3));
    cell *= 1.25;
  }
  // Still too many: every k-th.
  const step = Math.ceil(n / max);
  const out = new Float32Array(Math.ceil(n / step) * 3);
  for (let i = 0, j = 0; i < n; i += step, j++) out.set(points.subarray(i * 3, i * 3 + 3), j * 3);
  return out;
}

/** A grid for finding the nearest point of `a` quickly. */
function grid(a: Float32Array, cell: number) {
  const map = new Map<string, number[]>();
  for (let i = 0; i < a.length / 3; i++) {
    const key = `${Math.floor(a[i * 3] / cell)},${Math.floor(a[i * 3 + 1] / cell)},${Math.floor(a[i * 3 + 2] / cell)}`;
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  }
  return (x: number, y: number, z: number): { i: number; d: number } | null => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = map.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const i of list) {
        const ex = a[i * 3] - x, ey = a[i * 3 + 1] - y, ez = a[i * 3 + 2] - z;
        const d = ex * ex + ey * ey + ez * ez;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  };
}

const apply = (p: Place, x: number, y: number, z: number): Vec3 => {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [p.offset[0] + p.scale * (x * c + z * s), p.offset[1] + p.scale * y, p.offset[2] + p.scale * (-x * s + z * c)];
};

/** One fit: closest points within `reach`, the best 70% kept, the best turn / size / move for them. */
function step(a: Float32Array, near: ReturnType<typeof grid>, b: Float32Array, p: Place, reach: number, scaleFree: boolean, sizes: [number, number] = [p.scale, p.scale]) {
  const pairs: Array<[number, number, number]> = []; // b index, a index, distance
  for (let j = 0; j < b.length / 3; j++) {
    const [x, y, z] = apply(p, b[j * 3], b[j * 3 + 1], b[j * 3 + 2]);
    const n = near(x, y, z);
    if (n && n.d <= reach) pairs.push([j, n.i, n.d]);
  }
  if (pairs.length < 12) return { place: p, mean: Infinity, matched: pairs.length };
  pairs.sort((u, v) => u[2] - v[2]);
  const keep = pairs.slice(0, Math.max(12, Math.floor(pairs.length * 0.7)));
  let mbx = 0, mby = 0, mbz = 0, max = 0, may = 0, maz = 0;
  for (const [j, i] of keep) {
    mbx += b[j * 3]; mby += b[j * 3 + 1]; mbz += b[j * 3 + 2];
    max += a[i * 3]; may += a[i * 3 + 1]; maz += a[i * 3 + 2];
  }
  const k = keep.length;
  mbx /= k; mby /= k; mbz /= k; max /= k; may /= k; maz /= k;
  // Turn about up: ax ≈ c·bx + s·bz, az ≈ −s·bx + c·bz (as `Place` turns).
  let dot = 0, cross = 0, bb = 0;
  for (const [j, i] of keep) {
    const bx = b[j * 3] - mbx, by = b[j * 3 + 1] - mby, bz = b[j * 3 + 2] - mbz;
    const ax = a[i * 3] - max, az = a[i * 3 + 2] - maz;
    dot += ax * bx + az * bz; // y does not turn
    cross += ax * bz - az * bx;
    bb += bx * bx + by * by + bz * bz;
  }
  const yaw = Math.atan2(cross, dot);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let scale = p.scale;
  if (scaleFree && bb > 0) {
    let num = 0;
    for (const [j, i] of keep) {
      const bx = b[j * 3] - mbx, by = b[j * 3 + 1] - mby, bz = b[j * 3 + 2] - mbz;
      const ax = a[i * 3] - max, ay = a[i * 3 + 1] - may, az = a[i * 3 + 2] - maz;
      num += ax * (c * bx + s * bz) + ay * by + az * (-s * bx + c * bz);
    }
    // Within a third of the guess either way: a fit that shrinks one scene to a speck «matches» anything.
    scale = Math.min(sizes[1], Math.max(sizes[0], num / bb));
  }
  const offset: Vec3 = [max - scale * (c * mbx + s * mbz), may - scale * mby, maz - scale * (-s * mbx + c * mbz)];
  const mean = keep.reduce((t, q) => t + q[2], 0) / k;
  return { place: { offset, yaw, scale }, mean, matched: pairs.length };
}

export type Fit = { place: Place; mean: number; share: number };

/**
 * The place of the second scene that lays its points `b` onto `a`, starting
 * from `guess`. `reach`: how far apart matching points may start (scene
 * units; about the guess's likely error). `share`: how much of `b` found a
 * partner at the end — low means the two did not see the same place.
 */
function fitPoints(a: Float32Array, b: Float32Array, guess: Place, reach: number, scaleFree: boolean, starts = 12): Fit | null {
  if (a.length < 36 || b.length < 36) return null;
  const A = thin(a), B = thin(b);
  const small = thin(B, 1500);
  const nearFar = grid(A, reach);
  const sizes: [number, number] = [guess.scale / 1.3, guess.scale * 1.3];
  // Several starting turns: the guess, and every 30° round it.
  let best: Fit | null = null;
  for (let t = 0; t < starts; t++) {
    let p: Place = { ...guess, yaw: guess.yaw + (t * Math.PI) / 6 };
    // Turned, the guessed point of contact must stay put: re-centre on it.
    const pivot = apply(guess, small[0], small[1], small[2]);
    const moved = apply(p, small[0], small[1], small[2]);
    p = { ...p, offset: [p.offset[0] + pivot[0] - moved[0], p.offset[1], p.offset[2] + pivot[2] - moved[2]] };
    let r = { place: p, mean: Infinity, matched: 0 };
    for (let it = 0; it < 18; it++) {
      const next = step(A, nearFar, small, r.place, reach, scaleFree && it > 6, sizes);
      if (!Number.isFinite(next.mean)) break;
      r = next;
    }
    const share = r.matched / (small.length / 3);
    const fit: Fit = { place: r.place, mean: r.mean, share };
    // Better: more of it matched, then closer.
    if (Number.isFinite(fit.mean) && (!best || fit.share - fit.mean / reach > best.share - best.mean / reach)) best = fit;
  }
  if (!best) return null;
  // Refine on all the points, the reach shrinking.
  let p = best.place;
  let last = { place: p, mean: best.mean, matched: 0 };
  for (const r of [reach, reach / 2, reach / 4, reach / 8]) {
    const near = grid(A, r);
    for (let it = 0; it < 10; it++) {
      const next = step(A, near, B, last.place, r, scaleFree, sizes);
      if (!Number.isFinite(next.mean)) break;
      last = next;
    }
  }
  p = last.place;
  return { place: p, mean: last.mean, share: last.matched / (B.length / 3) };
}

/**
 * The floor's height, and the upright structure above it. A hall is mostly
 * floor, and floor matches floor at any turn — it says nothing about how the
 * scenes are turned. Walls, pillars and shop fronts do. So: the floor is the
 * densest height in the lower half, the ceiling (if any) in the upper half,
 * and the fit is made on what stands between them, seen from above.
 */
export function standing(points: Float32Array): { floor: number; upright: Float32Array } {
  const n = points.length / 3;
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) ys[i] = points[i * 3 + 1];
  const sorted = Float32Array.from(ys).sort();
  const lo = sorted[Math.floor(n * 0.02)], hi = sorted[Math.floor(n * 0.98)];
  const span = Math.max(1e-6, hi - lo);
  const BINS = 60;
  const hist = new Array(BINS).fill(0);
  for (const y of ys) {
    const k = Math.floor(((y - lo) / span) * BINS);
    if (k >= 0 && k < BINS) hist[k]++;
  }
  const peak = (from: number, to: number) => {
    let best = from;
    for (let k = from; k < to; k++) if (hist[k] > hist[best]) best = k;
    return best;
  };
  const f = peak(0, BINS / 2), c = peak(BINS / 2, BINS);
  const floor = lo + ((f + 0.5) / BINS) * span;
  // A real ceiling stands out; otherwise the top of what was seen.
  const ceiling = hist[c] > 2 * (n / BINS) ? lo + ((c + 0.5) / BINS) * span : hi;
  const gap = ceiling - floor;
  const from = floor + gap * 0.12, to = ceiling - gap * 0.12;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (y > from && y < to) out.push(points[i * 3], 0, points[i * 3 + 2]);
  }
  return { floor, upright: Float32Array.from(out) };
}

/**
 * The place of the second scene that lays its points `b` onto `a`, starting
 * from `guess`. `reach`: how far apart matching points may start (scene
 * units; about the guess's likely error). `share`: how much of `b` found a
 * partner at the end — low means the two did not see the same place.
 * Fitted from above on the upright structure; the height from the floors.
 */
export function register(a: Float32Array, b: Float32Array, guess: Place, reach = 2, scaleFree = true): Fit | null {
  if (a.length < 36 || b.length < 36) return null;
  const A = standing(thin(a, MAX_POINTS * 3)), B = standing(thin(b, MAX_POINTS * 3));
  // A global search first (every turn, the best shift for each), then a
  // closest-point polish from the winner: no first guess can trap it.
  const coarse = searchPlan(A.upright, B.upright, guess.scale, guess.yaw);
  const start: Place = coarse ?? { ...guess, offset: [guess.offset[0], 0, guess.offset[2]] };
  const fit = fitPoints(A.upright, B.upright, start, coarse ? coarse.cell * 3 : reach, scaleFree, coarse ? 1 : 12);
  if (!fit) return null;
  const y = A.floor - fit.place.scale * B.floor;
  return { ...fit, place: { ...fit.place, offset: [fit.place.offset[0], y, fit.place.offset[2]] } };
}

// ── The global search: top-down plans correlated at every turn ─────────────

/** In-place radix-2 FFT (inverse: `inv`), length a power of two. */
function fft(re: Float64Array, im: Float64Array, inv: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function fft2(re: Float64Array, im: Float64Array, N: number, inv: boolean) {
  const r = new Float64Array(N), i2 = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    r.set(re.subarray(y * N, y * N + N)); i2.set(im.subarray(y * N, y * N + N));
    fft(r, i2, inv);
    re.set(r, y * N); im.set(i2, y * N);
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) { r[y] = re[y * N + x]; i2[y] = im[y * N + x]; }
    fft(r, i2, inv);
    for (let y = 0; y < N; y++) { re[y * N + x] = r[y]; im[y * N + x] = i2[y]; }
  }
}

/** Points (x, z) drawn into an N×N plan around `centre`, a cell `cell` wide; a little blurred so near counts. */
function plan(points: Float32Array, centre: [number, number], cell: number, N: number, turn = 0, size = 1): Float64Array {
  const img = new Float64Array(N * N);
  const c = Math.cos(turn), s = Math.sin(turn);
  for (let i = 0; i < points.length / 3; i++) {
    const x0 = points[i * 3] * size, z0 = points[i * 3 + 2] * size;
    const x = x0 * c + z0 * s - centre[0], z = -x0 * s + z0 * c - centre[1];
    const gx = Math.floor(x / cell) + N / 2, gz = Math.floor(z / cell) + N / 2;
    if (gx < 1 || gz < 1 || gx >= N - 1 || gz >= N - 1) continue;
    img[gz * N + gx] = 1;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) img[(gz + dz) * N + gx + dx] = Math.max(img[(gz + dz) * N + gx + dx], 0.5);
  }
  return img;
}

const centroid = (p: Float32Array, turn = 0, size = 1): [number, number] => {
  const c = Math.cos(turn), s = Math.sin(turn);
  let x = 0, z = 0;
  const n = p.length / 3;
  for (let i = 0; i < n; i++) {
    const x0 = p[i * 3] * size, z0 = p[i * 3 + 2] * size;
    x += x0 * c + z0 * s;
    z += -x0 * s + z0 * c;
  }
  return [x / n, z / n];
};

/**
 * Every turn (2° apart), the shift that lays the second plan best on the
 * first (cross-correlation by FFT); the best turn wins. Null with too little
 * to compare. `cell`: the plan's resolution, for the polish that follows.
 */
export function searchPlan(a: Float32Array, b: Float32Array, size = 1, prior: number | null = null): (Place & { cell: number; score: number }) | null {
  // Every turn at the guessed size; then, at the best turn, sizes a third either way.
  const turns: Array<[number, number]> = [];
  for (let deg = 0; deg < 360; deg += 2) turns.push([(deg * Math.PI) / 180, size]);
  const first = correlate(a, b, turns, prior);
  if (!first) return null;
  const sizes: Array<[number, number]> = [];
  for (let k = 0.77; k <= 1.3; k += 0.02) for (const d of [-1, 0, 1]) sizes.push([first.yaw + (d * Math.PI) / 180, size * k]);
  return correlate(a, b, sizes) ?? first;
}

/** `prior`: the guessed turn — of two near-equal fits (a symmetric hall) the one nearer it wins. */
function correlate(a: Float32Array, b: Float32Array, tries: Array<[number, number]>, prior: number | null = null): (Place & { cell: number; score: number }) | null {
  if (a.length < 60 || b.length < 60) return null;
  const N = 128;
  const ca = centroid(a);
  let span = 0;
  for (let i = 0; i < a.length / 3; i++) span = Math.max(span, Math.abs(a[i * 3] - ca[0]), Math.abs(a[i * 3 + 2] - ca[1]));
  const cell = Math.max(1e-6, (2 * span) / (N / 2)); // the first plan fills the middle half: no wrapping
  const A = plan(a, ca, cell, N);
  const Are = A, Aim = new Float64Array(N * N);
  fft2(Are, Aim, N, false);
  const sumA = plan(a, ca, cell, N).reduce((t, v) => t + v, 0);
  let best: (Place & { cell: number; score: number }) | null = null;
  for (const [turn, size] of tries) {
    const cb = centroid(b, turn, size);
    const Bre = plan(b, cb, cell, N, turn, size), Bim = new Float64Array(N * N);
    const sumB = Bre.reduce((t, v) => t + v, 0);
    if (!sumB) continue;
    fft2(Bre, Bim, N, false);
    // A · conj(B): its inverse peaks at the shift d with A(x) ≈ B(x − d).
    for (let i = 0; i < N * N; i++) {
      const r = Are[i] * Bre[i] + Aim[i] * Bim[i];
      const m = Aim[i] * Bre[i] - Are[i] * Bim[i];
      Bre[i] = r; Bim[i] = m;
    }
    fft2(Bre, Bim, N, true);
    let peak = 0, at = 0;
    for (let i = 0; i < N * N; i++) if (Bre[i] > peak) { peak = Bre[i]; at = i; }
    const off = prior == null ? 0 : Math.abs(Math.atan2(Math.sin(turn - prior), Math.cos(turn - prior)));
    const score = (peak / Math.sqrt(sumA * sumB)) * (1 - 0.08 * (off / Math.PI));
    if (best && score <= best.score) continue;
    let dx = at % N, dz = Math.floor(at / N);
    if (dx >= N / 2) dx -= N;
    if (dz >= N / 2) dz -= N;
    best = {
      offset: [ca[0] - cb[0] + dx * cell, 0, ca[1] - cb[1] + dz * cell],
      yaw: turn, scale: size, cell, score,
    };
  }
  return best;
}
