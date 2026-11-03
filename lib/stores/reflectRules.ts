/**
 * THE PHOTOGRAPHER'S REFLECTION (owner, 2026-11-03: "an agent that is delicate
 * with good dexterity to recognize the shadow of the walking photographer
 * everywhere mostly on glasses … and sometimes on stainless steel fridges";
 * treatment A: soften it; ceiling $0.30 a scene).
 *
 * The Reflection agent (`reflect.ts`) looks at the walk's horizon band a few
 * moments at a time; Claude boxes any reflection of the person carrying the
 * camera. This module is the arithmetic between the looks, pure and tested
 * (`reflectRules.test.ts`): strip pixels → directions on the panorama, which
 * box to blur at any moment (between two looks the reflection slides, so a box
 * is carried smoothly to the next look's), and the mask the Fixer blurs under.
 */

/** The horizon band each look shows (deg above the horizon): shop windows, doors, fridges. */
export const BAND_TOP = 35, BAND_BOTTOM = -40;
/** Each moment is a strip this many pixels: the whole way round, the band's height. */
export const STRIP_W = 1536, STRIP_H = 320;
/** Moments looked at: one every `STEP` seconds; this many per look (stacked strips). */
export const STEP = 2;
export const PER_LOOK = 3;
/** The mask: small, a few frames a second (ffmpeg stretches it over the video). */
export const MASK_W = 320, MASK_H = 160, MASK_FPS = 5;

/** One reflection seen at one moment: its middle direction and size, in degrees. */
export type Seen = { t: number; yaw: number; width: number; top: number; bottom: number };

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** A box Claude gave in a strip's pixels → where it is on the panorama. */
export function stripBoxToSeen(t: number, box: [number, number, number, number]): Seen | null {
  let [x1, y1, x2, y2] = box.map((v) => Math.round(v));
  x1 = Math.max(0, Math.min(STRIP_W, x1)); x2 = Math.max(0, Math.min(STRIP_W, x2));
  y1 = Math.max(0, Math.min(STRIP_H, y1)); y2 = Math.max(0, Math.min(STRIP_H, y2));
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  const degX = 360 / STRIP_W, degY = (BAND_TOP - BAND_BOTTOM) / STRIP_H;
  const width = (x2 - x1) * degX;
  if (width > 120) return null; // half the street is not a reflection
  return {
    t,
    yaw: wrap(((x1 + x2) / 2) * degX - 180),
    width,
    top: BAND_TOP - y1 * degY,
    bottom: BAND_TOP - y2 * degY,
  };
}

/** Two looks see the same reflection when they are one step apart and this close (deg). */
const SAME_WITHIN = 30;

/**
 * The boxes to soften at time `t`: a reflection seen at two neighbouring looks
 * is carried smoothly between them; one seen only once is softened for half a
 * step either side of its look. Each box grows by `margin` (a fraction) so
 * the edge of the reflection is covered too.
 */
export function boxesAt(seen: Seen[], t: number, margin = 0.35): Seen[] {
  const out: Seen[] = [];
  for (const a of seen) {
    if (Math.abs(t - a.t) > STEP) continue;
    const next = seen.find((b) => b.t > a.t && b.t <= a.t + STEP * 1.5 && Math.abs(wrap(b.yaw - a.yaw)) <= SAME_WITHIN);
    const prev = seen.find((b) => b.t < a.t && b.t >= a.t - STEP * 1.5 && Math.abs(wrap(b.yaw - a.yaw)) <= SAME_WITHIN);
    if (t >= a.t && next && t <= next.t) {
      const k = (t - a.t) / (next.t - a.t);
      out.push({
        t,
        yaw: wrap(a.yaw + wrap(next.yaw - a.yaw) * k),
        width: a.width + (next.width - a.width) * k,
        top: a.top + (next.top - a.top) * k,
        bottom: a.bottom + (next.bottom - a.bottom) * k,
      });
    } else if ((t >= a.t && !next && t - a.t <= STEP / 2) || (t < a.t && !prev && a.t - t <= STEP / 2)) {
      out.push({ ...a, t });
    }
  }
  return out.map((b) => {
    const h = b.top - b.bottom;
    return { ...b, width: Math.max(4, b.width * (1 + 2 * margin)), top: b.top + h * margin, bottom: b.bottom - h * margin };
  });
}

/** One mask frame (MASK_W × MASK_H grey, 255 = soften) with these boxes drawn, wrapping round the back. */
export function maskFrame(boxes: Seen[]): Uint8Array {
  const m = new Uint8Array(MASK_W * MASK_H);
  for (const b of boxes) {
    const r1 = Math.max(0, Math.floor(((90 - b.top) / 180) * MASK_H));
    const r2 = Math.min(MASK_H, Math.ceil(((90 - b.bottom) / 180) * MASK_H));
    const c1 = Math.floor(((b.yaw - b.width / 2 + 180) / 360) * MASK_W);
    const c2 = Math.ceil(((b.yaw + b.width / 2 + 180) / 360) * MASK_W);
    for (let r = r1; r < r2; r++) {
      for (let c = c1; c < c2; c++) m[r * MASK_W + (((c % MASK_W) + MASK_W) % MASK_W)] = 255;
    }
  }
  return m;
}

/** The moments looked at over a walk of `seconds`, grouped `PER_LOOK` to a look. */
export function looks(seconds: number): number[][] {
  const ts: number[] = [];
  for (let t = 0.5; t < seconds - 0.2; t += STEP) ts.push(Math.round(t * 100) / 100);
  const out: number[][] = [];
  for (let i = 0; i < ts.length; i += PER_LOOK) out.push(ts.slice(i, i + PER_LOOK));
  return out;
}
