import { test } from "node:test";
import assert from "node:assert/strict";
import { noteOf, setsOf, sigOf, stateOf, toStitch, zoomLabel, type ZoomRecord } from "./gigapanRules.ts";
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
