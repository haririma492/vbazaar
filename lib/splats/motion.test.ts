// A smooth ride from the walk's measured motion (`motion.ts`).
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_EASE, PACE_SPAN, STANDING, paceAt, parseMotion, turnEase, type WalkMotion } from "./motion.ts";

const walk = (speed: (t: number) => number, yaw: (t: number) => number, seconds = 30): WalkMotion => {
  const dt = 0.2, n = Math.round(seconds / dt);
  return { dt, speed: Array.from({ length: n }, (_, i) => speed(i * dt)), yaw: Array.from({ length: n }, (_, i) => yaw(i * dt)) };
};

test("even speed: hurried stretches play slower, dawdles and stands faster", () => {
  const m = walk((t) => (t < 10 ? 1.2 : t < 20 ? 0.3 : 0), () => 0);
  const target = 0.3;
  const rate = (t: number) => target / paceAt(m, t)!;
  // Hurrying at 1.2 m/s on a walk whose middle pace is 0.3: slowed, but at most PACE_SPAN× (a noisy patch cannot make it crawl).
  assert.ok(Math.abs(rate(5) - 0.3 / (0.3 * PACE_SPAN)) < 0.02, `hurrying: slowed to ${rate(5).toFixed(2)}×`);
  assert.ok(Math.abs(rate(15) - 1) < 0.05, "at the target pace: as filmed");
  assert.equal(paceAt(m, 25), STANDING, "standing: as if walking very slowly, so it passes quickly");
  assert.equal(paceAt(null, 3), null, "no motion measured: the walk's average pace, as before");
});

test("smooth turns: a sudden swing is eased, a slow turn is left alone, never more than the cap", () => {
  // A sharp 60° turn in half a second at 10 s.
  const sharp = walk(() => 0.5, (t) => (t < 10 ? 0 : t < 10.5 ? ((t - 10) / 0.5) * 1.05 : 1.05));
  assert.ok(Math.abs(turnEase(sharp, 10.4)) > 0.2, `the swing is eased (${turnEase(sharp, 10.4).toFixed(2)} rad)`);
  assert.ok(Math.abs(turnEase(sharp, 25)) < 0.01, "long after the turn: no correction left");
  assert.ok(Math.abs(turnEase(sharp, 10.3)) <= MAX_EASE + 1e-9);
  // A slow steady turn (10°/s) is how the photographer meant to walk: hardly touched.
  const slow = walk(() => 0.5, (t) => t * 0.175);
  assert.ok(Math.abs(turnEase(slow, 15)) < 0.02);
  // Read back from walks.json.
  assert.deepEqual(parseMotion(JSON.parse(JSON.stringify(slow)))?.speed.length, slow.speed.length);
  assert.equal(parseMotion({ dt: 0.2, speed: [1], yaw: [] }), null);
});
