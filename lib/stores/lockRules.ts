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

/**
 * WHEN THE LOCK AGENT LOOKS (owner, 2026-11-06: "lock agent has not done its work, I as photographer with orange
 * jersey am visible when shopper turns 60 degree"). It looked at six fixed moments, and on Saraye Bamdad only the
 * first two found the operator, so from 38 s on the colour follow was unanchored and drifted to the front of the
 * walk by ~100 s. Now one look every `SEED_EVERY` seconds (at least `SEED_MIN`, at most `SEED_MAX`), in the
 * middle of each stretch. A look is about half a cent; a 150 s walk is ~19 looks.
 */
// 5 s (was 8): between two looks 8 s apart the colour follow still slid 40–70° off on Saraye Bamdad.
export const SEED_EVERY = 5, SEED_MIN = 6, SEED_MAX = 40;
export function seedTimes(seconds: number): number[] {
  if (!(seconds > 0)) return [];
  const n = Math.min(SEED_MAX, Math.max(SEED_MIN, Math.round(seconds / SEED_EVERY)));
  return Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * seconds);
}

/**
 * A look that boxes someone more than this many degrees from where the looks either side put the operator boxed
 * another person (a passer-by): dropped, so it never pulls the lock off the operator.
 */
export const SEED_JUMP = 70;
const angDeg = (a: number, b: number) => Math.abs(((((a - b) * 180) / Math.PI + 540) % 360) - 180);
/**
 * Drops, in place, each look (radians) that disagrees with both its neighbours by more than `SEED_JUMP`. Only
 * neighbours on the same side of a cut count (`together`): across a cut the operator really is elsewhere, and a
 * look with no neighbour on its side of the cut is kept.
 */
export function dropStrays<T extends { t: number; yaw: number }>(locks: T[], together: (a: number, b: number) => boolean = () => true): void {
  locks.sort((a, b) => a.t - b.t);
  if (locks.length < 3) return;
  const keep = locks.filter((l, i) => {
    const near = [locks[i - 1], locks[i + 1]].filter((m) => m && together(l.t, m.t));
    return !near.length || near.some((m) => angDeg(l.yaw, m.yaw) <= SEED_JUMP);
  });
  if (keep.length >= 2) locks.splice(0, locks.length, ...keep);
}
