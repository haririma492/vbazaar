import { test } from "node:test";
import assert from "node:assert/strict";
import { trayByTime, trayInside, moveProduct, emptySections, sectionProductCount, trayCross, setItems, kitShareLink, readKitShare, sharedSection, coverOf, emptyKit, kitFileName, kitReady, parseKitName, putPhoto, removeFromKit, saneQuad, setMatch, toMatch, toPlace, trayShelf, type Kit, type KitPhoto } from "./kitRules.ts";
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

test("a share link says the shelf, the section and the product, and reads back the same", () => {
  const l = kitShareLink("https://vbazaar.app/walk/nuttime", { shelf: "z1", section: 2, product: "z1-2-p3" });
  assert.equal(l, "https://vbazaar.app/walk/nuttime?shelf=z1&section=2&product=z1-2-p3");
  assert.deepEqual(readKitShare(new URL(l).searchParams), { shelf: "z1", section: 2, product: "z1-2-p3" });
  assert.equal(kitShareLink("/vca/walk?v=scenes%2Fa%2Fb.mp4", { shelf: "z1" }), "/vca/walk?v=scenes%2Fa%2Fb.mp4&shelf=z1");
  assert.equal(readKitShare(new URLSearchParams("section=2")), null);
  assert.deepEqual(readKitShare(new URLSearchParams("shelf=z1&section=9&product=<x>")), { shelf: "z1" });
  const secs = [{ i: 1, products: [{ id: "a" }] }, { i: 2, products: [{ id: "b" }] }];
  assert.equal(sharedSection(secs, { shelf: "z", product: "b" })?.i, 2);
  assert.equal(sharedSection(secs, { shelf: "z", section: 1 })?.i, 1);
  assert.equal(sharedSection(secs, { shelf: "z" }), null);
});

test("the operator's website products on a section: in order, no repeats, only ones the store has", () => {
  let k = put(put(emptyKit("s"), { shelf: "z1" }, "III"), { shelf: "z1", section: 1 }, "IV-1");
  k = setItems(k, "z1-1", ["b", "a", "b", "", "ghost"], new Set(["a", "b"]));
  assert.deepEqual(k.shelves[0].sections[0].items, ["b", "a"]);
  k = setItems(k, "z1-1", [], new Set(["a"]));
  assert.deepEqual(k.shelves[0].sections[0].items, []);
});

test("the tray follows the shelf nearest the view's middle, once it is clearly nearer, coming in the way it moves", () => {
  const W = 1000;
  // At the start nothing is the tray's: the shelf nearest the middle.
  assert.equal(trayCross(null, new Map(), [{ id: "a", x: 300 }, { id: "b", x: 560 }], W)?.id, "b");
  // b is nearer than a, but not clearly (within 8% of the width): no flicker.
  assert.equal(trayCross("a", new Map(), [{ id: "a", x: 430 }, { id: "b", x: 560 }], W), null);
  // b clearly nearer, sliding left: in from the right.
  assert.deepEqual(trayCross("a", new Map([["b", 620]]), [{ id: "a", x: 200 }, { id: "b", x: 540 }], W), { id: "b", dir: -1 });
  // Walking back: a comes back from the left, moving right.
  assert.deepEqual(trayCross("b", new Map([["a", 380]]), [{ id: "a", x: 470 }, { id: "b", x: 800 }], W), { id: "a", dir: 1 });
  // The tray's shelf is out of view: the one in view at once, even off-middle.
  assert.equal(trayCross("a", new Map(), [{ id: "c", x: 900 }], W)?.id, "c");
  // Nothing in view: the tray keeps its shelf.
  assert.equal(trayCross("a", new Map(), [], W), null);
  assert.equal(trayCross("a", new Map(), [{ id: "c", x: 3000 }], W), null);
});

test("a section's products: the website's picked for it, and its own photos not already one of them", () => {
  const web = (w: string | null) => ({ match: { web: w } });
  assert.equal(sectionProductCount({ items: ["a", "b"], products: [web("a"), web(null), {}] }), 4);
  assert.deepEqual(emptySections([{ i: 1, items: ["a"], products: [] }, { i: 2, products: [] }, { i: 3, items: [], products: [{}] }]), [2]);
});

test("a product photo moves to another section with its match, taking the next free number there", () => {
  let k = put(put(put(emptyKit("s"), { shelf: "z1" }, "III"), { shelf: "z1", section: 1 }, "IV-1"), { shelf: "z1", section: 2 }, "IV-2");
  k = put(k, { shelf: "z1", section: 1, product: 1 }, "p1");
  k = put(k, { shelf: "z1", section: 2, product: 1 }, "q1");
  k = setMatch(k, "z1-1-p1", "w");
  k = setItems(k, "z1-1", ["w", "x"], new Set(["w", "x"]));
  const r = moveProduct(k, "z1-1-p1", 2);
  assert.ok("kit" in r);
  const [s1, s2] = r.kit.shelves[0].sections;
  assert.deepEqual(s1.products, []);
  assert.deepEqual(s1.items, ["x"]);
  assert.deepEqual(s2.products.map((p) => [p.id, p.match?.web]), [["z1-2-p1", undefined], ["z1-2-p2", "w"]]);
  assert.ok("error" in moveProduct(k, "z1-1-p1", 4));
  assert.ok("error" in moveProduct(k, "nope", 2));
});

test("with the operator's marks the tray takes the shelf whose mark the walk has passed", () => {
  const sh = [{ id: "b", trayAt: 9 }, { id: "a", trayAt: 0 }, { id: "c" }];
  assert.equal(trayByTime(sh, 0), "a");
  assert.equal(trayByTime(sh, 8.9), "a");
  assert.equal(trayByTime(sh, 9), "b");
  assert.equal(trayByTime(sh, 60), "b");
  assert.equal(trayByTime([{ id: "x", trayAt: 5 }], 1), "x");
  assert.equal(trayByTime([{ id: "x" }], 1), null);
});

test("with a start and an end per shelf, the tray takes the shelf the walk is inside; between shelves it keeps the last", () => {
  const sh = [{ id: "a", trayAt: 2, trayEnd: 16 }, { id: "b", trayAt: 12, trayEnd: 30 }, { id: "c", trayAt: 40, trayEnd: 50 }];
  assert.equal(trayByTime(sh, 0), "a");
  assert.equal(trayByTime(sh, 10), "a");
  assert.equal(trayByTime(sh, 13), "b"); // overlap: the later start
  assert.equal(trayByTime(sh, 35), "b"); // between b's end and c's start: b stays
  assert.equal(trayByTime(sh, 45), "c");
  assert.equal(trayByTime(sh, 99), "c");
});

test("a section takes a name (English and Farsi) and keeps its number; shoppers read the name", async () => {
  const { setSectionName, sectionLabel } = await import("./kitRules.ts");
  let k = put(put(emptyKit("s"), { shelf: "z1" }, "III"), { shelf: "z1", section: 2 }, "IV-2");
  const r = setSectionName(k, "z1-2", "  Rock   candy ", "نبات");
  assert.ok(!("error" in r));
  k = r as Kit;
  const sec = k.shelves[0].sections[0];
  assert.equal(sec.i, 2);
  assert.deepEqual(sec.name, { en: "Rock candy", fa: "نبات" });
  assert.equal(sectionLabel(sec, "fa"), "نبات");
  const cleared = setSectionName(k, "z1-2", "", "") as Kit;
  assert.equal(cleared.shelves[0].sections[0].name, undefined);
  assert.equal(sectionLabel(cleared.shelves[0].sections[0], "en"), "Section 2");
  assert.ok("error" in setSectionName(k, "nope", "x", ""));
});

test("a shelf's number in Farsi words, as an ordinal", async () => {
  const { faShelfOrdinal } = await import("./kitRules.ts");
  assert.equal(faShelfOrdinal(1), "قفسه اول");
  assert.equal(faShelfOrdinal(2), "قفسه دوم");
  assert.equal(faShelfOrdinal(3), "قفسه سوم");
  assert.equal(faShelfOrdinal(4), "قفسه چهارم");
  assert.equal(faShelfOrdinal(13), "قفسه سیزدهم");
  assert.equal(faShelfOrdinal(23), "قفسه بیست و سوم");
  assert.equal(faShelfOrdinal(30), "قفسه سی‌ام".replace("‌", ""));
  assert.equal(faShelfOrdinal(45), "قفسه ۴۵ام");
});

test("trayInside: only inside a marked stretch", () => {
  const sh = [{ id: "a", trayAt: 2, trayEnd: 8 }, { id: "b", trayAt: 10, trayEnd: 17 }];
  assert.equal(trayInside(sh, 1), null);
  assert.equal(trayInside(sh, 5), "a");
  assert.equal(trayInside(sh, 9), null);
  assert.equal(trayInside(sh, 17), "b");
  assert.equal(trayInside(sh, 30), null);
  assert.equal(trayInside([{ id: "a", trayAt: 2 }], 5), undefined);
});
