// WHEN A LABEL SHOWS — the rule the store's labels follow, renderer-free.
//
// The same rule will run over a Gaussian-splat store: it needs a camera
// position, the direction it looks, and an anchor. Nothing about how the
// store is drawn.
//
//   farther than labelDistance + FADE_M   nothing
//   labelDistance … + FADE_M              fading in
//   within labelDistance                  shown
//   within selectionDistance              shown, and the product can be taken
//
// and, whatever the distance, a product off to the side or behind the
// shopper loses its label — so passing a product fades it out.
//
// Import-free so `npm test` runs it directly.

export type V3 = { x: number; y: number; z: number };

/** The width (m) of the fade band beyond labelDistance. */
export const FADE_M = 1.0;
/** Fully shown within this angle (rad) of where the shopper looks… */
export const VIEW_FULL_RAD = (34 * Math.PI) / 180;
/** …gone beyond this one. */
export const VIEW_NONE_RAD = (52 * Math.PI) / 180;
/** How quickly a label's opacity follows its target (1/s): ~0.4 s to settle. */
export const FADE_RATE = 7;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export const distance = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** 1 within labelDistance, 0 beyond labelDistance + FADE_M, smooth between. */
export function distanceOpacity(d: number, labelDistance: number): number {
  return 1 - smoothstep(labelDistance, labelDistance + FADE_M, d);
}

/** 1 near the centre of view, 0 off to the side or behind. `forward` is unit. */
export function viewOpacity(eye: V3, forward: V3, anchor: V3): number {
  const dx = anchor.x - eye.x;
  const dy = anchor.y - eye.y;
  const dz = anchor.z - eye.z;
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) return 1;
  const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / l;
  return smoothstep(Math.cos(VIEW_NONE_RAD), Math.cos(VIEW_FULL_RAD), cos);
}

export type LabelState = { target: number; distance: number; selectable: boolean };

/** What a product's label should be doing for a shopper at `eye` looking along `forward`. */
export function labelState(
  eye: V3,
  forward: V3,
  p: { anchor: V3; labelDistance: number; selectionDistance: number },
): LabelState {
  const d = distance(eye, p.anchor);
  const view = viewOpacity(eye, forward, p.anchor);
  return {
    target: distanceOpacity(d, p.labelDistance) * view,
    distance: d,
    selectable: d <= p.selectionDistance && view > 0.5,
  };
}

/**
 * Frame-rate-independent easing of a value toward its target — labels never
 * pop, at 30 fps or 120.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** How much farther than adDistance a shopper must go before an ad may play again. */
export const AD_REARM_M = 1.5;

/**
 * The audio ad's latch: a product with an ad speaks once as the shopper
 * comes within adDistance with it in view, and not again until they have
 * walked away (beyond adDistance + AD_REARM_M) and come back.
 */
export function adStep(
  armed: boolean,
  distance: number,
  view: number,
  adDistance: number,
): { fire: boolean; armed: boolean } {
  if (armed && distance <= adDistance && view > 0.3) return { fire: true, armed: false };
  if (!armed && distance > adDistance + AD_REARM_M) return { fire: false, armed: true };
  return { fire: false, armed };
}
