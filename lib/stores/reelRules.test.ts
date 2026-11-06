import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_REEL_SECONDS, REEL_SECONDS, planReel, vfovOf } from "./reelRules.ts";

const D = Math.PI / 180;

test("starts inside the store and looks at the side with the products", () => {
  const pins = Array.from({ length: 20 }, (_, i) => ({ t: 40 + i, x: Math.PI / 2 })); // all on the right
  const p = planReel({ duration: 150, entry: 33, zoneAt: () => ({ yaw: Math.PI, width: 40 * D }), pins })!;
  assert.equal(p.start, 33);
  assert.equal(p.seconds, REEL_SECONDS);
  assert.ok(Math.abs(p.yaw - Math.PI / 2) < 1e-6, "the right-hand shelf");
  assert.equal(p.products, 20);
  assert.ok(Math.abs(p.vfov - vfovOf(p.hfov)) < 1e-9);
});

test("never frames the camera operator: a zone on the right side sends it left", () => {
  const pins = Array.from({ length: 10 }, (_, i) => ({ t: 5 + i, x: Math.PI / 2 }));
  // The operator stands to the right (an unusual hold); "ahead" is then to the left.
  const p = planReel({ duration: 60, entry: 0, zoneAt: () => ({ yaw: Math.PI / 2, width: 50 * D }), pins })!;
  const away = (y: number) => Math.abs(Math.atan2(Math.sin(y - Math.PI / 2), Math.cos(y - Math.PI / 2)));
  assert.ok(away(p.yaw) >= p.hfov / 2 + 25 * D, "clear of the zone");
});

test("too short a walk, or one with no clear direction, makes no reel", () => {
  assert.equal(planReel({ duration: MIN_REEL_SECONDS - 1, entry: 0, zoneAt: null, pins: [] }), null);
  assert.equal(planReel({ duration: 60, entry: 0, zoneAt: () => ({ yaw: 0, width: 2 * Math.PI }), pins: [] }), null);
});

test("an entry near the end is pulled back so the reel still has its length", () => {
  const p = planReel({ duration: 40, entry: 38, zoneAt: null, pins: [] })!;
  assert.equal(p.start, 40 - MIN_REEL_SECONDS);
  assert.equal(p.seconds, MIN_REEL_SECONDS);
});
