import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignIds, buildMap, closeLoops, fitSegment, integratePath, mapOrder, oneBookcase, orderShelvesByMap, placeProducts, poseAt,
  ringMatch, triangulate, rayOf, rayMeetsShelf, ASSUMED_DIST, type Loop, type MapShelf, type Observation, type Pose,
} from "./storeMap";
import type { Motion } from "./route";
import type { Shelf } from "./levels";

const DT = 0.2;
/** A walk at `v` m/s straight along x for `s` seconds (the camera facing +x). */
function straight(v: number, s: number, turn = 0): Motion {
  const n = Math.round(s / DT);
  return { dt: DT, fwd: Array(n).fill(v), side: Array(n).fill(0), turn: Array(n).fill(turn), sure: Array(n).fill(0.9) };
}
/** What the camera at pose `p` sees of a product at (x, y): its longitude. */
const lonOf = (p: Pose, x: number, y: number) => Math.atan2(y - p.y, x - p.x) - p.th;
/** Observations of a product at (x, y) every `every` s between `from` and `to`. */
function seenFrom(path: Pose[], n: number, x: number, y: number, from: number, to: number, every = 0.4): Observation[] {
  const out: Observation[] = [];
  for (let t = from; t <= to + 1e-9; t += every) { const p = poseAt(path, t)!; out.push({ n, t, lon: lonOf(p, x, y) }); }
  return out;
}

test("the path: walking straight ahead at 0.5 m/s for 20 s ends 10 m along x", () => {
  const path = integratePath(straight(0.5, 20));
  const end = path[path.length - 1];
  assert.ok(Math.abs(end.x - 10) < 0.05 && Math.abs(end.y) < 1e-9, `${end.x},${end.y}`);
  assert.equal(end.t, 20);
});

test("the path: turning right while walking bends towards +y (the same conventions as blocksOf)", () => {
  const path = integratePath(straight(0.5, 10, 0.1));
  const end = path[path.length - 1];
  assert.ok(end.y > 1 && Math.abs(end.th - 1) < 0.02, `${end.y} ${end.th}`);
});

test("poseAt interpolates between readings and clamps at the ends", () => {
  const path = integratePath(straight(1, 2));
  assert.ok(Math.abs(poseAt(path, 1.1)!.x - 1.1) < 0.05);
  assert.equal(poseAt(path, -3)!.t, 0);
  assert.equal(poseAt(path, 99)!.t, 2);
  assert.equal(poseAt([], 1), null);
});

test("triangulation: a product 1.5 m to the side of a straight walk lands within 2 cm", () => {
  const path = integratePath(straight(0.5, 20));
  const placed = placeProducts(seenFrom(path, 7, 4, 1.5, 4, 12), path);
  const p = placed.get(7)!;
  assert.equal(p.method, "triangulated");
  assert.ok(Math.hypot(p.x - 4, p.y - 1.5) < 0.02, `${p.x},${p.y}`);
  assert.ok(p.conf > 0.5);
});

test("triangulation refuses parallel rays and a product seen from one spot is estimated, said so", () => {
  const path = integratePath(straight(0.5, 20));
  const r = [rayOf(poseAt(path, 2)!, 0), rayOf(poseAt(path, 6)!, 0)];
  assert.equal(triangulate(r), null);
  const one = placeProducts([{ n: 3, t: 5, lon: Math.PI / 2 }], path).get(3)!;
  assert.equal(one.method, "estimated");
  assert.ok(Math.abs(one.y - ASSUMED_DIST) < 1e-6 && Math.abs(one.x - 2.5) < 0.05);
  // Standing still: no baseline, so estimated too (never a false "triangulated").
  const still = integratePath(straight(0, 10, 0));
  assert.equal(placeProducts(seenFrom(still, 4, 1, 1, 0, 9), still).get(4)!.method, "estimated");
});

test("triangulation tolerates noise in the measured directions (±0.5°)", () => {
  const path = integratePath(straight(0.5, 20));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const obs = seenFrom(path, 1, 5, -1.2, 5, 15).map((o) => ({ ...o, lon: o.lon + rnd() * 0.0175 }));
  const p = placeProducts(obs, path).get(1)!;
  assert.equal(p.method, "triangulated");
  assert.ok(Math.hypot(p.x - 5, p.y + 1.2) < 0.12, `${p.x},${p.y}`);
});

test("a repeated visit pulls the drifted end of a loop back onto its start", () => {
  // Out 5 m, back 5 m (turned round), with the forward reading 10% too strong on the way back: ends 0.5 m off.
  const out = straight(0.5, 10), back = straight(0.55, 10);
  const turnS = Math.round(Math.PI / (1 * DT)) * DT;
  const turnN = Math.round(turnS / DT);
  const m: Motion = {
    dt: DT,
    fwd: [...out.fwd, ...Array(turnN).fill(0), ...back.fwd],
    side: [...out.side, ...Array(turnN).fill(0), ...back.side],
    turn: [...out.turn, ...Array(turnN).fill(Math.PI / turnS), ...back.turn],
    sure: [...out.sure, ...Array(turnN).fill(0.9), ...back.sure],
  };
  const path = integratePath(m);
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x, end.y) > 0.3, "drifted as set up");
  const loop: Loop = { a: 0, b: end.t, score: 0.95, shift: 0 };
  const { path: fixed, used } = closeLoops(path, [loop]);
  assert.equal(used.length, 1);
  const e2 = fixed[fixed.length - 1];
  assert.ok(Math.hypot(e2.x, e2.y) < 0.01, `${e2.x},${e2.y}`);
  // A weak match, or two moments too close in time, changes nothing.
  assert.equal(closeLoops(path, [{ ...loop, score: 0.5 }]).used.length, 0);
  assert.equal(closeLoops(path, [{ ...loop, a: end.t - 3 }]).used.length, 0);
});

test("a shelf segment: its direction from the points, its length their spread", () => {
  const pts = [0, 0.5, 1, 1.5, 2].map((x) => ({ x, y: 1 }));
  const s = fitSegment(pts, Math.PI / 2);
  assert.ok(Math.abs(s.dir) < 1e-9 || Math.abs(s.dir - Math.PI) < 1e-9);
  assert.ok(Math.abs(s.center.x - 1) < 1e-9 && Math.abs(s.length - 2.2) < 1e-9);
  // Two points: across the camera's view (looking along +y, the shelf runs along x).
  assert.ok(Math.abs(fitSegment([{ x: 0, y: 1 }, { x: 0.1, y: 1 }], Math.PI / 2).dir) < 1e-9);
});

test("one bookcase in two pictures is merged; two sides of an aisle are not", () => {
  const a = { center: { x: 1, y: 1 }, dir: 0, length: 2, normal: -Math.PI / 2 };
  assert.ok(oneBookcase(a, { center: { x: 3.1, y: 1.05 }, dir: 0.05, length: 2, normal: -Math.PI / 2 }));
  assert.ok(!oneBookcase(a, { center: { x: 1, y: -1 }, dir: 0, length: 2, normal: Math.PI / 2 }), "facing each other");
  assert.ok(!oneBookcase(a, { center: { x: 1, y: 1.8 }, dir: 0, length: 2, normal: -Math.PI / 2 }), "a row behind");
  assert.ok(!oneBookcase(a, { center: { x: 5, y: 1 }, dir: 0, length: 2, normal: -Math.PI / 2 }), "far along");
});

test("persistent ids: by products first, then by place; new ones numbered after the old", () => {
  const prev: MapShelf[] = [
    { id: "S1", t: 0, center: { x: 0, y: 1 }, dir: 0, length: 2, face: { x: 0, y: 0.1 }, normal: -Math.PI / 2, products: [1, 2, 3, 4], levels: 3, placed: 4, conf: 1 },
    { id: "S4", t: 9, center: { x: 5, y: 1 }, dir: 0, length: 2, face: { x: 5, y: 0.1 }, normal: -Math.PI / 2, products: [9, 10], levels: 2, placed: 2, conf: 1 },
  ];
  const now = assignIds([
    { products: [2, 3, 4, 20], center: { x: 0.2, y: 1 }, dir: 0, length: 2, normal: -Math.PI / 2 },
    { products: [30, 31], center: { x: 5.1, y: 1.02 }, dir: 0, length: 2, normal: -Math.PI / 2 },
    { products: [40], center: { x: 12, y: 1 }, dir: 0, length: 1, normal: -Math.PI / 2 },
  ], prev);
  assert.deepEqual(now.map((s) => s.id), ["S1", "S4", "S5"]);
});

test("the tour's order follows the floor from the entrance, not the order filmed", () => {
  const shelves = [{ id: "A", face: { x: 8, y: 0 } }, { id: "B", face: { x: 1, y: 0 } }, { id: "C", face: { x: 4, y: 0 } }, { id: "D", face: { x: 4.2, y: 2 } }];
  assert.deepEqual(mapOrder(shelves, { x: 0, y: 0 }), ["B", "C", "D", "A"]);
  assert.deepEqual(mapOrder([], { x: 0, y: 0 }), []);
});

const box = (n: number, t: number, lon: number, lat: number) => ({ n, t, lon, lat, size: { w: 0.05, h: 0.2 } });
const shelfOf = (t: number, ps: ReturnType<typeof box>[]): Shelf => ({ t, frame: { lon: ps[0].lon, lat: 0, w: 0.5, h: 0.5 }, levels: [{ frame: { lon: 0, lat: 0, w: 1, h: 1 }, products: ps }] });

test("the whole map: an aisle walked once, a shelf each side, one bookcase seen in two pictures merged", () => {
  const path = integratePath(straight(0.5, 24));
  const left = [1, 2, 3, 4, 5, 6].map((n) => ({ n, x: 1 + n * 0.5, y: -1.2 }));   // the left side (−y), x 1.5…4
  const right = [11, 12, 13, 14, 15, 16].map((n) => ({ n, x: 5 + (n - 10) * 0.5, y: 1.3 })); // the right side, x 5.5…8
  const obs: Observation[] = [];
  for (const p of left) obs.push(...seenFrom(path, p.n, p.x, p.y, Math.max(0, (p.x - 2) / 0.5), Math.min(24, (p.x + 2) / 0.5)));
  for (const p of right) obs.push(...seenFrom(path, p.n, p.x, p.y, Math.max(0, (p.x - 2) / 0.5), Math.min(24, (p.x + 2) / 0.5)));
  // The left bookcase was boxed in two pictures (half each); the right one in one.
  const pic = (t: number, ps: typeof left) => shelfOf(t, ps.map((p) => box(p.n, t, lonOf(poseAt(path, t)!, p.x, p.y), 0)));
  const shelves = [pic(4, left.slice(0, 3)), pic(6, left.slice(3)), pic(13, right)];
  const map = buildMap({ store: "t", made: "x", path, loops: [], observations: obs, shelves, entry: 0, prev: null, unnamed: [99] });
  assert.equal(map.shelves.length, 2, JSON.stringify(map.shelves.map((s) => [s.id, s.center, s.dir, s.normal])));
  assert.equal(map.quality.merged, 1);
  assert.equal(map.quality.triangulated, 12);
  const L = map.shelves.find((s) => s.products.includes(1))!, R = map.shelves.find((s) => s.products.includes(11))!;
  assert.ok(Math.abs(L.center.y + 1.2) < 0.05 && Math.abs(R.center.y - 1.3) < 0.05);
  // Each faces the aisle (the camera at y = 0).
  assert.ok(Math.sin(L.normal) > 0.9 && Math.sin(R.normal) < -0.9);
  assert.deepEqual(map.order, [L.id, R.id]);
  assert.ok(map.review.some((r) => r.kind === "product" && r.id === "99"));
  // Run again with the first map as `prev`: the same ids.
  const again = buildMap({ store: "t", made: "y", path, loops: [], observations: obs, shelves: [...shelves].reverse(), entry: 0, prev: map, unnamed: [] });
  assert.deepEqual(again.shelves.map((s) => s.id).sort(), map.shelves.map((s) => s.id).sort());
  assert.equal(again.shelves.find((s) => s.products.includes(1))!.id, L.id);
});

test("orderShelvesByMap puts the finder's shelves in the map's order; unknown ones after, in walking order", () => {
  const sh = (t: number, ns: number[]) => ({ t, levels: [{ products: ns.map((n) => box(n, t, 0, 0)) }] });
  const shelves = [sh(1, [1, 2]), sh(2, [5, 6]), sh(3, [9]), sh(4, [3])];
  const map = { order: ["S2", "S1"], shelves: [{ id: "S1", products: [1, 2, 3] }, { id: "S2", products: [5, 6] }] as unknown as MapShelf[] };
  assert.deepEqual(orderShelvesByMap(shelves, map).map((s) => s.t), [2, 1, 4, 3]);
  assert.deepEqual(orderShelvesByMap(shelves, null).map((s) => s.t), [1, 2, 3, 4]);
});

test("ringMatch finds the same panorama turned round, and tells a different place apart", () => {
  const w = 64, h = 32;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) % 256;
  const a = new Uint8Array(w * h).map(() => rnd());
  const turned = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) turned[y * w + x] = a[y * w + ((x + 16) % w)];
  const m = ringMatch(turned, a, w, h, 4);
  assert.ok(m.score > 0.99 && m.shift === 16, JSON.stringify(m));
  const other = new Uint8Array(w * h).map(() => rnd());
  assert.ok(ringMatch(other, a, w, h, 4).score < 0.5);
});

test("a one-view product on a well-placed shelf lands where its ray meets the shelf, not at a guessed distance", () => {
  const path = integratePath(straight(0.5, 24));
  // A shelf along y = −2 (x 2…5), fixed by 6 products seen as the camera walked; product 50 at x 3.2 seen once.
  const shelf = [1, 2, 3, 4, 5, 6].map((n) => ({ n, x: 2 + (n - 1) * 0.6, y: -2 }));
  const obs: Observation[] = shelf.flatMap((p) => seenFrom(path, p.n, p.x, p.y, Math.max(0, (p.x - 2.5) / 0.5), (p.x + 2.5) / 0.5));
  const t1 = 6, cam = poseAt(path, t1)!;
  obs.push({ n: 50, t: t1, lon: lonOf(cam, 3.2, -2) });
  const ps = [...shelf, { n: 50, x: 3.2, y: -2 }];
  const pic = shelfOf(t1, ps.map((p) => box(p.n, t1, lonOf(cam, p.x, p.y), 0)));
  const map = buildMap({ store: "t", made: "x", path, loops: [], observations: obs, shelves: [pic], entry: 0, prev: null, unnamed: [] });
  const p = map.products.find((q) => q.n === 50)!;
  assert.equal(p.method, "on-shelf");
  assert.ok(Math.hypot(p.x - 3.2, p.y + 2) < 0.08, `${p.x},${p.y}`);
  assert.equal(map.quality.onShelf, 1);
  assert.ok(!("ray" in p));
  // A ray along the shelf, or meeting it behind the camera, does not count.
  assert.equal(rayMeetsShelf({ t: 0, x: 0, y: -2, dx: 1, dy: 0 }, { center: { x: 3.5, y: -2 }, dir: 0, length: 3 }), null);
  assert.equal(rayMeetsShelf({ t: 0, x: 3, y: 0, dx: 0, dy: 1 }, { center: { x: 3.5, y: -2 }, dir: 0, length: 3 }), null);
});
