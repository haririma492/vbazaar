// THE SHELF TOUR AS A CHOREOGRAPHED CAMERA (owner, 2026-11-05: the stills "are
// just photos they are useful let's keep them but not a substitute for a shelf
// tour"; before: "we need decouple the existing route and create a new route that
// is focused on each shelf and each level of each shelf").
//
// Pure (tested in choreo.test.ts). For one shelf, a still of the whole shelf cut
// at its sharpest, closest moment (`levelsJob.ts` finds the shelf and its levels)
// is filmed by a virtual camera that MOVES OVER THE STILL, not along the walk:
//   whole shelf (hold) → into level 1 at its left end → pan to its right end →
//   down to level 2 at its right end → pan to its left end → … (serpentine, like
//   reading the shelf row by row) → back out to the whole shelf (hold).
// Every move is eased (smoothstep); pans run at `PAN_SPEED` of the view's width a
// second, so a long level takes longer. The camera is a 16:9 window on the
// still (pixels), one per output frame.

export type Box = { x: number; y: number; w: number; h: number }; // pixels on the still
export type Win = { cx: number; cy: number; w: number };            // a 16:9 window; h = w · 9/16
export type Key = { t: number; win: Win };

export const ASPECT = 16 / 9;
/** Seconds: the whole shelf at the start and at the end; a move between places; the shortest look at a level. */
export const HOLD_START = 2, HOLD_END = 1.5, MOVE = 1.4, LOOK_MIN = 2.5;
/** A pan moves this share of the window's width a second. */
export const PAN_SPEED = 0.18;
/** Room round a level in the window (its height · this). */
export const LEVEL_ROOM = 1.35;

const ease = (u: number) => u * u * (3 - 2 * u);

/** The window that holds a box whole (16:9, centred on it), within the still. */
export function fit(b: Box, W: number, H: number, room = 1.08): Win {
  let w = Math.max(b.w * room, b.h * room * ASPECT);
  w = Math.min(w, W, H * ASPECT);
  return clamp({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, w }, W, H);
}
/** A window kept inside the still. */
export function clamp(v: Win, W: number, H: number): Win {
  const w = Math.min(v.w, W, H * ASPECT), h = w / ASPECT;
  return { cx: Math.min(W - w / 2, Math.max(w / 2, v.cx)), cy: Math.min(H - h / 2, Math.max(h / 2, v.cy)), w };
}

/** The keyframes of one shelf's film: the whole still, then each level (serpentine), then the whole still. */
export function choreograph(W: number, H: number, levels: Box[]): Key[] {
  const whole = fit({ x: 0, y: 0, w: W, h: H }, W, H, 1);
  const keys: Key[] = [{ t: 0, win: whole }, { t: HOLD_START, win: whole }];
  let t = HOLD_START;
  for (const [i, lv] of levels.entries()) {
    // The window's height holds the level with room; its width is then 16:9 of that.
    const w = Math.min(W, H * ASPECT, Math.max(lv.h * LEVEL_ROOM * ASPECT, W * 0.12));
    const half = w / 2, cy = lv.y + lv.h / 2;
    const lToR = i % 2 === 0;
    const a = lToR ? lv.x + half : lv.x + lv.w - half, b = lToR ? lv.x + lv.w - half : lv.x + half;
    const from = clamp({ cx: lv.w <= w ? lv.x + lv.w / 2 : a, cy, w }, W, H);
    const to = clamp({ cx: lv.w <= w ? lv.x + lv.w / 2 : b, cy, w }, W, H);
    t += MOVE;
    keys.push({ t, win: from });
    const pan = Math.abs(to.cx - from.cx) / (w * PAN_SPEED);
    t += Math.max(LOOK_MIN, pan);
    keys.push({ t, win: to });
  }
  t += MOVE;
  keys.push({ t, win: whole });
  t += HOLD_END;
  keys.push({ t, win: whole });
  return keys;
}

/** The window at time `t` (between keyframes, eased). */
export function windowAt(keys: Key[], t: number): Win {
  if (t <= keys[0].t) return keys[0].win;
  for (let i = 1; i < keys.length; i++) {
    const k0 = keys[i - 1], k1 = keys[i];
    if (t <= k1.t) {
      const u = k1.t > k0.t ? ease((t - k0.t) / (k1.t - k0.t)) : 1;
      const lerp = (p: number, q: number) => p + (q - p) * u;
      return { cx: lerp(k0.win.cx, k1.win.cx), cy: lerp(k0.win.cy, k1.win.cy), w: lerp(k0.win.w, k1.win.w) };
    }
  }
  return keys[keys.length - 1].win;
}

/** A film's length (s). */
export const lengthOf = (keys: Key[]) => keys[keys.length - 1].t;

/** ffmpeg's crop commands for every output frame (absolute values; crop's commands replace, never add up). */
export function cropCommands(keys: Key[], fps: number): string {
  const lines: string[] = [];
  const n = Math.ceil(lengthOf(keys) * fps);
  for (let f = 0; f <= n; f++) {
    const t = f / fps, v = windowAt(keys, t), w = Math.round(v.w / 2) * 2, h = Math.round(w / ASPECT / 2) * 2;
    const x = Math.round(v.cx - w / 2), y = Math.round(v.cy - h / 2);
    lines.push(`${t.toFixed(3)} crop w ${w}, crop h ${h}, crop x ${x}, crop y ${y};`);
  }
  return lines.join("\n") + "\n";
}

/**
 * One output frame (`ow`×`oh`, RGB) of the window `v` on the still (`W`×`H`, RGB): every output pixel the
 * average of 2×2 samples, each bilinear at its exact (sub-pixel) place, so a slow pan glides without
 * stepping and a wide view does not shimmer. Our own code, not ffmpeg's crop: crop cannot change its
 * size from frame to frame (it stalled).
 */
export function frameOf(still: Uint8Array, W: number, H: number, v: Win, ow: number, oh: number, out: Uint8Array): void {
  const w = v.w, h = w / ASPECT, x0 = v.cx - w / 2, y0 = v.cy - h / 2, sx = w / ow, sy = h / oh;
  const at = (x: number, y: number, c: number) => {
    const xf = Math.min(W - 1.001, Math.max(0, x)), yf = Math.min(H - 1.001, Math.max(0, y));
    const xi = xf | 0, yi = yf | 0, fx = xf - xi, fy = yf - yi, i = (yi * W + xi) * 3 + c, j = i + W * 3;
    return (still[i] * (1 - fx) + still[i + 3] * fx) * (1 - fy) + (still[j] * (1 - fx) + still[j + 3] * fx) * fy;
  };
  for (let oy = 0; oy < oh; oy++) {
    const ya = y0 + (oy + 0.25) * sy, yb = y0 + (oy + 0.75) * sy;
    for (let ox = 0; ox < ow; ox++) {
      const xa = x0 + (ox + 0.25) * sx, xb = x0 + (ox + 0.75) * sx, o = (oy * ow + ox) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = (at(xa, ya, c) + at(xb, ya, c) + at(xa, yb, c) + at(xb, yb, c)) / 4;
    }
  }
}
