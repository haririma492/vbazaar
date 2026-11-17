import { test } from "node:test";
import assert from "node:assert/strict";
import { productLink, productParam, walkLink } from "./productLink.ts";

test("a product link opens the walk at that product", () => {
  assert.equal(productLink("scenes/store-saraye-bamdad/walk-1.mp4", 42), "https://vbazaar.app/vca/walk?v=scenes%2Fstore-saraye-bamdad%2Fwalk-1.mp4&p=42");
  assert.equal(walkLink("scenes/store-x/w.mp4"), "https://vbazaar.app/vca/walk?v=scenes%2Fstore-x%2Fw.mp4");
  // A published store: its short address.
  assert.equal(walkLink("scenes/store-x/w.mp4", undefined, "x"), "https://vbazaar.app/x");
  assert.equal(productLink("scenes/store-x/w.mp4", 42, undefined, "x"), "https://vbazaar.app/x?p=42");
});

test("only a plain product number is read", () => {
  assert.equal(productParam("42"), 42);
  assert.equal(productParam("0"), null);
  assert.equal(productParam("4a"), null);
  assert.equal(productParam(null), null);
});

test("a store's tour address is /<store>/vtour1.mp4, with or without .mp4; the older /walk/<store> still counts", async () => {
  const { TOUR_PATH_RE, isShortWalkPath } = await import("./productLink.ts");
  assert.equal(TOUR_PATH_RE.exec("/nuttime/vtour1.mp4")?.[1], "nuttime");
  assert.equal(TOUR_PATH_RE.exec("/nuttime/vtour1")?.[1], "nuttime");
  assert.equal(TOUR_PATH_RE.exec("/nuttime/vtour2.mp4"), null);
  assert.equal(TOUR_PATH_RE.exec("/vca/walk"), null);
  assert.equal(isShortWalkPath("/walk/nuttime"), true);
  assert.equal(isShortWalkPath("/vca/walk"), false);
});

test("each store's own page is vbazaar.app/<store>; the site's own pages are never read as a store", async () => {
  const { isShortWalkPath, RESERVED_SLUGS } = await import("./productLink.ts");
  assert.equal(isShortWalkPath("/nuttime"), true);
  assert.equal(isShortWalkPath("/demo"), false);
  assert.equal(isShortWalkPath("/stores"), false);
  assert.equal(isShortWalkPath("/"), false);
  assert.ok(RESERVED_SLUGS.has("walk") && RESERVED_SLUGS.has("basket"));
});
