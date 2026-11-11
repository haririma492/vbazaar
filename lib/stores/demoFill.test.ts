import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, demoClear, demoCount, demoFill, kindOf, shopPrice } from "./demoFill.ts";
import { checkCatalogue, type Product } from "../splats/catalogue.ts";

const found = (n: number, more: Partial<Product> = {}): Product => ({ n, unit: "piece", priceCents: null, by: "video", ...more });

test("the store's kind comes from its category, then its name", () => {
  assert.equal(kindOf({ slug: "a", category: "Bookstore" }).id, "books");
  assert.equal(kindOf({ slug: "a", category: "کتابفروشی" }).id, "books");
  assert.equal(kindOf({ slug: "a", category: "Dry nuts" }).id, "nuts");
  assert.equal(kindOf({ slug: "a", category: "Grocery" }).id, "grocery");
  assert.equal(kindOf({ slug: "a", category: "Persian handicrafts" }).id, "crafts");
  assert.equal(kindOf({ slug: "a", category: "Shop", nameEn: "Shiraz Gallery" }).id, "crafts");
  assert.equal(kindOf({ slug: "a", category: "Something else" }).id, "general");
});

test("a shown product takes a name where it has none and a price where it has none; what is there stays", () => {
  const products = [found(1), found(2, { en: "Real title" }), found(3, { priceCents: 1299 }), found(4, { en: "Both", priceCents: 500 }), found(5)];
  const r = demoFill(products, new Set([1, 2, 3, 4]), { slug: "shop", category: "Bookstore" });
  assert.equal(r.filled, 3);
  assert.equal(r.skipped, 1);
  assert.ok(r.products[0].en && r.products[0].fa && r.products[0].priceCents! > 0 && r.products[0].demo === true);
  assert.equal(r.products[1].en, "Real title");
  assert.ok(r.products[1].priceCents! > 0 && r.products[1].demo === "price");
  assert.equal(r.products[2].priceCents, 1299);
  assert.ok(r.products[2].en && r.products[2].demo === "name");
  assert.deepEqual(r.products[3], products[3]);
  assert.deepEqual(r.products[4], products[4]);
  // Removing takes away exactly what was made up.
  assert.deepEqual(demoClear(r.products).products, products);
});

test("a named product's price comes from the row most like its name", () => {
  const store = { slug: "shirazgallery", category: "Glassware", nameEn: "ShirazGallery" };
  assert.equal(kindOf(store).id, "home");
  const products = [found(1, { en: "GRANITE COOKWARE SET" }), found(2, { en: "Salad Bowl" }), found(3, { en: "GRANITE COOKWARE SET" })];
  const r = demoFill(products, new Set([1, 2, 3]), store);
  assert.ok(r.products[0].priceCents! >= 16000 && r.products[0].priceCents! <= 32000, String(r.products[0].priceCents));
  assert.ok(r.products[1].priceCents! >= 2100 && r.products[1].priceCents! <= 4900, String(r.products[1].priceCents));
  assert.equal(r.products[0].priceCents, r.products[2].priceCents);
});

test("names are not repeated while the kind has more, and prices stay in the kind's range", () => {
  const books = KINDS.find((k) => k.id === "books")!;
  const products = Array.from({ length: books.rows.length + 5 }, (_, i) => found(i + 1));
  const r = demoFill(products, new Set(products.map((p) => p.n)), { slug: "saraye-bamdad", category: "Bookstore" });
  const names = r.products.map((p) => p.en);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.filter((n) => /\(/.test(n ?? "")).length, 5);
  const lo = Math.min(...books.rows.map((x) => x[2])), hi = Math.max(...books.rows.map((x) => x[3]));
  for (const p of r.products.slice(0, books.rows.length).filter((p) => !/\(/.test(p.en ?? ""))) {
    assert.ok(p.priceCents! >= lo * 100 - 100 && p.priceCents! <= hi * 100 + 100, `${p.en} ${p.priceCents}`);
  }
});

test("the same store gets the same names and prices each time; what was seen picks a fitting name", () => {
  const products = [found(1), found(2, { seen: "glass jar of mixed pickles" }), found(3)];
  const store = { slug: "alis-market", category: "Grocery" };
  const a = demoFill(products, new Set([1, 2, 3]), store), b = demoFill(products, new Set([1, 2, 3]), store);
  assert.deepEqual(a.products, b.products);
  assert.match(a.products[1].en!, /pickle/i);
});

test("a word every product was seen with does not pile them onto one name", () => {
  const products = Array.from({ length: 150 }, (_, i) => found(i + 1, { seen: `book with a ${i % 2 ? "blue" : "red"} spine` }));
  const r = demoFill(products, new Set(products.map((p) => p.n)), { slug: "saraye-bamdad", category: "Bookstore" });
  const names = r.products.map((p) => p.en);
  assert.equal(new Set(names).size, names.length);
});

test("filled products pass the catalogue's check, and removing puts them back", () => {
  const products = [found(1, { seen: "blue spine" }), found(2, { en: "Kept", priceCents: 500 })];
  const r = demoFill(products, new Set([1, 2]), { slug: "shop", category: "Bookstore" });
  const checked = checkCatalogue({ store: "store-shop", products: r.products });
  assert.deepEqual(checked.problems, []);
  assert.equal(demoCount(checked.catalogue!.products), 1);
  const back = demoClear(checked.catalogue!.products);
  assert.equal(back.cleared, 1);
  assert.deepEqual(back.products, products);
});

test("prices are written as a shop writes them", () => {
  assert.equal(shopPrice(4.3), 449);
  assert.equal(shopPrice(4.8), 499);
  assert.equal(shopPrice(23.4), 2299);
  assert.equal(shopPrice(182), 18000);
  assert.equal(shopPrice(2430), 245000);
});
