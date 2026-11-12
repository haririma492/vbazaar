// SHELVES THE OPERATOR MARKS ON THE WALK — the rules (owner, 2026-11-12: "I need to be able as operator to draw
// rectangles on the shelf and identify 'Shelves' and assign number or name or both to them … ON shopper's free
// tour, the borders of each shelf and their name will be visible to them so shoppers can decide to approach or
// pass"). A shelf is a `WalkZoom` on the walk (`walks.ts`): its border (`outline`), its number and name, and, once
// its photos are uploaded and stitched, its zoom photo (`manifest`). Pure; tested.
//
// Units are the walk's own: on a 360° walk a point is a direction (yaw, pitch in radians), on a flat one fractions
// of the frame (x right, y down). A border is 8 numbers: top-left, top-right, bottom-right, bottom-left.
import type { WalkLabel } from "./walks";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faNum = (n: number) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** What a shelf is called from its number and its name: both («3 · Spices»), either, or «Shelf» when neither. */
export function shelfLabel(n: number | undefined, name: WalkLabel | undefined): WalkLabel {
  const en = name?.en.trim() ?? "", fa = name?.fa?.trim() ?? "";
  if (n === undefined) return en || fa ? { en: en || fa, ...(fa ? { fa } : {}) } : { en: "Shelf", fa: "قفسه" };
  if (!en && !fa) return { en: `Shelf ${n}`, fa: `قفسه ${faNum(n)}` };
  return { en: `${n} · ${en || fa}`, fa: `${faNum(n)} · ${fa || en}` };
}

/** The first number no shelf has yet (a shelf called «Shelf 4» by the finder counts as 4). */
export function nextShelfNumber(shelves: Array<{ n?: number; label: WalkLabel }>): number {
  const used = new Set(shelves.map((s) => s.n ?? Number(/^Shelf (\d+)$/.exec(s.label.en)?.[1] ?? NaN)).filter(Number.isFinite));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// ── A direction and the flat picture in front of it (gnomonic: straight lines stay straight) ──
type P = [number, number];
const vec = (lon: number, lat: number) => [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
/** The plane touching the sphere at (lon0, lat0): x to the right (east), y up. */
function plane(lon0: number, lat0: number) {
  const f = vec(lon0, lat0);
  const e = [Math.cos(lon0), 0, -Math.sin(lon0)];
  const n = [-Math.sin(lat0) * Math.sin(lon0), Math.cos(lat0), -Math.sin(lat0) * Math.cos(lon0)];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    /** Null for a direction beside or behind the plane. */
    to(p: P): P | null {
      const d = vec(p[0], p[1]), z = dot(d, f);
      return z > 0.05 ? [dot(d, e) / z, dot(d, n) / z] : null;
    },
    from(q: P): P {
      const v = [0, 1, 2].map((i) => f[i] + q[0] * e[i] + q[1] * n[i]);
      return [Math.atan2(v[0], v[2]), Math.asin(v[1] / Math.hypot(v[0], v[1], v[2]))];
    },
  };
}
/** The middle direction of some directions (their mean as vectors). */
function middle(pts: P[]): P {
  const s = [0, 0, 0];
  for (const p of pts) { const v = vec(p[0], p[1]); s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  const len = Math.hypot(s[0], s[1], s[2]) || 1;
  return [Math.atan2(s[0], s[2]), Math.asin(s[1] / len)];
}
const pairs = (c: number[]): P[] => [0, 1, 2, 3].map((k) => [c[k * 2], c[k * 2 + 1]] as P);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * THE RECTANGLE BETWEEN TWO TAPS (two opposite corners, in any order). On a 360° walk it is a rectangle in the
 * picture in front of the shelf (upright, its sides straight in the view), not a box of yaw and pitch, which would
 * bow away from the horizon. Null when the taps are too close to be a shelf, or (360°) too far apart to be one.
 */
export function rectFromTaps(a: { x: number; y: number }, b: { x: number; y: number }, round: boolean): number[] | null {
  if (!round) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x1 - x0 < 0.03 || y1 - y0 < 0.03) return null;
    return [x0, y0, x1, y0, x1, y1, x0, y1].map(r4);
  }
  const m = middle([[a.x, a.y], [b.x, b.y]]);
  // Upright: the plane faces the shelf at the taps' middle yaw, level with their middle pitch.
  const pl = plane(m[0], m[1]);
  const pa = pl.to([a.x, a.y]), pb = pl.to([b.x, b.y]);
  if (!pa || !pb) return null;
  const x0 = Math.min(pa[0], pb[0]), x1 = Math.max(pa[0], pb[0]), y0 = Math.min(pa[1], pb[1]), y1 = Math.max(pa[1], pb[1]);
  if (x1 - x0 < 0.03 || y1 - y0 < 0.03 || x1 - x0 > 4 || y1 - y0 > 4) return null;
  return ([[x0, y1], [x1, y1], [x1, y0], [x0, y0]] as P[]).flatMap((q) => pl.from(q)).map(r4);
}

/** The middle of a border, and `points` inside it to follow: the middle and each corner pulled `pull` of the way in. */
export function followPoints(c: number[], round: boolean, pull = 0.45): P[] {
  const q = pairs(c);
  if (!round) {
    const m: P = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
    return [m, ...q.map((p) => [p[0] + (m[0] - p[0]) * pull, p[1] + (m[1] - p[1]) * pull] as P)];
  }
  const m = middle(q), pl = plane(m[0], m[1]);
  return [m, ...q.map((p) => { const f = pl.to(p) ?? [0, 0]; return pl.from([f[0] * (1 - pull), f[1] * (1 - pull)]); })];
}

/** The best straight-line map (x, y) → (x', y') taking `from` onto `to`: affine with 3 or more points that are not
 *  in a line, a turn-and-scale with 2, a slide with 1. */
function fit(from: P[], to: P[]): ((p: P) => P) | null {
  const n = Math.min(from.length, to.length);
  if (!n) return null;
  const mean = (ps: P[]): P => [ps.reduce((s, p) => s + p[0], 0) / n, ps.reduce((s, p) => s + p[1], 0) / n];
  const mf = mean(from.slice(0, n)), mt = mean(to.slice(0, n));
  let sxx = 0, sxy = 0, syy = 0, txx = 0, txy = 0, tyx = 0, tyy = 0;
  for (let i = 0; i < n; i++) {
    const x = from[i][0] - mf[0], y = from[i][1] - mf[1], u = to[i][0] - mt[0], v = to[i][1] - mt[1];
    sxx += x * x; sxy += x * y; syy += y * y;
    txx += u * x; txy += u * y; tyx += v * x; tyy += v * y;
  }
  const det = sxx * syy - sxy * sxy;
  let a: number, b: number, c: number, d: number;
  if (n >= 3 && det > 1e-9 * (sxx + syy) ** 2) {
    // [a b; c d] = T · S⁻¹
    a = (txx * syy - txy * sxy) / det; b = (txy * sxx - txx * sxy) / det;
    c = (tyx * syy - tyy * sxy) / det; d = (tyy * sxx - tyx * sxy) / det;
  } else if (n >= 2 && sxx + syy > 1e-12) {
    a = (txx + tyy) / (sxx + syy); c = (tyx - txy) / (sxx + syy); b = -c; d = a;
  } else { a = 1; b = 0; c = 0; d = 1; }
  return (p) => [mt[0] + a * (p[0] - mf[0]) + b * (p[1] - mf[1]), mt[1] + c * (p[0] - mf[0]) + d * (p[1] - mf[1])];
}

const area = (q: P[]) => Math.abs(q.reduce((s, p, i) => { const o = q[(i + 1) % q.length]; return s + p[0] * o[1] - o[0] * p[1]; }, 0)) / 2;
const convex = (q: P[]) => {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], c = q[(i + 2) % q.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
};

/**
 * WHERE THE BORDER IS NOW, from points inside it that were followed: `seeds` are the points at the moment the border
 * was drawn, `nows` the same points now (null for one that was lost). The border moves, turns, grows and leans with
 * them. Null when fewer than 3 points are left, or when what comes out is not a believable shelf (turned inside
 * out, or more than 3× bigger or smaller than it was drawn: a point slid onto something else).
 */
export function moveQuad(quad: number[], seeds: P[], nows: Array<P | null>, round: boolean): number[] | null {
  const from: P[] = [], to: P[] = [];
  nows.forEach((p, i) => { if (p && seeds[i]) { from.push(seeds[i]); to.push(p); } });
  if (from.length < 3) return null;
  const q0 = pairs(quad);
  let a0: P[], a1: P[], c0: P[], back: (p: P) => P;
  if (round) {
    const m0 = middle(q0), m1 = middle(to), p0 = plane(m0[0], m0[1]), p1 = plane(m1[0], m1[1]);
    const f0 = from.map((p) => p0.to(p)), t1 = to.map((p) => p1.to(p)), cc = q0.map((p) => p0.to(p));
    if (f0.some((p) => !p) || t1.some((p) => !p) || cc.some((p) => !p)) return null;
    a0 = f0 as P[]; a1 = t1 as P[]; c0 = cc as P[]; back = (p) => p1.from(p);
  } else { a0 = from; a1 = to; c0 = q0; back = (p) => p; }
  const f = fit(a0, a1);
  if (!f) return null;
  const c1 = c0.map(f);
  const grew = area(c1) / (area(c0) || 1);
  if (!convex(c1) || !(grew > 1 / 3 && grew < 3)) return null;
  return c1.flatMap(back).map(r4);
}

/** A border's steps evened out over time (each number averaged with its neighbours; a 360° yaw the short way round). */
export function smoothOutline(frames: Array<{ t: number; c: number[] }>, round: boolean): Array<{ t: number; c: number[] }> {
  if (frames.length < 3) return frames;
  const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
  return frames.map((f, i) => {
    const a = frames[Math.max(0, i - 1)], b = frames[Math.min(frames.length - 1, i + 1)];
    return {
      t: f.t,
      c: f.c.map((v, j) => {
        if (round && j % 2 === 0) return r4(wrap(v + (wrap(a.c[j] - v) + wrap(b.c[j] - v)) / 3));
        return r4((a.c[j] + v + b.c[j]) / 3);
      }),
    };
  });
}
