/**
 * THE OPERATOR UNDER THE CAMERA (owner, 2026-11-03, on the area-outside walk:
 * "lock agent has not acted on this one"). When the camera is held just over
 * the head, the operator's head sits straight below it: in the panorama it
 * fills the bottom rows ALL THE WAY ROUND, so the agent's left/right edges
 * span half the picture and the person "moves" from side to side frame to
 * frame. A yaw zone there blocks a huge slice of the view and still shows the
 * head whenever a shopper looks down. The only lock that hides such a head is
 * a TILT one: the view may not look down so far that the screen's bottom edge
 * reaches the top of the head.
 *
 * Pure (tested in `lockRules.test.ts`); `lock.ts` uses it.
 */

/** What the agent saw at one moment: the person's width (deg) and the top of their head (deg above the horizon). */
export type Seen = { span: number; headLat: number };

/** Wider than this (deg), and with the head under the horizon, the person is under the camera. */
export const UNDER_SPAN = 120;
/** The head counts as under the camera when its top is this far below the horizon (deg). */
export const UNDER_HEAD = -20;

/** Whether the operator is under the camera: most moments seen show them that way. */
export function isUnderCamera(seen: Seen[]): boolean {
  if (!seen.length) return false;
  const under = seen.filter((s) => s.span >= UNDER_SPAN && s.headLat <= UNDER_HEAD).length;
  return under * 2 > seen.length;
}

/**
 * How far down (deg, negative) the view's middle may look so that the screen's
 * bottom edge (`halfVfov` below the middle, plus a little margin) stays above
 * the highest head-top seen. Never higher than −3° (shoppers can still look a
 * little down) nor lower than −40°.
 */
export function downForHead(seen: Seen[], halfVfov: number, margin = 5): number {
  const top = Math.max(...seen.map((s) => s.headLat));
  return Math.round(Math.min(-3, Math.max(-40, top + halfVfov + margin)) * 10) / 10;
}
