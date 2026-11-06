// The Tidy agent's rules: what is looked at, what is one object, what stands in its place (`tidyRules.ts`).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_CENTS, TIDY_EVERY, coverLayout, groupJunk, pickProducts, sameObject, thinPins, tidyPlan, worthCovering, type JunkTrack } from "./tidyRules.ts";
import { coverSize, coversAt, parseWalks, type Walk } from "../splats/walks.ts";
import type { Product } from "../splats/catalogue.ts";

test("the plan starts at the door, looks round six ways, and fits the ceiling", () => {
  const p = tidyPlan(120, 30, 200);
  assert.ok(p[0].t >= 30);
  assert.equal(p[0].looks.length, 6);
  assert.ok(p.length <= Math.floor(200 / MOMENT_CENTS));
  for (let i = 1; i < p.length; i++) assert.ok(p[i].t - p[i - 1].t >= TIDY_EVERY - 0.01);
  const long = tidyPlan(3000, 0, 200);
  assert.ok(long.length <= Math.floor(200 / MOMENT_CENTS), "a long walk is spaced out, never over the ceiling");
  assert.ok(long[long.length - 1].t > 2500, "and still reaches the end");
});

const track = (t: number, x: number, w = 0.2, extra: Partial<JunkTrack> = {}): JunkTrack => ({
  t, lon: x, lat: -0.3, size: { w, h: w }, what: "an old chair", base: "floor", confidence: 0.9,
  pins: [0, 0.1, 0.2, 0.3, 0.4].map((d) => ({ t: Math.round((t + d) * 100) / 100, x: x + d * 0.1, y: -0.3 })),
  ...extra,
});

test("two follows through the same spot at the same moment are one object", () => {
  assert.ok(sameObject(track(10, 1), track(10.2, 1.02)));
  assert.ok(!sameObject(track(10, 1), track(10, 2)), "the other side of the room");
  assert.ok(!sameObject(track(10, 1), track(30, 1)), "never at the same moment");
  const g = groupJunk([track(10, 1), track(10.2, 1.02, 0.3), track(10, 2.5, 0.2, { what: "a sweater", base: "table" })]);
  assert.equal(g.length, 2);
  const chair = g.find((j) => j.what === "an old chair")!;
  assert.equal(chair.seen, 2);
  assert.equal(chair.size.w, 0.3, "the larger outline is kept, so none of it shows");
});

test("unsure, tiny, huge or barely followed sightings are not covered", () => {
  assert.ok(!worthCovering({ size: { w: 0.2, h: 0.2 }, confidence: 0.4 }));
  assert.ok(!worthCovering({ size: { w: 0.01, h: 0.01 }, confidence: 0.9 }));
  assert.ok(!worthCovering({ size: { w: 1.2, h: 0.2 }, confidence: 0.9 }));
  const short = { ...track(5, 0), pins: [{ t: 5, x: 0, y: -0.3 }] };
  assert.equal(groupJunk([short]).length, 0);
});

test("pins are thinned evenly to what the walk keeps", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ t: i / 10, x: 0, y: 0 }));
  const thin = thinPins(many, 200);
  assert.equal(thin.length, 200);
  assert.equal(thin[0].t, 0);
  assert.equal(thin[199].t, 49.9);
});

test("products with photos stand in, priced and the store's own photos first, each once before twice", () => {
  const P = (n: number, extra: Partial<Product> = {}): Product => ({ n, unit: "piece", priceCents: 500, photo: `https://x/${n}.jpg`, ...extra });
  const list = [P(1, { by: "video" }), P(2), P(3, { priceCents: null }), P(4, { photo: undefined })];
  assert.deepEqual(pickProducts(list, 3), [2, 1, 3]);
  assert.deepEqual(pickProducts(list, 4), [2, 1, 3, 2]);
  assert.deepEqual(pickProducts(list, 1, [2]), [1], "one another cover already shows comes later");
  assert.deepEqual(pickProducts([P(9, { photo: undefined })], 2), []);
});

test("a cover stands on what the junk stood on, and is bigger than it", () => {
  const c = coverSize({ w: 0.2, h: 0.1 });
  assert.ok(c.w > 0.2 && c.h > 0.1);
  const floor = coverLayout(c, "floor"), table = coverLayout(c, "table"), wall = coverLayout(c, "wall");
  assert.ok(floor.stand > table.stand && table.stand > 0 && wall.stand === 0);
  for (const l of [floor, table, wall]) {
    assert.equal(l.card.y + l.card.h + l.stand, l.H, "the card sits right on the stand");
    assert.ok(l.photo.w % 2 === 0 && l.photo.h % 2 === 0);
  }
});

test("a cover is drawn with its bottom at the junk's bottom, and the walk file keeps it", () => {
  const walk: Walk = {
    doors: [],
    covers: [{ id: "chair-1", n: 2, base: "floor", size: { w: 0.2, h: 0.2 }, what: "an old chair", image: "https://x/c.png", photo: "https://x/p.jpg",
      pins: [{ t: 10, x: 1, y: -0.3 }, { t: 10.5, x: 1.05, y: -0.3 }, { t: 11, x: 1.1, y: -0.3 }] }],
  };
  const [shown] = coversAt(walk, 10.5, true);
  assert.equal(shown.item.n, 2);
  const bottom = shown.y - shown.item.size!.h / 2;
  assert.ok(bottom < -0.4 && bottom > -0.42, `bottom at the chair's feet, not in the air (${bottom})`);
  assert.equal(coversAt(walk, 30, true).length, 0, "not where the chair is not");
  const parsed = parseWalks({ walks: { "scenes/store-x/w.mp4": walk } });
  assert.equal(parsed.walks["scenes/store-x/w.mp4"].covers?.length, 1);
  const bad = parseWalks({ walks: { "scenes/store-x/w.mp4": { ...walk, covers: [{ ...walk.covers![0], image: "javascript:x" }] } } });
  assert.equal(bad.walks["scenes/store-x/w.mp4"].covers, undefined);
});

test("a cut moves the covers with the picture, and drops one whose clutter was cut out", async () => {
  const { remapWalk } = await import("../splats/cut.ts");
  const c = (id: string, t: number) => ({ id, n: 1, base: "table" as const, size: { w: 0.2, h: 0.2 }, what: "papers", image: "https://x/c.png", photo: "https://x/p.jpg", pins: [{ t, x: 0, y: 0 }] });
  const { walk } = remapWalk({ doors: [], covers: [c("a", 5), c("b", 25)] }, [{ from: 20, to: 30 }]);
  assert.deepEqual(walk.covers?.map((x) => [x.id, x.pins[0].t]), [["b", 5]]);
});
