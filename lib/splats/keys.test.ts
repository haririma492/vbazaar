// Where a splat file lands in R2, and how a 2 GB master is cut into parts.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  contentTypeFor, isSceneId, isSplatKey, isWalkVideo, kindOfFile, partPlan, partRange, safeFileName, sceneIdFromFileName,
  splatKey, webFileName,
} from "./keys.ts";

const MiB = 1024 * 1024;

test("scene ids are lowercase words with inner hyphens", () => {
  for (const ok of ["hallway", "store-01", "a", "store-02-north"]) assert.ok(isSceneId(ok), ok);
  for (const bad of ["", "Hallway", "-x", "x-", "store_01", "a/b", "..", "x".repeat(41)]) assert.ok(!isSceneId(bad), bad);
});

test("a .ply is a master, a web format is a scene file, the rest is refused", () => {
  assert.equal(kindOfFile("Hallway Final.PLY"), "master");
  for (const f of ["h.spz", "h.sog", "h.ksplat", "h.splat", "h.rad"]) assert.equal(kindOfFile(f), "web", f);
  for (const f of ["h.zip", "h", "h.ply.exe", "h.mov"]) assert.equal(kindOfFile(f), null, f);
});

test("keys: masters/ for the .ply, scenes/ for the web copy, names made safe", () => {
  assert.deepEqual(splatKey("hallway", "Splatica export (1).ply"), { key: "masters/hallway/Splatica-export-1-.ply", kind: "master" });
  assert.deepEqual(splatKey("store-01", "store-01.spz"), { key: "scenes/store-01/store-01.spz", kind: "web" });
  assert.equal(splatKey("hallway", "../../etc/passwd.ply")?.key, "masters/hallway/passwd.ply");
  assert.equal(splatKey("Hallway", "a.ply"), null);
  assert.equal(splatKey("hallway", "a.txt"), null);
  assert.equal(safeFileName("..."), "");
});

test("a key sent back by the browser is checked against what this tool makes", () => {
  assert.equal(isSplatKey("masters/hallway/a.ply"), "master");
  assert.equal(isSplatKey("scenes/store-01/a.spz"), "web");
  for (const bad of ["masters/hallway/a.spz", "scenes/hallway/a.ply", "other/hallway/a.ply", "masters/../a.ply",
    "masters/hallway/x/a.ply", "masters/Hallway/a.ply", "masters/hallway/.a.ply"]) {
    assert.equal(isSplatKey(bad), null, bad);
  }
  // Every key splatKey makes passes.
  const made = splatKey("store-02", "Store 02 final.spz")!;
  assert.equal(isSplatKey(made.key), made.kind);
});

test("a 2 GB master: 16 MiB parts, 120 of them, the last one shorter", () => {
  const size = 2_000_000_000;
  const plan = partPlan(size)!;
  assert.equal(plan.partSize, 16 * MiB);
  assert.equal(plan.partCount, 120);
  const [s, e] = partRange(plan.partCount, size, plan.partSize);
  assert.equal(e, size);
  assert.ok(e - s > 0 && e - s <= plan.partSize);
  // The parts tile the file exactly.
  let covered = 0;
  for (let n = 1; n <= plan.partCount; n++) {
    const [a, b] = partRange(n, size, plan.partSize);
    assert.equal(a, covered);
    covered = b;
  }
  assert.equal(covered, size);
});

test("parts stay under R2's 10,000 and are whole MiB; tiny and absurd sizes", () => {
  assert.deepEqual(partPlan(1), { partSize: 16 * MiB, partCount: 1 });
  const huge = partPlan(1024 * 1024 * MiB)!; // 1 TiB
  assert.ok(huge.partCount <= 10_000);
  assert.equal(huge.partSize % MiB, 0);
  for (const bad of [0, -1, 1.5, NaN, 6 * 1024 * 1024 * MiB]) assert.equal(partPlan(bad), null, String(bad));
});

test("a scene id guessed from the file name, and the web copy's dated name", () => {
  assert.equal(sceneIdFromFileName("Store 01 (final).ply"), "store-01-final");
  assert.equal(sceneIdFromFileName("C:\\splats\\HALLWAY.ply"), "hallway");
  assert.equal(sceneIdFromFileName("___.ply"), "");
  assert.ok(isSceneId(sceneIdFromFileName("x".repeat(80) + ".ply")));
  const name = webFileName("store-01", new Date("2026-10-03T05:47:12Z"));
  assert.equal(name, "store-01-20261003-0547.spz");
  assert.equal(splatKey("store-01", name)?.key, "scenes/store-01/store-01-20261003-0547.spz");
});

test("a 360° walk video goes to scenes/ like a web splat, served as video", () => {
  assert.equal(kindOfFile("Walk Oct 2.MP4"), "web");
  assert.deepEqual(splatKey("worldonyonge-walk", "walk-v1.mp4"), { key: "scenes/worldonyonge-walk/walk-v1.mp4", kind: "web" });
  assert.equal(isSplatKey("scenes/worldonyonge-walk/walk-v1.mp4"), "web");
  assert.equal(isSplatKey("masters/worldonyonge-walk/walk-v1.mp4"), null);
  assert.equal(contentTypeFor("walk.mp4"), "video/mp4");
  assert.ok(isWalkVideo("walk.mp4") && !isWalkVideo("scene.spz"));
});
