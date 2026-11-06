// THE STORE'S INSTAGRAM REEL, PLANNED (owner, 2026-11-06: Instagram pathway, "lets do that for saraye-bamdad").
// A vertical 9:16 clip cut from the store's 360° walk, from INSIDE the store (the walk's door turn, `entryOf`), looking
// at the shelf side with the most products on it, never toward the camera operator (the Lock agent's zone). Pure;
// imports nothing, so `node --test` loads it. `reel.ts` renders the plan with ffmpeg.

export type Zone = { yaw: number; width: number };
export type ReelPlan = { start: number; seconds: number; yaw: number; hfov: number; vfov: number; products: number };

export const REEL_SECONDS = 30;
/** Shorter than this is not worth posting. */
export const MIN_REEL_SECONDS = 10;
const DEG = Math.PI / 180;
/** Widest first: a whole shelf; narrower only if the wide one would catch the camera operator. */
const FOVS = [62 * DEG, 52 * DEG, 44 * DEG];
/** Kept between the frame's edge and the camera operator's zone. */
const MARGIN = 10 * DEG;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** The 9:16 frame's height angle for a width angle. */
export const vfovOf = (hfov: number) => 2 * Math.atan(Math.tan(hfov / 2) * (16 / 9));

/**
 * The plan, or null when no direction inside the store stays clear of the camera operator for long enough.
 * `pins` are the products' lights on a 360° walk: x the yaw (the video's own frame), t the second.
 */
export function planReel(input: { duration: number; entry: number; zoneAt: ((t: number) => Zone) | null; pins: Array<{ t: number; x: number }> }): ReelPlan | null {
  const { duration, zoneAt, pins } = input;
  if (!(duration > 0)) return null;
  const start = Math.max(0, Math.min(input.entry || 0, duration - MIN_REEL_SECONDS));
  const full = Math.min(REEL_SECONDS, duration - start);
  if (full < MIN_REEL_SECONDS) return null;
  const ts: number[] = [];
  for (let t = start; t <= start + full + 1e-9; t += 0.5) ts.push(t);
  // "Ahead" is opposite the camera operator (they walk behind the camera); without a zone, the video's own forward.
  let ahead = 0;
  if (zoneAt) {
    let x = 0, y = 0;
    for (const t of ts) { const z = zoneAt(t); x += Math.cos(z.yaw + Math.PI); y += Math.sin(z.yaw + Math.PI); }
    ahead = Math.atan2(y, x);
  }
  // The two shelf sides first (a store walk passes between shelves), then straight ahead.
  const candidates = [wrap(ahead + Math.PI / 2), wrap(ahead - Math.PI / 2), wrap(ahead)];
  const inWindow = pins.filter((p) => p.t >= start && p.t <= start + full);
  let best: ReelPlan | null = null;
  for (const hfov of FOVS) {
    for (const yaw of candidates) {
      const bad = zoneAt ? ts.find((t) => { const z = zoneAt(t); return Math.abs(wrap(z.yaw - yaw)) < hfov / 2 + z.width / 2 + MARGIN; }) : undefined;
      const seconds = bad === undefined ? full : Math.floor((bad - start - 0.5) * 2) / 2;
      if (seconds < MIN_REEL_SECONDS) continue;
      const products = inWindow.filter((p) => p.t <= start + seconds && Math.abs(wrap(p.x - yaw)) <= hfov / 2).length;
      const plan = { start, seconds, yaw, hfov, vfov: vfovOf(hfov), products };
      // More products seen wins; then a longer clip; then a wider view (earlier in FOVS).
      if (!best || products > best.products || (products === best.products && seconds > best.seconds)) best = plan;
    }
    if (best && best.seconds === full) break; // a clear full-length plan at this width: no need to narrow
  }
  return best;
}
