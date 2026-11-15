import { test } from "node:test";
import assert from "node:assert/strict";
import { coverOf, emptyKit, kitFileName, kitReady, parseKitName, putPhoto, removeFromKit, saneQuad, setMatch, toMatch, toPlace, trayShelf, type Kit, type KitPhoto } from "./kitRules.ts";
import { quadPoints } from "../splats/shelves.ts";

const ph = (key: string): KitPhoto => ({ key, name: key, size: 1, at: "2026-11-15T00:00:00Z" });
const put = (k: Kit, slot: Parameters<typeof putPhoto>[1], key: string) => {
  const r = putPhoto(k, slot, ph(key), 3);
  if ("error" in r) throw new Error(r.error);
  return r.kit;
};

test("file names say which shelf, section and product", () => {
  assert.deepEqual(parseKitName("shelf-03.jpg"), { n: 3 });
  assert.deepEqual(parseKitName("Shelf_3-2.JPEG"), { n: 3, section: 2 });
  assert.deepEqual(parseKitName("shelf-03-2-p1.jpg"), { n: 3, section: 2, product: 1 });
  assert.deepEqual(parseKitName("shelf12-5-p24.webp"), { n: 12, section: 5, product: 24 });
  assert.equal(parseKitName("shelf-03-9.jpg"), null);
  assert.equal(parseKitName("IMG_2034.jpg"), null);
  assert.equal(parseKitName("shelf-0.jpg"), null);
  assert.equal(kitFileName(3, 2, 1), "shelf-03-2-p1.jpg");
  assert.deepEqual(parseKitName(kitFileName(7, 4)), { n: 7, section: 4 });
});

test("a shelf takes its photo, its sections and their products; a product needs its section first", () => {
  let k = emptyKit("s");
  k = put(k, { shelf: "z1" }, "III");
  k = put(k, { shelf: "z1", section: 2 }, "IV-2");
  k = put(k, { shelf: "z1", section: 1 }, "IV-1");
  assert.deepEqual(k.shelves[0].sections.map((x) => x.i), [1, 2]);
  assert.ok("error" in putPhoto(k, { shelf: "z1", section: 3, product: 1 }, ph("p")));
  k = put(k, { shelf: "z1", section: 1, product: 2 }, "p2");
  k = put(k, { shelf: "z1", section: 1, product: 1 }, "p1");
  assert.deepEqual(k.shelves[0].sections[0].products.map((p) => p.id), ["z1-1-p1", "z1-1-p2"]);
  assert.equal(kitReady(k), true);
  assert.equal(kitReady(emptyKit("s")), false);
  assert.equal(toMatch(k).length, 2);
  k = setMatch(k, "z1-1-p1", "https://shop/x");
  assert.equal(toMatch(k).length, 1);
  // The operator's choice survives a new photo of the product.
  k = put(k, { shelf: "z1", section: 1, product: 1 }, "p1b");
  assert.equal(k.shelves[0].sections[0].products[0].match?.web, "https://shop/x");
  assert.equal(toPlace(k).length, 2);
  k = removeFromKit(k, { shelf: "z1", section: 2 });
  assert.deepEqual(k.shelves[0].sections.map((x) => x.i), [1]);
  assert.equal(removeFromKit(k, { shelf: "z1" }).shelves.length, 0);
});

test("the tray changes shelf only when the next holds more than half of what is on screen", () => {
  assert.equal(trayShelf(null, [{ id: "a", cover: 0.3 }]), "a");
  assert.equal(trayShelf("a", [{ id: "a", cover: 0.3 }, { id: "b", cover: 0.25 }]), "a");
  assert.equal(trayShelf("a", [{ id: "a", cover: 0.2 }, { id: "b", cover: 0.25 }, { id: "c", cover: 0.15 }]), "a");
  assert.equal(trayShelf("a", [{ id: "a", cover: 0.1 }, { id: "b", cover: 0.4 }]), "b");
  assert.equal(trayShelf("a", []), "a");
});

test("what a shape covers of the screen, clipped to it", () => {
  assert.equal(coverOf([[0, 0], [100, 0], [100, 100], [0, 100]], 100, 100), 1);
  assert.equal(coverOf([[50, 0], [150, 0], [150, 100], [50, 100]], 100, 100), 0.5);
  assert.equal(coverOf([[200, 0], [300, 0], [300, 100]], 100, 100), 0);
});

test("a point of the shelf's photo lands inside its border on the walk", () => {
  const flat = [0.2, 0.1, 0.8, 0.1, 0.8, 0.9, 0.2, 0.9];
  assert.deepEqual(quadPoints(flat, [[0, 0], [1, 1], [0.5, 0.5]], false), [[0.2, 0.1], [0.8, 0.9], [0.5, 0.5]]);
  // A shelf seen at an angle: the corners still land on the corners.
  const lean = [0.1, 0.2, 0.6, 0.1, 0.65, 0.95, 0.12, 0.8];
  const r = quadPoints(lean, [[0, 0], [1, 0], [1, 1], [0, 1]], false)!;
  assert.deepEqual(r.flat(), lean);
  const round = [-0.3, 0.2, 0.3, 0.2, 0.3, -0.2, -0.3, -0.2];
  const m = quadPoints(round, [[0.5, 0.5]], true)!;
  assert.ok(Math.abs(m[0][0]) < 1e-3 && Math.abs(m[0][1]) < 1e-3);
});

test("a section's place is believable only as a real four-cornered shape inside the photo", () => {
  assert.equal(saneQuad([0.1, 0.1, 0.9, 0.1, 0.9, 0.4, 0.1, 0.4]), true);
  assert.equal(saneQuad([0.1, 0.1, 0.9, 0.4, 0.9, 0.1, 0.1, 0.4]), false);
  assert.equal(saneQuad([0.1, 0.1, 0.11, 0.1, 0.11, 0.11, 0.1, 0.11]), false);
  assert.equal(saneQuad(null), false);
});
