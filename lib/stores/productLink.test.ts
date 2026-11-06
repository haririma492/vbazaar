import { test } from "node:test";
import assert from "node:assert/strict";
import { productLink, productParam, walkLink } from "./productLink.ts";

test("a product link opens the walk at that product", () => {
  assert.equal(productLink("scenes/store-saraye-bamdad/walk-1.mp4", 42), "https://vbazaar.app/vca/walk?v=scenes%2Fstore-saraye-bamdad%2Fwalk-1.mp4&p=42");
  assert.equal(walkLink("scenes/store-x/w.mp4"), "https://vbazaar.app/vca/walk?v=scenes%2Fstore-x%2Fw.mp4");
});

test("only a plain product number is read", () => {
  assert.equal(productParam("42"), 42);
  assert.equal(productParam("0"), null);
  assert.equal(productParam("4a"), null);
  assert.equal(productParam(null), null);
});
