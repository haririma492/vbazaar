import { test } from "node:test";
import assert from "node:assert/strict";
import { labelFor, namedShelves, noteOf, setsOf, sigOf, stateOf, toStitch, zoomLabel, type ZoomRecord } from "./gigapanRules.ts";

test("a shelf is called what the operator called it on the walk, else by its place", () => {
  const named = namedShelves([
    { id: "gaaaa", n: 3, label: { en: "3 · Spices", fa: "۳ · ادویه" } },
    { id: "gbbbb", name: { en: "Tea" }, label: { en: "Tea" } },
    { id: "gcccc", label: { en: "Shelf 9" } }, // found by the finder, never named: its place decides
  ]);
  assert.deepEqual(labelFor("gaaaa", 0, named), { en: "3 · Spices", fa: "۳ · ادویه" });
  assert.deepEqual(labelFor("gbbbb", 1, named), { en: "Tea", fa: "Tea" });
  assert.deepEqual(labelFor("gcccc", 2, named), zoomLabel(2));
  assert.deepEqual(labelFor("gdddd", 0, namedShelves(undefined)), zoomLabel(0));
});
import { addUpload, checkUploadName, isUploadKeyOf, parseStore, uploadKey, type ZoomUpload } from "./store.ts";

const up = (set: string, name: string, at: string): ZoomUpload => ({ set, name, key: `stores/x/uploads/gigapan/${at}-${name}`, size: 9_000_000, at });
const files = [up("gaaaa", "top.jpg", "2026-11-11T10:00:00Z"), up("gbbbb", "b1.jpg", "2026-11-11T10:05:00Z"), up("gaaaa", "mid.jpg", "2026-11-11T10:01:00Z"), up("gaaaa", "bot.jpg", "2026-11-11T10:02:00Z")];

test("a shelf's photos stay together, shelves in the order they were begun", () => {
  const sets = setsOf(files);
  assert.deepEqual(sets.map((s) => [s.id, s.photos.map((p) => p.name)]), [["gaaaa", ["top.jpg", "mid.jpg", "bot.jpg"]], ["gbbbb", ["b1.jpg"]]]);
  assert.deepEqual(zoomLabel(0), { en: "Shelf 1", fa: "قفسه ۱" });
  assert.equal(zoomLabel(11).fa, "قفسه ۱۲");
});

test("a shelf is stitched once; again only when its photos change, or when asked after a failure", () => {
  const a = setsOf(files)[0];
  const record: ZoomRecord = { store: "x", updated: "", sets: [{ id: "gaaaa", label: zoomLabel(0), sig: sigOf(a.photos), state: "done", note: "", made: "" }] };
  assert.equal(stateOf(a.photos, record.sets[0]), "done");
  assert.deepEqual(toStitch(files, record).map((s) => s.id), ["gbbbb"], "only the shelf never stitched");
  assert.deepEqual(toStitch(files, null).map((s) => [s.id, s.index]), [["gaaaa", 0], ["gbbbb", 1]]);
  // A photo taken again (a new upload, so a new key): that shelf again.
  const again = files.map((f) => (f.name === "mid.jpg" ? up("gaaaa", "mid.jpg", "2026-11-11T11:00:00Z") : f));
  assert.equal(stateOf(setsOf(again)[0].photos, record.sets[0]), "changed");
  assert.deepEqual(toStitch(again, record).map((s) => s.id), ["gaaaa", "gbbbb"]);
  // Photos that did not join are not tried again every run: the same photos fail the same way.
  const failed: ZoomRecord = { ...record, sets: [{ ...record.sets[0], state: "failed" }] };
  assert.deepEqual(toStitch(files, failed).map((s) => s.id), ["gbbbb"]);
  assert.deepEqual(toStitch(files, failed, true).map((s) => s.id), ["gaaaa", "gbbbb"]);
});

test("the upload: photos only, kept under the store, recorded with their shelf", () => {
  assert.equal(checkUploadName("gigapan", "IMG_0412.JPG"), null);
  assert.match(checkUploadName("gigapan", "shelf.heic") ?? "", /jpg/);
  const key = uploadKey("x", "gigapan", "IMG 0412.JPG", new Date("2026-11-11T10:00:00Z"));
  assert.ok(isUploadKeyOf("x", key), key);
  const s0 = parseStore({ slug: "x", passwordHash: "h", name: { en: "X", fa: "" }, files: { photos: [] }, steps: {}, out: {}, thread: [] })!;
  let s = addUpload(s0, "gigapan", { key, name: "a.jpg", size: 1, at: "t1" }, "gaaaa");
  s = addUpload(s, "gigapan", { key: key + "2", name: "b.jpg", size: 1, at: "t2" }, "gaaaa");
  s = addUpload(s, "gigapan", { key: key + "3", name: "a.jpg", size: 1, at: "t3" }, "gaaaa"); // taken again: replaces
  s = addUpload(s, "gigapan", { key: key + "4", name: "a.jpg", size: 1, at: "t4" }, "gbbbb"); // another shelf's a.jpg
  assert.deepEqual(s.files.gigapan?.map((f) => [f.set, f.name, f.at]), [["gaaaa", "b.jpg", "t2"], ["gaaaa", "a.jpg", "t3"], ["gbbbb", "a.jpg", "t4"]]);
  assert.equal(addUpload(s, "gigapan", { key, name: "c.jpg", size: 1, at: "t5" }, "../x").files.gigapan?.length, 3, "no shelf named: not recorded");
  // No crew step goes back to do: the stitching is «Refresh all agents»'.
  assert.deepEqual(s.steps, s0.steps);
});

test("what the stitcher did is said in a sentence", () => {
  assert.equal(noteOf({ w: 5604, h: 17842, mp: 100, tiles: 545, order: ["a.jpg", "b.jpg", "c.jpg"], seconds: 18 }), "5604×17842 px (100 megapixels) in 545 tiles, 18 s; top to bottom: a.jpg → b.jpg → c.jpg.");
});

// ── The 🔍 on the walk (`WalkZoom` in lib/splats/walks.ts) ──
import { dropZoom, parseWalks, setZoom, zoomsAt, type Walk, type WalkZoom } from "../splats/walks.ts";
import { remapWalk } from "../splats/cut.ts";

const KEY = "scenes/store-x/walk-1.mp4";
const zoom = (id: string, t0: number): WalkZoom => ({
  id, label: { en: "Shelf 1", fa: "قفسه ۱" }, manifest: `https://cdn.x/scenes/store-x/zoom/${id}-1/manifest.json`,
  pins: [{ t: t0, x: 0.5, y: 0.1 }, { t: t0 + 2, x: 0.7, y: 0.1 }, { t: t0 + 4, x: 0.9, y: 0.12 }],
});

test("a shelf's 🔍 follows the shelf, shows only while the shelf is in the walk, and survives a save", () => {
  const walk: Walk = { doors: [], zooms: [zoom("gaaaa", 10)] };
  const [at] = zoomsAt(walk, 12, true);
  assert.equal(at.item.zoom.id, "gaaaa");
  assert.ok(Math.abs(at.x - 0.7) < 0.05 && Math.abs(at.y - 0.1) < 0.02, `${at.x}, ${at.y}`);
  assert.equal(zoomsAt(walk, 40, true).length, 0, "not where the shelf is not");
  const kept = parseWalks({ walks: { [KEY]: walk } }).walks[KEY].zooms;
  assert.equal(kept?.length, 1);
  assert.equal(kept?.[0].manifest, walk.zooms![0].manifest);
  // Only an https manifest is kept.
  assert.equal(parseWalks({ walks: { [KEY]: { doors: [], zooms: [{ ...zoom("gaaaa", 10), manifest: "javascript:x" }] } } }).walks[KEY].zooms, undefined);
});

test("pinning again replaces the place; taking it off leaves the walk without the field", () => {
  let w = setZoom({ walks: { [KEY]: { doors: [] } } }, KEY, zoom("gaaaa", 10));
  w = setZoom(w, KEY, zoom("gbbbb", 30));
  w = setZoom(w, KEY, zoom("gaaaa", 50));
  assert.deepEqual(w.walks[KEY].zooms?.map((z) => [z.id, z.pins[0].t]), [["gbbbb", 30], ["gaaaa", 50]]);
  w = dropZoom(dropZoom(w, KEY, "gaaaa"), KEY, "gbbbb");
  assert.equal("zooms" in w.walks[KEY], false);
});

test("a cut moves the 🔍 with the picture, and says when its shelf was cut out", () => {
  const { walk, dropped } = remapWalk({ doors: [], zooms: [zoom("gaaaa", 5), zoom("gbbbb", 25)] }, [{ from: 20, to: 40 }]);
  assert.deepEqual(walk.zooms?.map((z) => [z.id, z.pins[0].t]), [["gbbbb", 5]]);
  assert.ok(dropped.some((d) => /zoom photo/.test(d)));
});

// ── The shelf's green border (`WalkZoom.outline`, found by scripts/stitch/locate.py) ──
import { outlineAt, quadBox } from "../splats/walks.ts";
import { thin, toLocate, type ZoomSet } from "./gigapanRules.ts";

const bordered = (): WalkZoom => ({
  ...zoom("gaaaa", 10), auto: true,
  outline: [
    { t: 10, c: [0.4, 0.3, 0.8, 0.3, 0.8, -0.1, 0.4, -0.1] },
    { t: 11, c: [0.5, 0.3, 0.9, 0.3, 0.9, -0.1, 0.5, -0.1] },
    { t: 20, c: [3.0, 0.3, -3.0, 0.3, -3.0, -0.1, 3.0, -0.1] }, // a second visit, across the back of the panorama
  ],
});

test("a bordered shelf: the border moves with the shelf, the whole of it is the key, and nothing is drawn between two visits", () => {
  const z = bordered();
  const mid = outlineAt(z, 10.5, true)!;
  assert.ok(Math.abs(mid[0] - 0.45) < 1e-9 && Math.abs(mid[2] - 0.85) < 1e-9, String(mid));
  assert.equal(outlineAt(z, 15, true), null, "between two visits");
  assert.equal(outlineAt(z, 30, true), null);
  const [shown] = zoomsAt({ doors: [], zooms: [z] }, 10.5, true);
  assert.ok(shown.quad);
  assert.ok(Math.abs(shown.x - 0.65) < 1e-9 && Math.abs(shown.y - 0.1) < 1e-9, `${shown.x}, ${shown.y}`);
  assert.ok(Math.abs(shown.item.size!.w - 0.4) < 1e-9 && Math.abs(shown.item.size!.h - 0.4) < 1e-9);
  assert.equal(zoomsAt({ doors: [], zooms: [z] }, 15, true).length, 0, "its pins alone do not show it there");
  // Across the back of the panorama the box is 0.28 wide round ±π, not 6 wide round 0.
  const b = quadBox(z.outline![2].c, true);
  assert.ok(Math.abs(b.w - (2 * Math.PI - 6)) < 1e-9 && Math.abs(Math.abs(b.x) - Math.PI) < 1e-9, `${b.x}, ${b.w}`);
  // On a flat video the corners are fractions of the frame: no wrapping.
  assert.deepEqual(quadBox([0.1, 0.2, 0.9, 0.2, 0.9, 0.8, 0.1, 0.8], false), { x: 0.5, y: 0.5, w: 0.8, h: 0.6000000000000001 });
});

test("the border survives a save and moves with a cut", () => {
  const kept = parseWalks({ walks: { [KEY]: { doors: [], zooms: [bordered()] } } }).walks[KEY].zooms![0];
  assert.equal(kept.outline?.length, 3);
  assert.equal(kept.auto, true);
  const bad = parseWalks({ walks: { [KEY]: { doors: [], zooms: [{ ...bordered(), outline: [{ t: 1, c: [1, 2, 3] }] }] } } }).walks[KEY].zooms![0];
  assert.equal(bad.outline, undefined, "a border that is not four corners is dropped, the 🔍 kept");
  const { walk } = remapWalk({ doors: [], zooms: [bordered()] }, [{ from: 5, to: 12 }]);
  assert.deepEqual(walk.zooms?.[0].outline?.map((f) => f.t), [5, 6]);
});

test("a shelf is looked for in a walk once; again when the walk or its photo changes", () => {
  const set: ZoomSet = { id: "gaaaa", label: zoomLabel(0), sig: "s", state: "done", note: "", made: "", manifest: "https://x/m1.json", master: "stores/x/gigapan/gaaaa/master.jpg" };
  assert.equal(toLocate(set, "w1"), true);
  const looked: ZoomSet = { ...set, place: { walk: "w1", manifest: set.manifest!, found: false, note: "", at: "" } };
  assert.equal(toLocate(looked, "w1"), false, "not there last time: not looked for again");
  assert.equal(toLocate(looked, "w2"), true, "a new walk");
  assert.equal(toLocate({ ...looked, manifest: "https://x/m2.json" }, "w1"), true, "stitched again");
  assert.equal(toLocate(looked, "w1", true), true, "asked to");
  assert.equal(toLocate({ ...set, state: "failed" }, "w1"), false);
  assert.deepEqual(thin([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), [0, 3, 5, 8, 10]);
  assert.deepEqual(thin([1, 2], 5), [1, 2]);
});
