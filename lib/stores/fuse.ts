// ONE PHOTO FROM SEVERAL FRAMES (owner, 2026-11-04: "lets do what ever we can to
// improve the quality of these photos, go ahead with building frame combination").
//
// A product is in many frames of the walk as the camera passes it. Each frame
// has its own noise and compression blocks; the product itself is the same. So
// a few frames from around the sharpest moment, cut as close-ups aimed at the
// product, are lined up on the sharpest (`alignTo`: a shift found coarse then
// fine, to a fraction of a pixel) and averaged (`fuse`), the sharper weighing
// more. The noise and the blocks average away; the letters do not. Nothing is
// invented: every pixel is the recording's own.
//
// Pure: works on RGB arrays (n × n × 3); `node --test` runs it.

export type Rgb = { n: number; px: Float32Array };

/** Grey of an RGB picture. */
export function grey(img: Rgb): Float32Array {
  const g = new Float32Array(img.n * img.n);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * img.px[i * 3] + 0.587 * img.px[i * 3 + 1] + 0.114 * img.px[i * 3 + 2];
  return g;
}

/** How sharp a grey picture is: the mean squared change from each pixel to the next. */
export function sharpness(g: Float32Array, n: number): number {
  let s = 0;
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const v = g[y * n + x], dx = g[y * n + x + 1] - v, dy = g[(y + 1) * n + x] - v;
    s += dx * dx + dy * dy;
  }
  return s / ((n - 1) * (n - 1));
}

/** Half the size (2 × 2 means). */
function half(g: Float32Array, n: number): Float32Array {
  const m = n >> 1, out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const i = 2 * y * n + 2 * x;
    out[y * m + x] = (g[i] + g[i + 1] + g[i + n] + g[i + n + 1]) / 4;
  }
  return out;
}

/** Correlation of `b` shifted by (dx, dy) against `a`, over the middle of the picture (`margin` left out each side). */
function ncc(a: Float32Array, b: Float32Array, n: number, dx: number, dy: number, margin: number): number {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, k = 0;
  for (let y = margin; y < n - margin; y++) {
    const yb = y + dy;
    if (yb < 0 || yb >= n) continue;
    for (let x = margin; x < n - margin; x++) {
      const xb = x + dx;
      if (xb < 0 || xb >= n) continue;
      const va = a[y * n + x], vb = b[yb * n + xb];
      sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; k++;
    }
  }
  if (!k) return -1;
  const cov = sab - (sa * sb) / k, va = saa - (sa * sa) / k, vb = sbb - (sb * sb) / k;
  return va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : -1;
}

/**
 * The shift (px, to a fraction) that lines `b` up with `a` — `b(x + dx, y + dy)
 * ≈ a(x, y)` — searched to ±`range` px: first on quarter-size pictures, then
 * at full size round that, then a parabola through the best and its
 * neighbours. `score` is how well they match (1 = the same).
 */
export function alignTo(a: Float32Array, b: Float32Array, n: number, range = 24): { dx: number; dy: number; score: number } {
  // Coarse at half size (a quarter blurred repeated spines into one, and locked onto the wrong one), then full size.
  const a2 = half(a, n), b2 = half(b, n), n2 = n >> 1;
  const r2 = Math.ceil(range / 2), m2 = Math.max(2, Math.floor(n2 / 6));
  let bx = 0, by = 0, bs = -2;
  for (let dy = -r2; dy <= r2; dy++) for (let dx = -r2; dx <= r2; dx++) {
    const s = ncc(a2, b2, n2, dx, dy, m2);
    if (s > bs) { bs = s; bx = dx; by = dy; }
  }
  const m = Math.max(4, Math.floor(n / 6));
  let fx = bx * 2, fy = by * 2, fs = -2;
  const cx = fx, cy = fy;
  for (let dy = cy - 2; dy <= cy + 2; dy++) for (let dx = cx - 2; dx <= cx + 2; dx++) {
    const s = ncc(a, b, n, dx, dy, m);
    if (s > fs) { fs = s; fx = dx; fy = dy; }
  }
  const peak = (l: number, c: number, r: number) => { const d = l - 2 * c + r; return d < -1e-9 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d))) : 0; };
  const sx = peak(ncc(a, b, n, fx - 1, fy, m), fs, ncc(a, b, n, fx + 1, fy, m));
  const sy = peak(ncc(a, b, n, fx, fy - 1, m), fs, ncc(a, b, n, fx, fy + 1, m));
  return { dx: fx + sx, dy: fy + sy, score: fs };
}

/** `img` moved so that what was at (x + dx, y + dy) is at (x, y) (bilinear; outside the picture: the edge). */
export function shifted(img: Rgb, dx: number, dy: number): Rgb {
  const n = img.n, out = new Float32Array(img.px.length);
  for (let y = 0; y < n; y++) {
    const sy = Math.min(n - 1.001, Math.max(0, y + dy)), y0 = Math.floor(sy), ty = sy - y0;
    for (let x = 0; x < n; x++) {
      const sx = Math.min(n - 1.001, Math.max(0, x + dx)), x0 = Math.floor(sx), tx = sx - x0;
      const i00 = (y0 * n + x0) * 3, i01 = i00 + 3, i10 = i00 + n * 3, i11 = i10 + 3;
      for (let c = 0; c < 3; c++) {
        out[(y * n + x) * 3 + c] = (img.px[i00 + c] * (1 - tx) + img.px[i01 + c] * tx) * (1 - ty) + (img.px[i10 + c] * (1 - tx) + img.px[i11 + c] * tx) * ty;
      }
    }
  }
  return { n, px: out };
}

/** Frames lined up on the sharpest only when they match it this well; the rest are left out. */
export const FUSE_MIN_MATCH = 0.6;

/**
 * Several close-ups of one product → one: each lined up on the sharpest
 * (`alignTo`), those that match it well enough averaged, weighted by how sharp
 * each is. Returns the picture and how many frames went into it.
 */
export function fuse(frames: Rgb[], box?: { x: number; y: number; w: number; h: number }): { img: Rgb; used: number } {
  if (!frames.length) throw new Error("No frames to combine.");
  const n = frames[0].n;
  const greys = frames.map(grey);
  const sharp = greys.map((g) => sharpness(g, n));
  const ref = sharp.indexOf(Math.max(...sharp));
  const sum = new Float32Array(frames[ref].px.length);
  let weight = 0, used = 0;
  frames.forEach((f, i) => {
    let img = f;
    if (i !== ref) {
      const s = alignTo(greys[ref], greys[i], n);
      if (s.score < FUSE_MIN_MATCH) return;
      img = shifted(f, s.dx, s.dy);
    }
    const w = sharp[i] / sharp[ref];
    for (let k = 0; k < sum.length; k++) sum[k] += img.px[k] * w;
    weight += w;
    used++;
  });
  for (let k = 0; k < sum.length; k++) sum[k] /= weight;
  // ⚠️ ONLY THE PRODUCT IS COMBINED (2026-11-04). What is behind and beside it is at another distance
  // and moves differently from frame to frame: averaged, the shelves behind came out doubled. Outside
  // the product's box (a soft edge `FEATHER` px wide) the sharpest frame is kept as it is.
  if (box) {
    const ref0 = frames[ref].px;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const out = Math.max(box.x - x, x - (box.x + box.w), box.y - y, y - (box.y + box.h), 0);
      const k = Math.max(0, Math.min(1, 1 - out / FEATHER));
      if (k >= 1) continue;
      for (let c = 0; c < 3; c++) { const i = (y * n + x) * 3 + c; sum[i] = sum[i] * k + ref0[i] * (1 - k); }
    }
  }
  return { img: { n, px: sum }, used };
}
/** The soft edge round the product's box where the combined picture fades into the sharpest frame (px). */
export const FEATHER = 12;
