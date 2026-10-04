// The tour: which scenes exist, where a visitor can go from each, and how
// going back returns them to where they stood.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  ORIGIN_POSE, addExit, emptyTour, enter, leave, parseTour, removeExit, removeScene, sceneById, updateScene, upsertScene,
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
  assert.deepEqual(parseTour(null), { version: 1, start: "hallway", scenes: [] });
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
