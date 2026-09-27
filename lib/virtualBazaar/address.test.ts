// The virtual address: every shop has exactly one unit, the link and the
// words agree, a renamed shop keeps its links, and nonsense is a 404.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOPS, STREETS, addressPath, addressText, parseAddress, shopById, shopByUnit, streetAddressPath, unitOf,
} from "./layout.ts";

const food = STREETS.find((s) => s.id === "food")!;

test("units: one per shop, 1…12, odd on the left walking in", () => {
  const units = SHOPS.filter((s) => s.street === "food").map(unitOf).sort((a, b) => a - b);
  assert.deepEqual(units, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const s of SHOPS) assert.equal(unitOf(s) % 2 === 1, s.side === "north", s.id);
});

test("Sarekooche's two shops have the addresses we print", () => {
  assert.equal(addressPath(shopById("sarekooche")!), "/vb/khoraki/5-sarekooche");
  assert.equal(addressPath(shopById("butcher")!), "/vb/khoraki/4-butcher");
  assert.equal(addressText(shopById("sarekooche")!), "بازار سرکوچه · راسته خوراکی · حجرهٔ ۵ · سرکوچه");
});

test("a link lands in front of its shop, by number, whatever the name says", () => {
  for (const shop of SHOPS) {
    const segs = addressPath(shop).split("/").slice(2);
    assert.deepEqual(parseAddress(segs), { kind: "shop", shop });
  }
  assert.equal((parseAddress(["khoraki", "5"]) as { shop: { id: string } }).shop.id, "sarekooche");
  assert.equal((parseAddress(["khoraki", "5-an-old-name"]) as { shop: { id: string } }).shop.id, "sarekooche");
  assert.equal((parseAddress(["KHORAKI", "5"]) as { shop: { id: string } }).shop.id, "sarekooche");
});

test("the square, a street, and what is not an address", () => {
  assert.equal(parseAddress([]), null);
  assert.deepEqual(parseAddress(["khoraki"]), { kind: "street", street: food });
  assert.equal(streetAddressPath(food), "/vb/khoraki");
  assert.equal(parseAddress(["nowhere"]), undefined);
  assert.equal(parseAddress(["khoraki", "99"]), undefined);
  assert.equal(parseAddress(["khoraki", "sarekooche"]), undefined, "a name is not a number");
  assert.equal(parseAddress(["khoraki", "5", "x"]), undefined);
  assert.equal(shopByUnit(food, 0), undefined);
  assert.equal(streetAddressPath(STREETS.find((s) => s.id === "gold")!), undefined, "closed streets have none");
});
