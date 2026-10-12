// A store's product list from the merchant's sheet: the Sarekooche number
// (1–999), titles, unit, price, photo — every problem said, row by row.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCatalogue, formatCents, nextNumber, parseSheet, priceOf, productName, productOf, readPrice, readUnit,
  aislesOf, storeOfScene, unitPriceSay, weightChoices,
} from "./catalogue.ts";

const HEADER = ["number", "product no", "title_fa", "title_en", "units", "unit price", "link to photo"];

test("a merchant's sheet becomes the store's products", () => {
  const { products, problems } = parseSheet([
    ["Ali's Market — product list"],
    HEADER,
    ["1", "100200300400", "پسته اکبری", "Akbari pistachio", "lb", "$12.99", "https://example.com/p.jpg"],
    ["2", "", "زعفران", "Saffron", "gr", "4.5", ""],
    ["3", "778", "", "Basmati rice 10 lb", "bag", "24,99", "http://example.com/r.jpg"],
    ["", "", "", "", "", "", ""],
    ["2", "999", "تکراری", "", "piece", "1", ""],
    ["1000", "", "x", "", "kg", "1", ""],
    ["4", "", "", "", "kg", "1", ""],
    ["5", "", "چای", "", "packet of 20", "", ""],
  ]);
  assert.deepEqual(products.map((p) => [p.n, p.unit, p.priceCents]), [[1, "lb", 1299], [2, "g", 450], [3, "pack", 2499], [5, "piece", null]]);
  assert.equal(products[0].sku, "100200300400");
  assert.equal(products[0].photo, "https://example.com/p.jpg");
  assert.equal(products[2].photo, undefined, "http:// is not kept");
  assert.equal(productName(products[2], "fa"), "Basmati rice 10 lb", "no Farsi title: the English one");
  const said = problems.join("\n");
  assert.match(said, /Row 5 \(#3\): the photo is not an https/);
  assert.match(said, /Row 7: number 2 is already used on row 4/);
  assert.match(said, /Row 8: «1000» is not a number from 1 to 999/);
  assert.match(said, /Row 9 \(#4\): no title/);
  assert.match(said, /Row 10 \(#5\): unit «packet of 20»/);
});

test("Farsi headers, in any order", () => {
  const { products, problems } = parseSheet([
    ["قیمت", "واحد", "نام فارسی", "شماره", "کد کالا"],
    ["۳.۵۰", "کیلو", "خرما", "7", "A-1"],
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(products, [{ n: 7, unit: "kg", priceCents: 350, sku: "A-1", fa: "خرما" }]);
});

test("a sheet without a number column is refused, and says what it needs", () => {
  const { products, problems } = parseSheet([["name", "price"], ["Tea", "3"]]);
  assert.equal(products.length, 0);
  assert.match(problems[0], /«number» column/);
});

test("units, prices and weights as merchants write them", () => {
  assert.equal(readUnit("Kg"), "kg");
  assert.equal(readUnit("گرم"), "g");
  assert.equal(readUnit("LBS"), "lb");
  assert.equal(readUnit("each"), "piece");
  assert.equal(readUnit("جعبه"), "box");
  assert.equal(readUnit("bottle"), "pack");
  assert.equal(readUnit("handful"), null);
  assert.equal(readPrice("$1,299.50"), 129950);
  assert.equal(readPrice("۱۲.۵"), 1250);
  assert.equal(readPrice(4.2), 420);
  assert.equal(readPrice("call us"), null);
  const nuts = { n: 1, unit: "lb" as const, priceCents: 1299 };
  assert.deepEqual(weightChoices("lb").slice(0, 3), [0.5, 1, 1.5]);
  assert.equal(priceOf(nuts, 1.5), 1949);
  assert.equal(formatCents(1949), "$19.49");
  assert.equal(unitPriceSay(nuts, "en"), "$12.99 / lb");
  assert.equal(unitPriceSay({ n: 2, unit: "piece", priceCents: 350 }, "en"), "$3.50 / each");
  assert.equal(unitPriceSay({ n: 3, unit: "kg", priceCents: null }, "fa"), "قیمت در فروشگاه");
});

test("a product added by hand takes the next free number; stores come from shelf video names", () => {
  const c = { store: "alis-market", products: [{ n: 1, unit: "kg" as const, priceCents: 1 }, { n: 2, unit: "kg" as const, priceCents: 1 }, { n: 4, unit: "kg" as const, priceCents: 1 }] };
  assert.equal(nextNumber(c), 3);
  assert.equal(nextNumber(null), 1);
  assert.equal(productOf(c, 4)?.n, 4);
  assert.equal(productOf(c, 9), undefined);
  assert.equal(storeOfScene("scenes/alis-market-shelf-03a/x.mp4"), "alis-market");
  assert.equal(storeOfScene("scenes/mobilephobevidotest/WhatsApp.mp4"), "mobilephobevidotest");
});

test("a stored catalogue is checked on the way in", () => {
  const { catalogue, problems } = checkCatalogue({
    store: "alis-market",
    products: [
      { n: 1, en: "Tea", unit: "pack", priceCents: 499, by: "hand" },
      { n: 1, en: "Twice", unit: "pack", priceCents: 1 },
      { n: 2, unit: "kg", priceCents: 1 },
      { n: 3, en: "Rice", unit: "kg", priceCents: 1.5 },
    ],
  });
  assert.deepEqual(catalogue?.products, [{ n: 1, en: "Tea", unit: "pack", priceCents: 499, by: "hand" }]);
  assert.equal(problems.length, 3);
  assert.equal(checkCatalogue({ store: "Bad Store!", products: [] }).catalogue, null);
});

test("a store's aisles are its shelf videos, in shelf order", () => {
  const keys = [
    "scenes/alis-market-shelf-10/v.mp4", "scenes/alis-market-shelf-03b/v.mp4", "scenes/alis-market-shelf-2/v.mp4",
    "scenes/alis-market-shelf-03a/v.mp4", "scenes/alis-market-shelf-03a/v-phone.mp4", "scenes/alis-market-shelf-2/notes.json",
    "scenes/other-store-shelf-1/v.mp4", "scenes/alis-market/entrance.mp4",
  ];
  assert.deepEqual(aislesOf(keys, "alis-market").map((a) => a.shelf), ["2", "03a", "03b", "10"]);
});
