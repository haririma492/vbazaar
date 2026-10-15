import { test } from "node:test";
import assert from "node:assert/strict";
import { basketAddHref, offerItemId, sarekoocheHref } from "./sarekooche.ts";

test("Sarekooche pages are absolute links to sarekooche.com", () => {
  assert.equal(sarekoocheHref("/?open=meat-order"), "https://sarekooche.com/?open=meat-order");
  assert.equal(sarekoocheHref("basket"), "https://sarekooche.com/basket");
});

test("a walk's line goes to the basket as base64url JSON, its href made absolute", () => {
  const line = { id: offerItemId("walk-alis-market-shelf-1-n12"), kind: "offer" as const, label: "زعفران", price: "$12.99", href: "/vca/walk?v=x" };
  assert.equal(line.id, "offer:walk-alis-market-shelf-1-n12");
  const url = new URL(basketAddHref(line, "https://olgoo.com/"));
  assert.equal(url.origin + url.pathname, "https://sarekooche.com/basket");
  const sent = JSON.parse(Buffer.from(url.searchParams.get("add")!, "base64url").toString("utf8"));
  assert.deepEqual(sent, { ...line, href: "https://olgoo.com/vca/walk?v=x" });
});
