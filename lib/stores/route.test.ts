// The Route optimizer's rules (`route.ts`).
import test from "node:test";
import assert from "node:assert/strict";
import { blocksOf, coverageCheck, ensureCoverage, planRoute, type Motion } from "./route.ts";

/** A walk sampled 5 a second: `legs` of [seconds, forward m/s, turn rad/s]. */
function walkOf(legs: Array<[number, number, number]>): Motion {
  const m: Motion = { dt: 0.2, fwd: [], side: [], turn: [], sure: [] };
  for (const [s, f, w] of legs) for (let i = 0; i < s * 5; i++) { m.fwd.push(f); m.side.push(0); m.turn.push(w); m.sure.push(1); }
  return m;
}

test("walking back over shelves already shown is dropped; the walk goes on forward", () => {
  // In 5 s, along shelf A for 10 s, BACK 6 s over shelf A, then forward 6 s back to where it was, then on along shelf B.
  const m = walkOf([[5, 0.5, 0], [10, 0.4, 0], [6, -0.5, 0], [6, 0.5, 0], [10, 0.4, 0]]);
  const duration = 37;
  const seen = [
    { n: 1, from: 5, to: 15 },   // shelf A, first pass
    { n: 1, from: 15, to: 27 },  // shelf A again (back, then forward again)
    { n: 2, from: 27, to: 37 },  // shelf B
  ];
  const blocks = blocksOf(m, seen, duration);
  const { parts, dropped } = planRoute(blocks, 0, duration);
  assert.ok(dropped.back >= 5, `the walk back dropped (${dropped.back} s)`);
  assert.ok(dropped.again >= 4, `the second pass dropped (${dropped.again} s)`);
  const kept = parts.reduce((s, p) => s + p.to - p.from, 0);
  assert.ok(kept < 27 && kept > 22, `kept ${kept} s of 37`);
  assert.deepEqual(coverageCheck(seen, parts), [], "every product still shown");
  assert.equal(parts[0].from, 0, "the way in kept");
});

test("a long stand keeps a short look, not the whole wait", () => {
  const m = walkOf([[4, 0.5, 0], [8, 0, 0], [4, 0.5, 0]]);
  const seen = [{ n: 1, from: 4, to: 6 }, { n: 2, from: 12, to: 16 }];
  const { parts, dropped } = planRoute(blocksOf(m, seen, 16), 0, 16);
  assert.ok(dropped.still >= 4, `${dropped.still} s of standing dropped`);
  assert.deepEqual(coverageCheck(seen, parts), []);
});

test("a product only seen while walking back is kept; a product the plan would lose is put back", () => {
  const m = walkOf([[4, 0.5, 0], [4, -0.5, 0], [4, 0.5, 0]]);
  const seen = [{ n: 1, from: 0, to: 4 }, { n: 7, from: 5, to: 7 }, { n: 8, from: 5.5, to: 7 }, { n: 2, from: 8, to: 12 }];
  const { parts } = planRoute(blocksOf(m, seen, 12), 0, 12);
  assert.deepEqual(coverageCheck(seen, parts), [], "products 7 and 8 kept though seen walking back");
  const lost = ensureCoverage([{ n: 9, from: 20, to: 21 }], [{ from: 0, to: 10 }], 30);
  assert.ok(lost.some((p) => p.from <= 20 && p.to >= 21), "a lost product's stretch is added");
});
