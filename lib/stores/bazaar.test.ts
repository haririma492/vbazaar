// The bazaar as places, with doors on any area (owner, 2026-11-01):
//   World on Yonge: O1 → S2 (door on outside); O1 → L1 → H1 → S1, L1 → H2 → S4
//   Plaza 2:        O2 → S3
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { areaDoorOf, emptyBazaar, joins, linkSpot, moveStore, parseBazaar, placeOfStore, putArea, putPlace, setArea, spotFor, startOf, takeSpot, type Bazaar } from "./bazaar.ts";

const w = (id: string) => `scenes/area-${id}/walk-1.mp4`;
const spot = (id: string, area: string, t: number) => ({ id, area, t, yaw: 0, pitch: 0, size: 0.5 });

/** The owner's four stores, as the operator would set them up. */
function fourStores(): Bazaar {
  let b = emptyBazaar(); // world-on-yonge: outside, lobby, hallway
  b = putPlace(b, "plaza-2", { en: "Plaza 2", fa: "" });
  b = putArea(b, "hallway-2", { en: "Hallway 2", fa: "" });
  b = putArea(b, "outside-2", { en: "Outside Plaza 2", fa: "" });
  b = setArea(b, "outside-2", { place: "plaza-2" });
  b = { ...b, areas: b.areas.map((a) => ({ ...a, walk: w(a.id) })) };
  b = { ...b, spots: [
    spot("o1-s2", "outside", 10), spot("l1-h1", "lobby", 5), spot("l1-h2", "lobby", 9),
    spot("h1-s1", "hallway", 4), spot("h2-s4", "hallway-2", 4), spot("o2-s3", "outside-2", 6),
  ] };
  b = linkSpot(b, "l1-h1", "hallway");
  b = linkSpot(b, "l1-h2", "hallway-2");
  for (const [sp, st] of [["o1-s2", "s2"], ["h1-s1", "s1"], ["h2-s4", "s4"], ["o2-s3", "s3"]]) b = takeSpot(b, sp, st);
  return b;
}

test("an old bazaar (one place, spots on the hallway) reads as World on Yonge", () => {
  const b = parseBazaar({ areas: [{ id: "outside", name: { en: "Outside" } }, { id: "hallway", name: { en: "Hallway" } }], hallway: "hallway", spots: [{ id: "spot-1", t: 3, yaw: 1, pitch: 0, size: 0.5, store: "alis" }] });
  assert.equal(b.places[0].id, "world-on-yonge");
  assert.ok(b.areas.every((a) => a.place === "world-on-yonge"));
  assert.equal(b.spots[0].area, "hallway");
});

test("the four stores: the walks join only where no door leads", () => {
  const b = fourStores();
  // Outside runs into the lobby; the lobby's doors lead into the hallways, so
  // the lobby does not run into a hallway, nor hallway 1 into hallway 2.
  assert.deepEqual(joins(b), [{ from: w("outside"), to: w("lobby") }]);
});

test("doors go on any area; a door into an area is not a store's spot", () => {
  const b = fourStores();
  assert.equal(spotFor(b, "s2")!.area, "outside");
  assert.equal(spotFor(b, "s3")!.area, "outside-2");
  assert.equal(spotFor(b, "new-store"), null, "the lobby's doors are not free for a store");
  assert.deepEqual(moveStore(b, "s1", "l1-h1"), b, "a store cannot take an area door");
  const door = areaDoorOf(b.spots.find((s) => s.id === "l1-h2")!, b.areas.find((a) => a.id === "hallway-2")!)!;
  assert.equal(door.to, w("hallway-2"));
  assert.equal(door.id, "area-hallway-2");
});

test("each place starts at its first area with a walk; a store belongs to its door's place", () => {
  const b = fourStores();
  assert.equal(startOf(b, "world-on-yonge")!.id, "outside");
  assert.equal(startOf(b, "plaza-2")!.id, "outside-2");
  assert.equal(placeOfStore(b, "s3"), "plaza-2");
  assert.equal(placeOfStore(b, "s4"), "world-on-yonge");
  assert.equal(placeOfStore(b, "unplaced"), undefined);
});

test("no lobby: outside runs straight into the hallway; «next» overrides it", () => {
  let b = emptyBazaar();
  b = { ...b, areas: b.areas.filter((a) => a.id !== "lobby").map((a) => ({ ...a, walk: w(a.id) })) };
  assert.deepEqual(joins(b), [{ from: w("outside"), to: w("hallway") }]);
  assert.deepEqual(joins(setArea(b, "outside", { next: "" })), [], "«nowhere» stops it");
  assert.deepEqual(joins(setArea(setArea(b, "outside", { next: "" }), "outside", { next: null })), [{ from: w("outside"), to: w("hallway") }], "back to the default");
});

test("a spot freed of its area door can take a store again", () => {
  const b = linkSpot(fourStores(), "l1-h2", "");
  assert.equal(spotFor(b, "new-store")!.id, "l1-h2");
});
