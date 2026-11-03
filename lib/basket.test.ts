// The Virtual Bazaar's own basket (`basket.ts`).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { addLine, byStore, cleanLine, countOf, parseBasket, priceCents, setQty } from "./basket.ts";

const now = new Date("2026-11-03T12:00:00Z");
const tea = { id: "offer:walk-ali-n3", label: "Ahmad Tea", merchant: "Ali's Market", price: "$6.99" };
const nuts = { id: "offer:walk-ali-n7-1.5lb", label: "Pistachio · 1.5 lb", merchant: "Ali's Market", price: "$19.49" };
const ring = { id: "offer:walk-gold-r1", label: "Gold ring", merchant: "Gold House" };

test("adding the same product again adds to its line", () => {
  let b = addLine([], tea, 1, now);
  b = addLine(b, tea, 1, now);
  assert.equal(b.length, 1);
  assert.equal(b[0].qty, 2);
  assert.equal(countOf(addLine(b, nuts, 1, now)), 3);
});

test("a line can be changed, and 0 takes it out", () => {
  let b = addLine(addLine([], tea, 1, now), nuts, 1, now);
  b = setQty(b, tea.id, 5);
  assert.equal(b.find((l) => l.id === tea.id)!.qty, 5);
  assert.equal(setQty(b, tea.id, 0).length, 1);
});

test("the basket is listed by store, each with its total; unpriced lines are counted apart", () => {
  let b = addLine([], tea, 2, now);
  b = addLine(b, ring, 1, now);
  b = addLine(b, nuts, 1, now);
  const g = byStore(b);
  assert.deepEqual(g.map((x) => x.merchant), ["Ali's Market", "Gold House"]);
  assert.equal(g[0].cents, 2 * 699 + 1949);
  assert.equal(g[1].unpriced, 1);
});

test("prices are read the way the walk writes them", () => {
  assert.equal(priceCents("$12.99"), 1299);
  assert.equal(priceCents("1,234.5 $"), 123450);
  assert.equal(priceCents(""), null);
  assert.equal(priceCents("ask"), null);
});

test("what is stored is cleaned: no script links, no empty lines, the same id folded", () => {
  assert.equal(cleanLine({ id: "a", label: "x", href: "javascript:alert(1)" })!.href, undefined);
  assert.equal(cleanLine({ id: "a", label: "x", imageUrl: "//evil.example/x.png" })!.imageUrl, undefined);
  assert.equal(cleanLine({ id: "", label: "x" }), null);
  const b = parseBasket(JSON.stringify([{ ...tea }, { ...tea }, "junk", { label: "no id" }]));
  assert.equal(b.length, 1);
  assert.equal(b[0].qty, 2);
  assert.deepEqual(parseBasket("not json"), []);
  assert.deepEqual(parseBasket(JSON.stringify([tea, nuts, ring])).map((l) => l.id), [tea.id, nuts.id, ring.id], "stored order kept");
});
