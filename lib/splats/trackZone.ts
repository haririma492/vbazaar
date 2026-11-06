// FOLLOWING THE PHOTOGRAPHER THROUGH A 360° WALK (owner, 2026-11-02: "the lock
// window works but only in the couple of frames following … moving on through
// the path few sec and the lock is not there any more"). The camera is carried,
// so the person carrying it moves round the picture as they walk and turn. From
// each lock the operator sets (a moment, a direction, a width), the zone is
// followed frame by frame by its COLOURS: per column of a low panorama
// (1 px = 1°), a 4×4×4 colour histogram of the band where a person near the
// camera is; the zone is where a window of its width best matches the lock's
// colours and least matches the whole band (the store). Between two locks the
// two follows are blended, the nearer lock weighing more.
//
// Pure (no DOM): `components/virtual-bazaar/walk/followZone.ts` draws the frames.

export const ZONE_W = 360; // columns: one per degree
export const ZONE_H = 180;
/** The band a person beside the camera fills: from 35° above the horizon to 70° below. */
const ROW0 = Math.round(((90 - 35) / 180) * ZONE_H), ROW1 = Math.round(((90 + 70) / 180) * ZONE_H);
const BINS = 64;
/** How far (degrees) the zone may move between two frames. */
const MAX_STEP = 20;

/** Per column, how many band pixels fall in each colour bin: ZONE_W × BINS. */
export function columnHistograms(rgba: ArrayLike<number>, channels = 4): Float32Array {
  const out = new Float32Array(ZONE_W * BINS);
  for (let y = ROW0; y < ROW1; y++) {
    for (let x = 0; x < ZONE_W; x++) {
      const p = (y * ZONE_W + x) * channels;
      const bin = ((rgba[p] >> 6) << 4) | ((rgba[p + 1] >> 6) << 2) | (rgba[p + 2] >> 6);
      out[x * BINS + bin]++;
    }
  }
  return out;
}

const col = (deg: number) => ((Math.round(deg + 180) % ZONE_W) + ZONE_W) % ZONE_W;

/** The normalised colours of a window `width` degrees wide centred on `deg`. */
function windowHist(ch: Float32Array, deg: number, width: number): Float32Array {
  const h = new Float32Array(BINS);
  const half = Math.max(1, Math.round(width / 2));
  const c = col(deg);
  for (let k = -half; k < half; k++) {
    const x = (((c + k) % ZONE_W) + ZONE_W) % ZONE_W;
    for (let b = 0; b < BINS; b++) h[b] += ch[x * BINS + b];
  }
  let sum = 0;
  for (let b = 0; b < BINS; b++) sum += h[b];
  if (sum > 0) for (let b = 0; b < BINS; b++) h[b] /= sum;
  return h;
}

function wholeBand(ch: Float32Array): Float32Array {
  const h = new Float32Array(BINS);
  for (let x = 0; x < ZONE_W; x++) for (let b = 0; b < BINS; b++) h[b] += ch[x * BINS + b];
  let sum = 0;
  for (let b = 0; b < BINS; b++) sum += h[b];
  if (sum > 0) for (let b = 0; b < BINS; b++) h[b] /= sum;
  return h;
}

const likeness = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < BINS; i++) s += Math.sqrt(a[i] * b[i]);
  return s;
};

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * The zone followed from frame `from` (where it is `deg`, `width` wide) frame
 * by frame to frame `to` (either way): the direction at each, in degrees.
 */
export function followZone(frames: Float32Array[], from: number, deg: number, width: number, to: number): Map<number, number> {
  const out = new Map<number, number>([[from, deg]]);
  const q0 = windowHist(frames[from], deg, width);
  let q = q0.slice();
  let cur = deg;
  const dir = to >= from ? 1 : -1;
  for (let i = from + dir; dir > 0 ? i <= to : i >= to; i += dir) {
    const ch = frames[i];
    const bg = wholeBand(ch);
    const model = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) model[b] = 0.5 * q0[b] + 0.5 * q[b];
    let best = -Infinity, bestDeg = cur, bestH: Float32Array | null = null;
    for (let d = -MAX_STEP; d <= MAX_STEP; d++) {
      const c = wrapDeg(cur + d);
      const h = windowHist(ch, c, width);
      const s = likeness(h, model) - 0.6 * likeness(h, bg);
      if (s > best) { best = s; bestDeg = c; bestH = h; }
    }
    cur = bestDeg;
    if (bestH) for (let b = 0; b < BINS; b++) q[b] = 0.85 * q[b] + 0.15 * bestH[b];
    out.set(i, cur);
  }
  return out;
}

export type ZoneLock = { t: number; yaw: number; width: number };

/**
 * WHERE THE WALK IS CUT (2026-11-06, Saraye Bamdad: the operator in view at 1:28–1:33). A walk cut by the Route
 * optimizer jumps from one place to another: the operator jumps round the picture from one frame to the next,
 * and a follow (±20° a frame) carried across the cut, or blended with a follow from the other side of it, puts
 * the lock beside them. A cut is where a frame looks unlike the one before it, however the camera turned: the
 * best match of the two frames' columns over a turn of ±25° below `CUT_LIKE` (measured on Saraye Bamdad: 0.9
 * between ordinary frames, 0.29–0.64 at its cuts and their dips to black). Returns the frames that start a new
 * stretch.
 */
export const CUT_LIKE = 0.7;
export function shotBreaks(frames: Float32Array[]): number[] {
  const norm = frames.map((ch) => {
    const out = new Float32Array(ZONE_W * BINS);
    for (let x = 0; x < ZONE_W; x++) {
      let sum = 0;
      for (let b = 0; b < BINS; b++) sum += ch[x * BINS + b];
      if (sum > 0) for (let b = 0; b < BINS; b++) out[x * BINS + b] = Math.sqrt(ch[x * BINS + b] / sum);
    }
    return out;
  });
  const breaks: number[] = [];
  for (let i = 1; i < norm.length; i++) {
    const a = norm[i - 1], c = norm[i];
    let best = 0;
    for (let sh = -25; sh <= 25; sh++) {
      let s = 0;
      for (let x = 0; x < ZONE_W; x++) {
        const y = (((x + sh) % ZONE_W) + ZONE_W) % ZONE_W;
        for (let b = 0; b < BINS; b++) s += a[x * BINS + b] * c[y * BINS + b]; // square roots taken once, above
      }
      best = Math.max(best, s / ZONE_W);
    }
    if (best < CUT_LIKE) breaks.push(i);
  }
  return breaks;
}

/** The stretches between cuts, as [first, end) frame ranges. */
export function stretchesOf(n: number, breaks: number[]): Array<[number, number]> {
  const edges = [0, ...breaks.filter((b) => b > 0 && b < n), n];
  const out: Array<[number, number]> = [];
  for (let k = 0; k + 1 < edges.length; k++) if (edges[k + 1] > edges[k]) out.push([edges[k], edges[k + 1]]);
  return out;
}

/**
 * The zone at every frame (`dt` seconds apart, frame 0 at 0 s) from the
 * operator's locks (radians): followed from the nearest lock before the first
 * and after the last, blended between two. Width goes straight from one lock's
 * to the next's.
 */
export function zoneThroughWalk(frames: Float32Array[], dt: number, locks: ZoneLock[], breaks: number[] = []): ZoneLock[] {
  const whole = followWalk(frames, dt, locks);
  if (!breaks.length || whole.length !== frames.length) return whole;
  // Each stretch between cuts is followed from its OWN locks only, never across a cut. A stretch with no lock
  // keeps the whole-walk follow (the agent looks just after every cut, so that is rare).
  const out = whole.slice();
  for (const [a, b] of stretchesOf(frames.length, breaks)) {
    const inside = locks.filter((l) => { const i = Math.round(l.t / dt); return i >= a && i < b; })
      .map((l) => ({ ...l, t: l.t - a * dt }));
    if (!inside.length) continue;
    const part = followWalk(frames.slice(a, b), dt, inside);
    for (let i = 0; i < part.length; i++) out[a + i] = { ...part[i], t: Math.round((a + i) * dt * 100) / 100 };
  }
  return out;
}

function followWalk(frames: Float32Array[], dt: number, locks: ZoneLock[]): ZoneLock[] {
  const n = frames.length;
  if (!n || !locks.length) return [];
  const ls = [...locks].sort((a, b) => a.t - b.t).map((l) => ({
    ...l, i: Math.min(n - 1, Math.max(0, Math.round(l.t / dt))), deg: (l.yaw * 180) / Math.PI, wdeg: (l.width * 180) / Math.PI,
  }));
  const out: ZoneLock[] = [];
  const push = (i: number, deg: number, wdeg: number) =>
    out.push({ t: Math.round(i * dt * 100) / 100, yaw: (wrapDeg(deg) * Math.PI) / 180, width: (wdeg * Math.PI) / 180 });
  const first = ls[0], last = ls[ls.length - 1];
  const before = followZone(frames, first.i, first.deg, first.wdeg, 0);
  for (let i = 0; i < first.i; i++) push(i, before.get(i)!, first.wdeg);
  for (let k = 0; k < ls.length - 1; k++) {
    const a = ls[k], b = ls[k + 1];
    if (b.i <= a.i) continue;
    const fa = followZone(frames, a.i, a.deg, a.wdeg, b.i), fb = followZone(frames, b.i, b.deg, b.wdeg, a.i);
    for (let i = a.i; i < b.i; i++) {
      const w = (i - a.i) / (b.i - a.i);
      const x = fa.get(i)!, y = fb.get(i)!;
      push(i, x + wrapDeg(y - x) * w, a.wdeg + (b.wdeg - a.wdeg) * w);
    }
  }
  const after = followZone(frames, last.i, last.deg, last.wdeg, n - 1);
  for (let i = last.i; i < n; i++) push(i, after.get(i)!, last.wdeg);
  return out;
}
