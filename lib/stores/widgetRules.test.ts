import { test } from "node:test";
import assert from "node:assert/strict";
import { addHit, emptyStats, ownerSeesWidget, planWidget, siteOf, snippet } from "./widgetRules";

const facts = { live: true, walk: "scenes/store-shirazgalery/walk-1.mp4", tourVideo: "/api/media/scenes/store-shirazgalery/tour.mp4", photos: ["https://media.x/a.jpg", "https://media.x/b.jpg"], door: "https://media.x/door.jpg" };

test("the snippet: our frame, and a plain counted link for a site without scripts", () => {
  const s = snippet("shirazgalery");
  assert.ok(s.includes('data-vbazaar-store="shirazgalery"'));
  assert.ok(s.includes('href="https://vbazaar.app/w/shirazgalery/go"'));
  assert.ok(s.includes('src="https://vbazaar.app/widget.js"'));
});

test("a published store: the Shelf Tour's loop, and the key opens its Free Tour on vbazaar.app", () => {
  const p = planWidget("shirazgalery", facts);
  assert.deepEqual(p.preview, { kind: "video", src: facts.tourVideo });
  assert.equal(p.go, "/vca/walk?v=scenes%2Fstore-shirazgalery%2Fwalk-1.mp4");
  assert.equal(p.soon, false);
});

test("no Shelf Tour: the door, then the product photos; nothing: the name on a card", () => {
  const p = planWidget("x", { ...facts, tourVideo: null });
  assert.deepEqual(p.preview, { kind: "photos", srcs: ["https://media.x/door.jpg", "https://media.x/a.jpg", "https://media.x/b.jpg"] });
  assert.deepEqual(planWidget("x", { ...facts, tourVideo: null, photos: [], door: null }).preview, { kind: "card" });
  assert.equal(planWidget("x", { ...facts, walk: null }).go, "/vca/tour?s=x");
});

test("a store not published, or with nothing to visit: «Coming soon», and the key opens the bazaar's front door", () => {
  for (const f of [{ ...facts, live: false }, { ...facts, walk: null, tourVideo: null }]) {
    const p = planWidget("shirazgalery", f);
    assert.equal(p.soon, true);
    assert.equal(p.go, "/");
  }
});

test("counts by day and by site; the owner sees the card only when switched on", () => {
  let s = emptyStats();
  s = addHit(s, "view", new Date("2026-11-06T10:00Z"), siteOf("https://www.shirazgallery.ca/product/x"));
  s = addHit(s, "view", new Date("2026-11-06T11:00Z"), siteOf("shirazgallery.ca"));
  s = addHit(s, "click", new Date("2026-11-07T09:00Z"), "shirazgallery.ca");
  assert.equal(s.views, 2); assert.equal(s.clicks, 1);
  assert.deepEqual(s.days["2026-11-06"], { views: 2, clicks: 0 });
  assert.deepEqual(s.sites, { "shirazgallery.ca": 2 });
  assert.equal(s.firstAt, "2026-11-06T10:00:00.000Z");
  assert.equal(siteOf("not a url at all"), "");
  assert.equal(ownerSeesWidget({}), false);
  assert.equal(ownerSeesWidget({ widgetForOwner: true }), true);
});
