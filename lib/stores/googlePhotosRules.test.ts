import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyGoogleRun, hostOf, photosOf, pickPhotos, productQuery, storeQuery, summaryNote, toSearch, usable, MIN_WIDTH } from "./googlePhotosRules.ts";

const img = (link: string, width = 1200, mime = "image/jpeg") => ({ link, mime, image: { width } });

test("a product is searched by its exact English name, then the store's name", () => {
  assert.equal(productQuery("Shiraz Gallery", { en: 'Saffron "Super" 50g' }), '"Saffron Super 50g" Shiraz Gallery');
});

test("no English name: the Farsi name; no name at all: nothing to search", () => {
  assert.equal(productQuery("Shop", { fa: "زعفران" }), '"زعفران" Shop');
  assert.equal(productQuery("Shop", {}), "");
});

test("the store is searched by its name and street only", () => {
  assert.equal(storeQuery("Uranus Bakery", "1234 Yonge St, North York, ON"), "Uranus Bakery 1234 Yonge St");
});

test("an answer keeps only usable, big-enough, https, non-svg, not-the-site pictures, in order, no repeats", () => {
  const picks = pickPhotos([
    img("http://old.example/a.jpg"),
    img("https://x.example/small.jpg", MIN_WIDTH - 1),
    img("https://x.example/logo.svg", 2000, "image/svg+xml"),
    img("https://shop.example/own.jpg"),
    img("https://x.example/good.jpg"),
    img("https://x.example/good.jpg"),
    img("https://y.example/two.png", 900, "image/png"),
    img("https://z.example/gif.gif", 900, "image/gif"),
    img("https://w.example/three.webp", 900, "image/webp"),
    img("https://v.example/four.jpg", 900),
  ], 3, "www.shop.example");
  assert.deepEqual(picks, ["https://x.example/good.jpg", "https://y.example/two.png", "https://w.example/three.webp"]);
});

test("a picture that says nothing about its type or size is not kept", () => {
  assert.equal(usable({ link: "https://a.example/x.jpg" }, ""), false);
  assert.equal(usable({ link: "https://a.example/x.jpg", mime: "image/jpeg" }, ""), true);
});

test("the website host is recognised with or without www", () => {
  assert.equal(hostOf("https://www.shop.example/"), "shop.example");
  assert.equal(hostOf(undefined), "");
  assert.equal(usable(img("https://shop.example/a.jpg"), "www.shop.example"), false);
});

test("all photos of a product are shown once each: main, website's, then Google's", () => {
  assert.deepEqual(
    photosOf({ photo: "a", more: ["b", "a"], google: ["c", "b", "d"] }),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(photosOf({}), []);
});

test("a search is skipped for a product already searched, unless the run is fresh", () => {
  const run = { ...emptyGoogleRun("shop"), products: { "1": { q: "x", photos: [], at: "", found: 0 } } };
  const products = [{ n: 1, en: "A" }, { n: 2, en: "B" }, { n: 3 }];
  assert.deepEqual(toSearch(products, run, false), [{ n: 2, q: '"B" shop' }]);
  assert.deepEqual(toSearch(products, run, true).map((x) => x.n), [1, 2]);
});

test("the note counts products with photos, photos, and the store's", () => {
  const run = { ...emptyGoogleRun("s"), queries: 3, products: {
    "1": { q: "a", photos: ["x", "y"], at: "", found: 2 }, "2": { q: "b", photos: [], at: "", found: 0 },
  }, store_photos: { q: "s", photos: ["z"], at: "", found: 1 } };
  assert.equal(summaryNote(run), "1 of 2 searched products have Google photos (2 in all); 1 photo of the store. 3 searches this run.");
});
