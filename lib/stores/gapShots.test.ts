import { test } from "node:test";
import assert from "node:assert/strict";
import { gapShots, SHOT_MIN, SWEEP_DT, sweepShots, type Obs } from "./gapShots";

const o = (n: number, t: number, lon: number, lat = 0, area = 0.01): Obs => ({ n, t, lon, lat, area });

test("unpictured products seen together become one picture aimed at their middle; pictured ones are left out", () => {
  const obs = [o(1, 10, 1.5), o(2, 10.4, 1.6), o(3, 10.8, 1.7), o(4, 10.2, 1.55)];
  const shots = gapShots(obs, new Set([4]), 0, 10);
  assert.equal(shots.length, 1);
  assert.deepEqual(shots[0].products, [1, 2, 3]);
  assert.ok(Math.abs(shots[0].yaw - 1.6) < 0.05);
});

test("two bookcases at once (left and right of the aisle) are two pictures; a straggler gets none", () => {
  const obs = [o(1, 10, 1.5), o(2, 10.2, 1.6), o(3, 10, -1.5), o(4, 10.3, -1.6), o(9, 40, 0.2)];
  const shots = gapShots(obs, new Set(), 0, 10);
  assert.equal(shots.length, 2);
  assert.ok(shots.every((s) => s.products.length >= SHOT_MIN));
  assert.ok(!shots.some((s) => s.products.includes(9)));
});

test("before the store's door nothing is pictured, and the ceiling keeps the fullest pictures", () => {
  const obs = [o(1, 2, 0), o(2, 2.2, 0.1), o(3, 20, 1), o(4, 20.1, 1.05), o(5, 20.2, 1.1), o(6, 30, -1), o(7, 30.1, -1.05)];
  const shots = gapShots(obs, new Set(), 5, 1);
  assert.equal(shots.length, 1);
  assert.deepEqual(shots[0].products, [3, 4, 5]);
  assert.equal(gapShots(obs, new Set(), 5, 0).length, 0);
});

test("the seed is where a product looked biggest, and the picture is never aimed at the floor or ceiling", () => {
  const obs = [o(1, 10, 0, 0.9, 0.001), o(1, 30, 0.5, 0.9, 0.05), o(2, 30.5, 0.55, 0.9)];
  const [s] = gapShots(obs, new Set(), 0, 5);
  assert.equal(s.t, 30);
  assert.ok(s.pitch <= 0.4 + 1e-9);
});

test("the stretches nobody looked at get pictures of both sides (Saraye Bamdad: nothing after 1:43)", () => {
  // Seen every second from 35 s to 96 s; the cut walk keeps 0–96.7 and 109.7–133.2; the store starts at 33 s.
  const seen = Array.from({ length: 62 }, (_, i) => 35 + i);
  const shots = sweepShots(seen, [{ from: 0, to: 96.7 }, { from: 109.7, to: 133.2 }], 33, 152);
  assert.ok(shots.length > 0);
  assert.ok(shots.every((s) => s.t >= 109.7 && s.t < 133.2), "only where nothing was seen, and only in what the cut kept");
  assert.equal(shots.length % 2, 0, "both sides at each moment");
  const times = [...new Set(shots.map((s) => s.t))];
  assert.equal(times.length, Math.floor((133.2 - 0.2 - (109.7 + SWEEP_DT / 2)) / SWEEP_DT) + 1);
  // Not cut: the whole recording after the door.
  assert.ok(sweepShots([], [], 10, 20).every((s) => s.t >= 10 && s.t < 20));
});
