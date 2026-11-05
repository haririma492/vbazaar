// The Shelf Tour by shelf and level (`levels.ts`).
import test from "node:test";
import assert from "node:assert/strict";
import { levelsIn, planShelves, shelvesIn, stillSize, type Boxed } from "./levels.ts";

const d = Math.PI / 180;
const book = (n: number, lonDeg: number, latDeg: number, t = 5, wDeg = 2, hDeg = 8): Boxed => ({ n, t, lon: lonDeg * d, lat: latDeg * d, size: { w: wDeg * d, h: hDeg * d } });

test("a shelf's books → its levels, top to bottom, each book in one row", () => {
  const top = [book(1, 0, 20), book(2, 3, 21), book(3, 6, 19)];
  const mid = [book(4, 0, 5), book(5, 3, 4, 5, 2, 6), book(6, 6, 6)];
  const low = [book(7, 1, -10), book(8, 4, -11)];
  const rows = levelsIn([...low, ...top, ...mid]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.map((p) => p.n).sort()), [[1, 2, 3], [4, 5, 6], [7, 8]]);
});

test("a wide empty gap parts two bookcases", () => {
  const a = [book(1, 0, 0), book(2, 3, 0), book(3, 6, 0)];
  const b = [book(4, 20, 0), book(5, 23, 0), book(6, 26, 0)];
  assert.deepEqual(shelvesIn([...b, ...a]).map((g) => g.map((p) => p.n)), [[1, 2, 3], [4, 5, 6]]);
});

test("the same shelf in two pictures is one shelf: the closer picture is kept", () => {
  const far = [1, 2, 3, 4].map((n) => book(n, n * 2, 0, 10, 1.5, 5));
  const near = [1, 2, 3, 4].map((n) => book(n, n * 3, 0, 14, 3, 10));
  const plan = planShelves([...far, ...near]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].t, 14);
});

test("a level's still is wide and never squashed", () => {
  const z = stillSize({ lon: 0, lat: 0, w: 40 * d, h: 6 * d });
  assert.equal(z.w, 2048);
  assert.ok(z.h >= 360);
  assert.ok(Math.abs(Math.tan(z.hfov / 2) / Math.tan(z.vfov / 2) - z.w / z.h) < 0.02, "the picture's shape matches its fields of view");
});
