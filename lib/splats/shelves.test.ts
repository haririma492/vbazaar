import { test } from "node:test";
import assert from "node:assert/strict";
import { followPoints, moveQuad, nextShelfNumber, rectFromTaps, shelfLabel, smoothOutline } from "./shelves.ts";

const near = (a: number[], b: number[], eps: number) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

test("a shelf is called by its number, its name, or both", () => {
  assert.deepEqual(shelfLabel(3, undefined), { en: "Shelf 3", fa: "قفسه ۳" });
  assert.deepEqual(shelfLabel(undefined, { en: "Spices" }), { en: "Spices" });
  assert.deepEqual(shelfLabel(12, { en: "Spices", fa: "ادویه" }), { en: "12 · Spices", fa: "۱۲ · ادویه" });
  assert.deepEqual(shelfLabel(2, { en: "", fa: "چای" }), { en: "2 · چای", fa: "۲ · چای" });
  assert.deepEqual(shelfLabel(undefined, undefined), { en: "Shelf", fa: "قفسه" });
});

test("the next number skips the ones taken, the finder's «Shelf N» too", () => {
  assert.equal(nextShelfNumber([]), 1);
  assert.equal(nextShelfNumber([{ n: 1, label: { en: "1 · Tea" } }, { label: { en: "Shelf 2" } }, { label: { en: "Rugs" } }]), 3);
});

test("two taps on a flat video are a rectangle, whichever corners were tapped", () => {
  assert.deepEqual(rectFromTaps({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.1 }, false), [0.2, 0.1, 0.6, 0.1, 0.6, 0.7, 0.2, 0.7]);
  assert.equal(rectFromTaps({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 }, false), null); // a line is not a shelf
});

test("two taps on a 360° walk are an upright rectangle through both taps", () => {
  const c = rectFromTaps({ x: 1.0, y: 0.3 }, { x: 1.5, y: -0.2 }, true)!;
  // The tapped corners are two of its corners: top-left and bottom-right.
  assert.ok(near([c[0], c[1]], [1.0, 0.3], 1e-3));
  assert.ok(near([c[4], c[5]], [1.5, -0.2], 1e-3));
  // Top above bottom, left before right.
  assert.ok(c[1] > c[7] && c[3] > c[5] && c[2] > c[0] && c[4] > c[6]);
  // Across the seam at ±π it is still one small rectangle.
  const s = rectFromTaps({ x: 3.0, y: 0.2 }, { x: -3.0, y: -0.2 }, true)!;
  assert.ok(near([s[0], s[1]], [3.0, 0.2], 1e-3) && near([s[4], s[5]], [-3.0, -0.2], 1e-3));
  assert.equal(rectFromTaps({ x: 0, y: 0 }, { x: 3, y: 0 }, true), null); // half the room is not a shelf
});

test("the border moves, grows and leans with the points followed inside it (flat)", () => {
  const quad = [0.2, 0.2, 0.6, 0.2, 0.6, 0.8, 0.2, 0.8];
  const seeds = followPoints(quad, false);
  assert.equal(seeds.length, 5);
  assert.ok(near(seeds[0], [0.4, 0.5], 1e-9));
  // The camera steps closer and to the side: everything 1.5× bigger about (0.4, 0.5), slid 0.1 right.
  const f = ([x, y]: [number, number]): [number, number] => [0.4 + (x - 0.4) * 1.5 + 0.1, 0.5 + (y - 0.5) * 1.5];
  const moved = moveQuad(quad, seeds, seeds.map(f), false)!;
  assert.ok(near(moved, [0.2, 0.05, 0.8, 0.05, 0.8, 0.95, 0.2, 0.95], 1e-3));
  // Two points lost: still found from three.
  const some = seeds.map((p, i) => (i === 1 || i === 3 ? null : f(p)));
  assert.ok(near(moveQuad(quad, seeds, some, false)!, moved, 1e-3));
  // Three lost: not guessed.
  assert.equal(moveQuad(quad, seeds, seeds.map((p, i) => (i < 3 ? null : f(p))), false), null);
  // A point that slid onto something else far away: not believed.
  const wild = seeds.map(f);
  wild[2] = [5, 5];
  assert.equal(moveQuad(quad, seeds, wild, false), null);
});

test("on a 360° walk the border turns with the camera", () => {
  const quad = rectFromTaps({ x: -0.3, y: 0.25 }, { x: 0.3, y: -0.25 }, true)!;
  const seeds = followPoints(quad, true);
  // The camera turns 0.4 rad: every direction's yaw moves by 0.4 (exact for a turn about the vertical).
  const moved = moveQuad(quad, seeds, seeds.map(([x, y]) => [x + 0.4, y] as [number, number]), true)!;
  assert.ok(near(moved, quad.map((v, j) => (j % 2 === 0 ? v + 0.4 : v)), 2e-3));
});

test("a border's steps are evened out, a yaw the short way round", () => {
  const frames = [{ t: 0, c: [3.1, 0, 3.1, 0, 3.1, 0, 3.1, 0] }, { t: 0.2, c: [-3.1, 0.3, -3.1, 0, -3.1, 0, -3.1, 0] }, { t: 0.4, c: [3.1, 0, 3.1, 0, 3.1, 0, 3.1, 0] }];
  const s = smoothOutline(frames, true);
  assert.equal(s.length, 3);
  assert.ok(Math.abs(Math.abs(s[1].c[0]) - Math.PI) < 0.1); // stays by the seam, not averaged to 1.0
  assert.equal(s[1].c[1], 0.1);
});
