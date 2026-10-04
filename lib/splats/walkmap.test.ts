// The walk map: floor and scale from the points, solid walls at body height,
// depth in each direction, and the help it gives while walking.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { buildWalkMap, depthAt, findFloor, guide } from "./walkmap.ts";

/**
 * A street in scene units of 2 per metre (so the eye is 3.2 up): floor at
 * y = 0, a 4 m wide street running along −z for 40 m between two walls
 * (shop fronts) at x = ±4, a side street opening to the right at z = −20,
 * and a shop window closing the end at z = −40.
 */
function street(): Float32Array {
  const pts: number[] = [];
  // mulberry32: evenly spread, unlike a plain LCG in doubles (which clumps).
  let seed = 3;
  const r = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const U = 2;
  for (let i = 0; i < 60000; i++) pts.push((r() - 0.5) * 20 * U, 0, -r() * 44 * U); // floor
  for (let i = 0; i < 40000; i++) {
    const y = r() * 3 * U, z = -r() * 40 * U;
    pts.push(-2 * U, y, z); // left shop fronts
    if (z > -19 * U || z < -23 * U) pts.push(2 * U, y, z); // right, with the side street's gap
  }
  for (let i = 0; i < 8000; i++) pts.push((r() - 0.5) * 4 * U, r() * 3 * U, -40 * U); // the window at the end
  for (let i = 0; i < 8000; i++) pts.push(2 * U + r() * 16 * U, r() * 3 * U, -19 * U); // side street walls
  for (let i = 0; i < 8000; i++) pts.push(2 * U + r() * 16 * U, r() * 3 * U, -23 * U);
  for (let i = 0; i < 300; i++) pts.push((r() - 0.5) * 4 * U, r() * 3 * U, -r() * 40 * U); // floaters
  return new Float32Array(pts);
}

const EYE: [number, number, number] = [0, 3.2, -2];

test("the floor is the crowded layer below the eye, and gives the scale", () => {
  const pts = street();
  const floor = findFloor(pts, EYE)!;
  assert.ok(Math.abs(floor) < 0.2, `floor ${floor}`);
  const m = buildWalkMap(pts, EYE)!;
  assert.ok(Math.abs(m.unitsPerMetre - 2) < 0.15, `scale ${m.unitsPerMetre}`);
});

test("depth: long down the street, short to the shop fronts, open where the side street is", () => {
  const m = buildWalkMap(street(), EYE)!;
  const upm = m.unitsPerMetre;
  const ahead = depthAt(m, 0, -2 * upm, 0); // down the street (−z)
  assert.ok(ahead > 10 * upm, `ahead ${ahead / upm} m`);
  const left = depthAt(m, 0, -2 * upm, -Math.PI / 2);
  const right = depthAt(m, 0, -2 * upm, Math.PI / 2);
  assert.ok(left < 2.2 * upm && right < 2.2 * upm, `sides ${left / upm} ${right / upm} m`);
  // At the side street, looking right is open.
  assert.ok(depthAt(m, 0, -21 * upm, Math.PI / 2) > 8 * upm);
  // The floaters in the street do not block it.
  assert.ok(depthAt(m, 0, -5 * upm, 0) > 10 * upm);
});

test("walking at a shop window slows to a stop at arm's length: window shopping", () => {
  const m = buildWalkMap(street(), EYE)!;
  const upm = m.unitsPerMetre;
  assert.equal(guide(m, 0, -10 * upm, 0).speed, 1); // open street
  const near = guide(m, 0, -38.5 * upm, 0); // 1.5 m from the end window
  assert.ok(near.speed > 0 && near.speed < 1, `near ${near.speed}`);
  assert.equal(guide(m, 0, -39.6 * upm, 0).speed, 0); // at the glass
  // Facing a shop front from the middle of the street: slow, not stopped.
  const facing = guide(m, 0, -10 * upm, Math.PI / 2);
  assert.ok(facing.speed < 1);
});

test("heading a little off the open way, the walk is drawn along it", () => {
  const m = buildWalkMap(street(), EYE)!;
  const upm = m.unitsPerMetre;
  // Walking toward the right shop fronts at 30°: steer back left, toward the street.
  const g = guide(m, 1 * upm, -6 * upm, (30 * Math.PI) / 180);
  assert.ok(g.steer < 0, `steer ${g.steer}`);
  // Straight down the open street: no pull.
  assert.equal(guide(m, 0, -6 * upm, 0).steer, 0);
});

test("no floor to be found: no map, so nothing is guided", () => {
  assert.equal(buildWalkMap(new Float32Array([0, 5, 0, 1, 6, 1]), EYE), null);
});
