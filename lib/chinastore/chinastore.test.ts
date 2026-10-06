// The china store's commerce rules: the catalogue joined to a scene, the
// label's fade, and the scripted walk's timing.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG, HOTSPOTS, SCENE_ID, formatPrice, priceNow, productsFor, type CatalogItem } from "./products.ts";
import { AD_REARM_M, FADE_M, adStep, damp, distance, distanceOpacity, labelState, viewOpacity } from "./proximity.ts";
import { CUES, DURATION, KEYS, progressAt } from "./storyboard.ts";

test("every hotspot in the demo scene joins a catalogue row, each with its own id", () => {
  const products = productsFor(SCENE_ID);
  assert.equal(products.length, HOTSPOTS.length);
  assert.equal(new Set(products.map((p) => p.id)).size, products.length);
  assert.equal(products.length, 15);
  for (const p of products) {
    assert.ok(p.modelUrl.endsWith(".glb"), p.id);
    assert.ok(p.labelDistance > p.selectionDistance, p.id);
  }
});

test("exactly one hero, and it is the teapot, and the hand can take it", () => {
  const heroes = productsFor(SCENE_ID).filter((p) => p.hero);
  assert.equal(heroes.length, 1);
  assert.equal(heroes[0].sku, "CT-1004");
  assert.ok(heroes[0].grasp);
});

test("a price change is a catalogue edit: same hotspot, new price", () => {
  const repriced: CatalogItem[] = CATALOG.map((c) => (c.sku === "CT-1004" ? { ...c, price: 79 } : c));
  const before = productsFor(SCENE_ID).find((p) => p.sku === "CT-1004")!;
  const after = productsFor(SCENE_ID, repriced).find((p) => p.sku === "CT-1004")!;
  assert.equal(before.price, 89);
  assert.equal(after.price, 79);
  assert.deepEqual(after.anchor, before.anchor);
});

test("a hotspot whose SKU left the catalogue is dropped; other scenes are not mixed in", () => {
  const catalog = CATALOG.filter((c) => c.sku !== "CT-1002");
  assert.equal(productsFor(SCENE_ID, catalog).length, HOTSPOTS.length - 1);
  const elsewhere = [...HOTSPOTS, { ...HOTSPOTS[0], sceneId: "another-store", id: "x" }];
  assert.equal(productsFor(SCENE_ID, CATALOG, elsewhere).length, HOTSPOTS.length);
});

test("price on the label", () => {
  assert.equal(formatPrice(89), "$89");
  assert.equal(formatPrice(129), "$129");
  assert.equal(formatPrice(89.5), "$89.50");
});

test("the teapot grasp quaternion turns the hand as documented", () => {
  const hero = HOTSPOTS.find((h) => h.hero)!;
  const [x, y, z, w] = hero.grasp!.quaternion;
  const rot = (v: [number, number, number]) => {
    // v' = q v q*
    const [vx, vy, vz] = v;
    const ix = w * vx + y * vz - z * vy;
    const iy = w * vy + z * vx - x * vz;
    const iz = w * vz + x * vy - y * vx;
    const iw = -x * vx - y * vy - z * vz;
    return [
      ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x,
    ].map((n) => Math.round(n * 1e6) / 1e6 + 0);
  };
  const fingers = rot([0, 1, 0]);
  const back = rot([0, 0, 1]);
  const pinky = rot([1, 0, 0]);
  assert.ok(fingers[2] < -0.7, "fingers point into the shelf");
  assert.ok(back[0] > 0.7, "back of the hand to the right");
  assert.ok(pinky[1] < -0.9, "little finger down — the hand is upright on the bar");
});

test("label fades: nothing beyond the band, full within labelDistance, smooth between", () => {
  assert.equal(distanceOpacity(4.5, 3), 0);
  assert.equal(distanceOpacity(3 + FADE_M, 3), 0);
  assert.equal(distanceOpacity(3, 3), 1);
  assert.equal(distanceOpacity(1, 3), 1);
  const mid = distanceOpacity(3.5, 3);
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  let last = 1;
  for (let d = 3; d <= 4; d += 0.05) {
    const o = distanceOpacity(d, 3);
    assert.ok(o <= last + 1e-12);
    last = o;
  }
});

test("a product behind or beside the shopper has no label, whatever the distance", () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  assert.equal(viewOpacity(eye, fwd, { x: 0, y: 1.6, z: -2 }), 1);
  assert.equal(viewOpacity(eye, fwd, { x: 0, y: 1.6, z: 2 }), 0);
  assert.equal(viewOpacity(eye, fwd, { x: 2, y: 1.6, z: 0 }), 0);
  const near = { anchor: { x: 0, y: 1.6, z: 1 }, labelDistance: 3, selectionDistance: 1.5 };
  assert.equal(labelState(eye, fwd, near).target, 0);
  assert.equal(labelState(eye, fwd, near).selectable, false);
});

test("selectable only close and in view", () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  const p = (z: number) => ({ anchor: { x: 0, y: 1.4, z }, labelDistance: 3, selectionDistance: 1.5 });
  assert.equal(labelState(eye, fwd, p(-1.2)).selectable, true);
  assert.equal(labelState(eye, fwd, p(-2.5)).selectable, false);
});

test("damping is frame-rate independent and never overshoots", () => {
  let a = 0;
  for (let i = 0; i < 60; i++) a = damp(a, 1, 7, 1 / 60);
  let b = 0;
  for (let i = 0; i < 120; i++) b = damp(b, 1, 7, 1 / 120);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.ok(a < 1 && a > 0.99);
});

test("the walk: starts at rest, hits every key on time, never walks back, ends at rest", () => {
  assert.equal(progressAt(-1), 0);
  assert.equal(progressAt(0), 0);
  KEYS.forEach((k, i) => assert.ok(Math.abs(progressAt(k.t) - i / (KEYS.length - 1)) < 1e-9, `key ${i}`));
  let last = 0;
  for (let t = 0; t <= DURATION; t += 0.01) {
    const u = progressAt(t);
    assert.ok(u >= last - 1e-12, `t=${t}`);
    last = u;
  }
  const eps = 0.01;
  assert.ok(progressAt(eps) < 0.001);
  assert.ok(1 - progressAt(DURATION - eps) < 0.001);
  assert.equal(progressAt(DURATION + 5), 1);
});

test("the storyboard's beats fall in the 15–25 second window, in order", () => {
  assert.ok(DURATION < CUES.select);
  assert.ok(CUES.select < CUES.addToBasket && CUES.addToBasket < CUES.end);
  assert.ok(CUES.end >= 15 && CUES.end <= 25);
});

test("the walk ends where the teapot can be taken", () => {
  const hero = productsFor(SCENE_ID).find((p) => p.hero)!;
  const last = KEYS[KEYS.length - 1];
  const eye = { x: last.eye[0], y: last.eye[1], z: last.eye[2] };
  const f = { x: last.look[0] - eye.x, y: last.look[1] - eye.y, z: last.look[2] - eye.z };
  const l = Math.hypot(f.x, f.y, f.z);
  const s = labelState(eye, { x: f.x / l, y: f.y / l, z: f.z / l }, hero);
  assert.equal(s.selectable, true);
  assert.equal(s.target, 1);
});

test("from the doorway no label shows; from the wall every shelf label does", () => {
  const products = productsFor(SCENE_ID);
  const at = (k: (typeof KEYS)[number]) => {
    const eye = { x: k.eye[0], y: k.eye[1], z: k.eye[2] };
    const f = { x: k.look[0] - eye.x, y: k.look[1] - eye.y, z: k.look[2] - eye.z };
    const l = Math.hypot(f.x, f.y, f.z);
    return (p: (typeof products)[number]) => labelState(eye, { x: f.x / l, y: f.y / l, z: f.z / l }, p).target;
  };
  const start = at(KEYS[0]);
  for (const p of products) assert.equal(start(p), 0, p.id);
  const wall = at(KEYS.find((k) => k.eye[2] < 0.5 && k.eye[2] > 0)!);
  for (const p of products.filter((p) => p.anchor.z < -2)) assert.ok(wall(p) > 0.9, p.id);
  // …and the plinth by the door, now beside and behind, has faded.
  for (const p of products.filter((p) => p.anchor.z > 1)) assert.ok(wall(p) < 0.05, p.id);
});

test("sale prices: the shopper pays the sale price; a 'sale' above the price is ignored", () => {
  assert.equal(priceNow({ price: 129, salePrice: 99 }), 99);
  assert.equal(priceNow({ price: 89 }), 89);
  assert.equal(priceNow({ price: 50, salePrice: 60 }), 50);
  const onSale = productsFor(SCENE_ID).filter((p) => p.salePrice !== undefined);
  assert.ok(onSale.length >= 3);
  for (const p of onSale) assert.ok(p.salePrice! < p.price, p.id);
});

test("the ad speaks once per pass, only in view, and re-arms after walking away", () => {
  let s = { fire: false, armed: true };
  s = adStep(s.armed, 3.0, 1, 2.6);
  assert.equal(s.fire, false);
  s = adStep(s.armed, 2.0, 0, 2.6); // close but behind
  assert.equal(s.fire, false);
  s = adStep(s.armed, 2.0, 1, 2.6);
  assert.equal(s.fire, true);
  s = adStep(s.armed, 1.5, 1, 2.6);
  assert.equal(s.fire, false);
  s = adStep(s.armed, 2.6 + AD_REARM_M - 0.1, 1, 2.6);
  assert.equal(s.armed, false);
  s = adStep(s.armed, 2.6 + AD_REARM_M + 0.1, 1, 2.6);
  assert.equal(s.armed, true);
  s = adStep(s.armed, 2.0, 1, 2.6);
  assert.equal(s.fire, true);
});

test("the scripted walk sets the sale post's ad off on the way in, before the wall", () => {
  const ad = productsFor(SCENE_ID).find((p) => p.ad && p.adDistance)!;
  assert.ok(ad, "an ad product exists");
  let armed = true;
  let firedAt = -1;
  const pos = (t: number) => {
    // Linear between keys is close enough to find the moment.
    const i = Math.max(0, KEYS.findIndex((k) => k.t >= t) - 1);
    const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    const lerp = (u: number[], v: number[]) => ({ x: u[0] + (v[0] - u[0]) * f, y: u[1] + (v[1] - u[1]) * f, z: u[2] + (v[2] - u[2]) * f });
    return { eye: lerp(a.eye, b.eye), look: lerp(a.look, b.look) };
  };
  for (let t = 0; t <= DURATION && firedAt < 0; t += 0.05) {
    const { eye, look } = pos(t);
    const f = { x: look.x - eye.x, y: look.y - eye.y, z: look.z - eye.z };
    const l = Math.hypot(f.x, f.y, f.z);
    const r = adStep(armed, distance(eye, ad.anchor), viewOpacity(eye, { x: f.x / l, y: f.y / l, z: f.z / l }, ad.anchor), ad.adDistance!);
    armed = r.armed;
    if (r.fire) firedAt = t;
  }
  assert.ok(firedAt > 3 && firedAt < 8, `fired at ${firedAt}`);
});
