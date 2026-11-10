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

test("only a lit product with neither a name nor a price is filled", () => {
  const products = [found(1), found(2, { en: "Real title" }), found(3, { priceCents: 1299 }), found(4), found(5)];
  const r = demoFill(products, new Set([1, 2, 3, 4]), { slug: "shop", category: "Bookstore" });
  assert.equal(r.filled, 2);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.products[1], products[1]);
  assert.deepEqual(r.products[2], products[2]);
  assert.deepEqual(r.products[4], products[4]);
  for (const p of [r.products[0], r.products[3]]) {
    assert.ok(p.en && p.fa && p.demo && typeof p.priceCents === "number" && p.priceCents > 0);
  }
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
