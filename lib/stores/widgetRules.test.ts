import { test } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_FOV, addHit, emptyStats, ownerSeesWidget, planWidget, previewAim, siteOf, snippet, widgetSettings } from "./widgetRules";

const facts = { live: true, walk: "scenes/store-shirazgallery/walk-1.mp4", tourVideo: "/api/media/scenes/store-shirazgallery/tour.mp4", photos: ["https://media.x/a.jpg", "https://media.x/b.jpg"], door: "https://media.x/door.jpg" };

test("the snippet: one line that names the store and calls our script", () => {
  assert.equal(snippet("shirazgallery"), '<script async src="https://vbazaar.app/widget.js" data-vbazaar-store="shirazgallery"></script>');
});

test("a published store: the Shelf Tour's loop, and the key opens its Free Tour on vbazaar.app", () => {
  const p = planWidget("shirazgallery", facts);
  assert.deepEqual(p.preview, { kind: "video", src: facts.tourVideo });
  assert.equal(p.go, "/walk/shirazgallery");
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
    const p = planWidget("shirazgallery", f);
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

test("the Free Tour's preview with its music comes first, when it is made", () => {
  const p = planWidget("x", { ...facts, freeTour: { src: "/api/media/scenes/store-x/widget-preview-1.mp4", sound: true } });
  assert.deepEqual(p.preview, { kind: "video", src: "/api/media/scenes/store-x/widget-preview-1.mp4", sound: true });
});

const D = Math.PI / 180;
test("the preview looks away from the camera operator, and the operator never enters it", () => {
  // The operator straight ahead (yaw 0): the preview turns round to face behind them.
  const a = previewAim(() => ({ yaw: 0, width: 60 * D }));
  assert.ok(Math.abs(Math.abs(a.yaw) - Math.PI) < 1e-6);
  assert.equal(a.hfov, PREVIEW_FOV);
  assert.equal(a.seconds, 20);
  // The operator drifting 40° over the clip: aimed at the middle of the opposite, still clear.
  const b = previewAim((t) => ({ yaw: (t / 20) * 40 * D, width: 50 * D }));
  assert.ok(Math.abs(Math.abs(b.yaw) - 160 * D) < 0.01);
  // A walk that turns all the way round in 20 s: narrowed, then cut where the operator would come in.
  const c = previewAim((t) => ({ yaw: (t / 20) * 360 * D, width: 50 * D }));
  assert.ok(c.seconds < 20);
  // No lock: straight ahead, as before.
  assert.deepEqual(previewAim(null), { yaw: 0, hfov: PREVIEW_FOV, seconds: 20 });
});

test("the widget's settings are ours: defaults for a store that set none, anything odd made safe", () => {
  assert.deepEqual(widgetSettings(undefined), { on: true, place: "float", corner: "br", width: 480, lang: "fa" });
  assert.deepEqual(widgetSettings({ on: false, place: "here", corner: "tl", width: 360, lang: "en" }), { on: false, place: "here", corner: "tl", width: 360, lang: "en" });
  assert.deepEqual(widgetSettings({ place: "moon", corner: "x", width: "abc", lang: "de" }), { on: true, place: "float", corner: "br", width: 480, lang: "fa" });
  assert.equal(widgetSettings({ place: "top" }).place, "top");
  assert.equal(widgetSettings({ width: 50 }).width, 240);
  assert.equal(widgetSettings({ width: 99999 }).width, 1200);
});
