// Placing a scene in the tour's world: there and back, sane reading, and the
// Align tool's nudges keeping the junction where the operator looks.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { IDENTITY, nudge, parsePlace, toLocal, toWorld, type Place, type Vec3 } from "./place.ts";

const near = (a: Vec3, b: Vec3, eps = 1e-9) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < eps), `${a} ≉ ${b}`);

test("identity leaves points where they are", () => {
  near(toWorld(IDENTITY, [1, 2, 3]), [1, 2, 3]);
  near(toLocal(IDENTITY, [1, 2, 3]), [1, 2, 3]);
});

test("scale, then a turn about up, then a move — and back again", () => {
  const p: Place = { offset: [10, 0, -5], yaw: Math.PI / 2, scale: 2 };
  // (1, 0, 0) scaled to (2, 0, 0), turned a quarter about +y to (0, 0, −2), moved.
  near(toWorld(p, [1, 0, 0]), [10, 0, -7]);
  for (const v of [[0, 0, 0], [1, 2, 3], [-4, 0.5, 7]] as Vec3[]) near(toLocal(p, toWorld(p, v)), v);
});

test("a place from the tour is checked", () => {
  assert.equal(parsePlace(null), null);
  assert.deepEqual(parsePlace({ offset: [1, "x"], yaw: "a", scale: -2 }), { offset: [1, 0, 0], yaw: 0, scale: 1 });
  assert.deepEqual(parsePlace({ offset: [1, 2, 3], yaw: 0.5, scale: 1.5 }), { offset: [1, 2, 3], yaw: 0.5, scale: 1.5 });
});

test("turning or resizing keeps the point being looked at in place", () => {
  const p: Place = { offset: [3, 0, 1], yaw: 0.2, scale: 1.1 };
  const pivot: Vec3 = [5, 1.6, -4];
  const before = toLocal(p, pivot);
  const turned = nudge(p, { turn: 0.3 }, pivot);
  near(toWorld(turned, before), pivot, 1e-9);
  assert.ok(Math.abs(turned.yaw - 0.5) < 1e-12);
  const grown = nudge(p, { grow: 1.05 }, pivot);
  near(toWorld(grown, before), pivot, 1e-9);
  // A move is a move.
  near(nudge(p, { move: [0.5, 0, -0.5] }, pivot).offset, [3.5, 0, 0.5]);
});
