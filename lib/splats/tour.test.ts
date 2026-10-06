// The tour: which scenes exist, where a visitor can go from each, and how
// going back returns them to where they stood.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DRIVE, DEFAULT_WALLS, ORIGIN_POSE, addDoor, addExit, addProp, emptyTour, hubOf, mergeTour, removeProp, setHub, updateProp, enter, leave, parseTour, removeDoor, removeExit, removeScene, sceneById, setDrive, setStartScene, updateScene, upsertScene,
  type Pose,
} from "./tour.ts";

const built = () => {
  let t = emptyTour();
  t = upsertScene(t, "hallway", "scenes/hallway/hallway.spz", { fa: "راهرو", en: "Hallway" });
  t = upsertScene(t, "store-01", "scenes/store-01/store-01.spz", { en: "Store 1" });
  t = upsertScene(t, "store-02", "scenes/store-02/store-02.spz");
  t = addExit(t, "hallway", "store-01", [1, 0, -4]);
  t = addExit(t, "hallway", "store-02", [-1, 0, -9]);
  t = addExit(t, "store-01", "hallway", [0, 0, 2], { en: "Back to the hallway" });
  return t;
};

test("the first scene added is where the tour starts; scenes default upright-flipped at the origin", () => {
  const t = built();
  assert.equal(t.start, "hallway");
  assert.deepEqual(t.scenes.map((s) => s.id), ["hallway", "store-01", "store-02"]);
  const s = sceneById(t, "store-02")!;
  assert.equal(s.flip, true);
  assert.deepEqual(s.start, ORIGIN_POSE);
  assert.deepEqual(s.title, { fa: "store-02", en: "store-02" });
  assert.deepEqual(sceneById(t, "store-01")!.title, { fa: "Store 1", en: "Store 1" });
});

test("the hallway branches: one exit per store, each named after it unless labelled", () => {
  const t = built();
  const hall = sceneById(t, "hallway")!;
  assert.deepEqual(hall.exits.map((e) => [e.id, e.to, e.label.en]), [["store-01", "store-01", "Store 1"], ["store-02", "store-02", "store-02"]]);
  assert.equal(sceneById(t, "store-01")!.exits[0].label.en, "Back to the hallway");
  // A second exit to the same store gets its own id.
  const twice = addExit(t, "hallway", "store-01", [2, 0, -4]);
  assert.deepEqual(sceneById(twice, "hallway")!.exits.map((e) => e.id), ["store-01", "store-02", "store-01-2"]);
  // No exit to itself, nor to a scene that does not exist.
  assert.equal(addExit(t, "hallway", "hallway", [0, 0, 0]), t);
  assert.equal(addExit(t, "hallway", "store-09", [0, 0, 0]), t);
});

test("re-uploading a scene keeps its exits and start; removing one drops the exits into it", () => {
  let t = built();
  t = updateScene(t, "hallway", { start: { position: [0, 1.6, 0], yaw: 0.5, pitch: 0 } });
  t = upsertScene(t, "hallway", "scenes/hallway/hallway-v2.spz");
  const hall = sceneById(t, "hallway")!;
  assert.equal(hall.file, "scenes/hallway/hallway-v2.spz");
  assert.equal(hall.exits.length, 2);
  assert.equal(hall.start.yaw, 0.5);
  t = removeScene(t, "store-01");
  assert.deepEqual(sceneById(t, "hallway")!.exits.map((e) => e.to), ["store-02"]);
  t = removeExit(t, "hallway", "store-02");
  assert.equal(sceneById(t, "hallway")!.exits.length, 0);
});

test("walking into a store and back returns to the very spot in the hallway", () => {
  const t = built();
  const inHallway: Pose = { position: [0.8, 1.6, -3.5], yaw: 1.2, pitch: -0.1 };
  const exit = sceneById(t, "hallway")!.exits[0];
  const inside = enter(t, [], "hallway", inHallway, exit)!;
  assert.equal(inside.scene, "store-01");
  assert.deepEqual(inside.pose, sceneById(t, "store-01")!.start);
  const back = leave(inside.trail)!;
  assert.equal(back.scene, "hallway");
  assert.deepEqual(back.pose, inHallway);
  assert.deepEqual(back.trail, []);
  assert.equal(leave([]), null);
});

test("a tour from the bucket is checked: bad scenes, files and exits are dropped", () => {
  const t = parseTour({
    start: "nowhere",
    scenes: [
      { id: "hallway", file: "scenes/hallway/h.spz", flip: false, exits: [{ id: "a", to: "store-01", at: [1, "x", 3] }, { id: "b", to: "gone" }, { id: "c", to: "hallway" }] },
      { id: "store-01", file: "scenes/store-01/s.spz" },
      { id: "hallway", file: "scenes/hallway/dup.spz" },
      { id: "Bad Id", file: "scenes/x/x.spz" },
      { id: "evil", file: "https://elsewhere.example/x.spz" },
      { id: "master", file: "masters/master/m.ply" },
    ],
  });
  assert.deepEqual(t.scenes.map((s) => s.id), ["hallway", "store-01"]);
  assert.equal(t.start, "hallway");
  const hall = sceneById(t, "hallway")!;
  assert.equal(hall.flip, false);
  assert.deepEqual(hall.exits.map((e) => [e.id, e.at]), [["a", [1, 0, 3]]]);
  assert.deepEqual(parseTour(null), { version: 1, start: "hallway", scenes: [], drive: DEFAULT_DRIVE, hub: null });
});

test("the cameraman's route is kept with the scene, checked, and survives a re-upload", () => {
  let t = built();
  assert.deepEqual(sceneById(t, "hallway")!.route, []);
  t = updateScene(t, "hallway", { route: [[0, 1.6, 0], [0, 1.6, -5], [3, 1.6, -9]] });
  t = upsertScene(t, "hallway", "scenes/hallway/hallway-v3.spz");
  assert.equal(sceneById(t, "hallway")!.route.length, 3);
  // Junk and single points are not a route.
  const p = parseTour({ scenes: [
    { id: "a", file: "scenes/a/a.spz", route: [[0, 0, 0], ["x", 1, 2], [1, 1]] },
    { id: "b", file: "scenes/b/b.spz", route: "far" },
  ] });
  assert.deepEqual(p.scenes[0].route, []);
  assert.deepEqual(p.scenes[1].route, []);
});

test("placing a scene in the world, its pace and its sharper copy are kept and checked", () => {
  let t = built();
  const hall = sceneById(t, "hallway")!;
  assert.equal(hall.place, null);
  assert.equal(hall.pace, 1);
  assert.equal(hall.fileHQ, null);
  t = updateScene(t, "store-01", { place: { offset: [1, 0, -20], yaw: 1.2, scale: 0.9 }, pace: 0.6, fileHQ: "scenes/store-01/store-01-hq.spz" });
  t = upsertScene(t, "store-01", "scenes/store-01/store-01-v2.spz");
  const s = sceneById(t, "store-01")!;
  assert.deepEqual(s.place, { offset: [1, 0, -20], yaw: 1.2, scale: 0.9 });
  assert.equal(s.pace, 0.6);
  assert.equal(s.fileHQ, "scenes/store-01/store-01-hq.spz");
  const bad = parseTour({ scenes: [{ id: "a", file: "scenes/a/a.spz", place: { scale: 0 }, pace: 9, fileHQ: "https://x/y.spz" }] }).scenes[0];
  assert.equal(bad.place!.scale, 1);
  assert.equal(bad.pace, 1.5);
  assert.equal(bad.fileHQ, null);
});

test("walls and shop doors are kept and checked", () => {
  let t = built();
  assert.equal(sceneById(t, "hallway")!.walls, DEFAULT_WALLS);
  t = updateScene(t, "hallway", { walls: 0.8 });
  t = addDoor(t, "hallway", [2, 1.6, -5], "Jeweller", 4);
  t = addDoor(t, "hallway", [-2, 1.6, -8], "");
  t = upsertScene(t, "hallway", "scenes/hallway/hallway-v2.spz");
  const h = sceneById(t, "hallway")!;
  assert.equal(h.walls, 0.8);
  assert.deepEqual(h.doors.map((d) => [d.id, d.label.en, d.depth]), [["door-1", "Jeweller", 4], ["door-2", "Shop 2", 3]]);
  t = removeDoor(t, "hallway", "door-1");
  assert.deepEqual(sceneById(t, "hallway")!.doors.map((d) => d.id), ["door-2"]);
  const bad = parseTour({ scenes: [{ id: "a", file: "scenes/a/a.spz", walls: -3, doors: [{ id: "x", at: [0, 0, 0], depth: 999 }, { id: "x" }, {}] }] }).scenes[0];
  assert.equal(bad.walls, 0);
  assert.deepEqual(bad.doors.map((d) => [d.id, d.depth]), [["x", 30]]);
});

test("the starting scene and how walking feels are kept and checked", () => {
  let t = built();
  assert.deepEqual(t.drive, DEFAULT_DRIVE);
  t = setStartScene(t, "store-01");
  assert.equal(t.start, "store-01");
  assert.equal(setStartScene(t, "nowhere").start, "store-01");
  t = setDrive(t, { speed: 1.2, accel: 99 });
  t = upsertScene(t, "hallway", "scenes/hallway/hallway-v3.spz");
  assert.deepEqual(t.drive, { ...DEFAULT_DRIVE, speed: 1.2, accel: 2.5 });
  assert.deepEqual(parseTour({ scenes: [], drive: { turn: "x", turnGlide: -1 } }).drive, { ...DEFAULT_DRIVE, turnGlide: 0.05 });
});

test("saving merges: an upload elsewhere never erases a route recorded here, nor the reverse", () => {
  const base = built();
  // Here (the viewer's edit mode): a route recorded, and the drive tuned.
  const mine = setDrive(updateScene(base, "hallway", { route: [[0, 0, 0], [0, 0, -5]] }), { speed: 1.1 });
  // Meanwhile (the upload page): the hallway's file replaced, the store's sharper copy added.
  const theirs = updateScene(upsertScene(base, "hallway", "scenes/hallway/hallway-v9.spz"), "store-01", { fileHQ: "scenes/store-01/store-01-hq.spz" });
  const m = mergeTour(base, mine, theirs);
  const hall = sceneById(m, "hallway")!;
  assert.deepEqual(hall.route, [[0, 0, 0], [0, 0, -5]]);
  assert.equal(hall.file, "scenes/hallway/hallway-v9.spz");
  assert.equal(sceneById(m, "store-01")!.fileHQ, "scenes/store-01/store-01-hq.spz");
  assert.equal(m.drive.speed, 1.1);
  // A stale page that changed nothing of the route leaves the stored route alone.
  const stale = mergeTour(base, updateScene(base, "store-01", { pace: 0.5 }), m);
  assert.deepEqual(sceneById(stale, "hallway")!.route, [[0, 0, 0], [0, 0, -5]]);
  assert.equal(sceneById(stale, "store-01")!.pace, 0.5);
  // A scene added here, and one removed here, are kept so.
  const added = mergeTour(base, upsertScene(base, "alley-1", "scenes/alley-1/alley-1.spz"), theirs);
  assert.ok(sceneById(added, "alley-1"));
  assert.equal(sceneById(mergeTour(base, removeScene(base, "store-01"), theirs), "store-01"), null);
});

test("the safe spot: set, kept through a merge, the start when unset", () => {
  const base = built();
  assert.deepEqual(hubOf(base), { scene: base.start, pose: sceneById(base, base.start)!.start });
  const pose = { position: [1, 1.6, -3] as [number, number, number], yaw: 0.5, pitch: 0 };
  const mine = setHub(base, { scene: "store-01", pose });
  assert.deepEqual(hubOf(mine), { scene: "store-01", pose });
  const merged = mergeTour(base, mine, setDrive(base, { speed: 1.3 }));
  assert.deepEqual(merged.hub, { scene: "store-01", pose });
  assert.equal(merged.drive.speed, 1.3);
  assert.equal(parseTour({ scenes: base.scenes, hub: { scene: "nowhere", pose } }).hub, null);
});

test("how a scene was joined is kept and checked", () => {
  let t = built();
  assert.equal(sceneById(t, "store-01")!.join, null);
  t = updateScene(t, "store-01", { join: { to: "hallway", by: "pictures", share: 0.87 } });
  t = upsertScene(t, "store-01", "scenes/store-01/store-01-v3.spz");
  assert.deepEqual(sceneById(t, "store-01")!.join, { to: "hallway", by: "pictures", share: 0.87 });
  const bad = parseTour({ scenes: [{ id: "a", file: "scenes/a/a.spz", join: { to: "Nope!", by: "x" } }, { id: "b", file: "scenes/b/b.spz", join: { to: "a", by: "x", share: 7 } }] });
  assert.equal(bad.scenes[0].join, null);
  assert.deepEqual(bad.scenes[1].join, { to: "a", by: "paths", share: 1 });
});

test("props: a china shelf and a sale post, placed, edited, kept and checked", () => {
  let t = built();
  t = addProp(t, "hallway", "china-shelf", [-1.5, 0, -4], 1.57);
  t = addProp(t, "hallway", "china-shelf", [1.5, 0, -4], -1.57);
  t = addProp(t, "hallway", "sale-post", [0.5, 0, -7], 0);
  let h = sceneById(t, "hallway")!;
  assert.deepEqual(h.props.map((p) => p.id), ["shelf-1", "shelf-2", "sale-1"]);
  assert.equal(h.props[2].price, "$19.99");
  assert.equal(h.props[2].say, "I'm on sale!");
  t = updateProp(t, "hallway", "sale-1", { price: "$9.99", size: 1.2 });
  t = upsertScene(t, "hallway", "scenes/hallway/hallway-v4.spz");
  t = removeProp(t, "hallway", "shelf-1");
  h = sceneById(t, "hallway")!;
  assert.deepEqual(h.props.map((p) => [p.id, p.price, p.size]), [["shelf-2", "", 1], ["sale-1", "$9.99", 1.2]]);
  const bad = parseTour({ scenes: [{ id: "a", file: "scenes/a/a.spz", props: [{ id: "x", kind: "rocket", at: [0, 0, 0] }, { id: "y", kind: "sale-post", size: 99 }] }] });
  assert.deepEqual(bad.scenes[0].props.map((p) => [p.id, p.size]), [["y", 10]]);
});
