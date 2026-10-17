// Cutting a walk video down to the parts worth keeping: times as typed, the
// parts checked, doors and dots moved with the picture, ffmpeg's arguments.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkParts, concatList, keptSeconds, mapTime, originalWalk, partArgs, readCutRecord, readTime, remapWalk, sayTime, stitchArgs, unmapTime,
} from "./cut.ts";
import type { Walk } from "./walks.ts";

test("times as people type them", () => {
  assert.equal(readTime("4:20"), 260);
  assert.equal(readTime(" 7:48 "), 468);
  assert.equal(readTime("1:02:03"), 3723);
  assert.equal(readTime("260.5"), 260.5);
  assert.equal(readTime("4:75"), 315, "seconds past 59 carry over");
  assert.equal(readTime("1:60"), 120);
  assert.equal(readTime("four"), null);
  assert.equal(sayTime(260), "4:20");
  assert.equal(sayTime(3723.5), "1:02:03.5");
  assert.equal(sayTime(5), "0:05");
});

test("the founder's two parts: 4:20–4:40 and 7:48–8:20, given in any order", () => {
  const { parts, problems } = checkParts([{ from: 468, to: 500 }, { from: 260, to: 280 }], 953);
  assert.deepEqual(problems, []);
  assert.deepEqual(parts, [{ from: 260, to: 280 }, { from: 468, to: 500 }]);
  assert.equal(keptSeconds(parts), 52);
  assert.equal(mapTime(270, parts), 10);
  assert.equal(mapTime(468, parts), 20);
  assert.equal(mapTime(499, parts), 51);
  assert.equal(mapTime(300, parts), null, "cut away");
});

test("parts that cannot be kept are each said", () => {
  const { problems } = checkParts([{ from: 10, to: 5 }, { from: 900, to: 1000 }, { from: 20, to: 40 }, { from: 30, to: 50 }], 953);
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /ends before it starts/);
  assert.match(problems.join("\n"), /outside the video/);
  assert.match(problems.join("\n"), /overlap/);
  assert.match(checkParts([], 953).problems[0], /at least one part/);
});

test("doors and dots move with the picture; those cut away are said", () => {
  const walk: Walk = {
    doors: [
      { id: "in", t: 270, yaw: 1, label: { en: "Tools" }, to: "scenes/a/b.mp4", pins: [{ t: 265, yaw: 1, pitch: 0 }, { t: 300, yaw: 1, pitch: 0 }], back: { t: 275, yaw: 0 } },
      { id: "gone", t: 300, yaw: 1, label: { en: "Old" }, to: "scenes/a/b.mp4" },
    ],
    items: [
      { id: "saw", label: { en: "Saw" }, pins: [{ t: 470, x: 0.5, y: 0.5 }, { t: 600, x: 0.5, y: 0.5 }] },
      { id: "nut", label: { en: "Nut" }, pins: [{ t: 10, x: 0.1, y: 0.1 }] },
    ],
    projection: "eac",
  };
  const parts = [{ from: 260, to: 280 }, { from: 468, to: 500 }];
  const { walk: w, dropped } = remapWalk(walk, parts);
  assert.deepEqual(w.doors.map((d) => [d.id, d.t, d.pins?.map((p) => p.t), d.back?.t]), [["in", 10, [5], 15]]);
  assert.deepEqual(w.items!.map((i) => [i.id, i.pins.map((p) => p.t)]), [["saw", [22]], ["nut", []]]);
  assert.equal(w.projection, "eac");
  assert.deepEqual(dropped, ["door «Old»", "the dot of «Nut» (kept in the list, place it again)"]);
});

test("cut: each part out of the original on its own; stitch: joined in order, not encoded again", () => {
  const cut = partArgs("https://r2/x.mp4.original?sig", { from: 260, to: 280 }, "/tmp/part-0.mp4").join(" ");
  assert.match(cut, /-ss 260 -to 280 -i https:\/\/r2\/x\.mp4\.original\?sig/);
  assert.match(cut, /-an -c:v libx264/);
  const stitch = stitchArgs("/tmp/parts.txt", "/tmp/out.mp4").join(" ");
  assert.match(stitch, /-f concat -safe 0 -i \/tmp\/parts\.txt -c copy/);
  assert.equal(concatList(["/tmp/a.mp4", "/tmp/b'c.mp4"]), "file '/tmp/a.mp4'\nfile '/tmp/b'\\''c.mp4'\n");
});

test("⚠️ times are the original's: a second cut is read from the original, not from the first cut", () => {
  // The first cut kept 4:20–4:40 and 4:40–5:08 (0:48); the founder then asks for 4:20–4:40 and 7:48–8:20.
  const first = [{ from: 260, to: 280 }, { from: 280, to: 308 }];
  assert.equal(unmapTime(30, first), 290, "0:30 of the cut video is 4:50 of the original");
  assert.equal(unmapTime(60, first), null);
  const { parts, problems } = checkParts([{ from: 260, to: 280 }, { from: 468, to: 500 }], 953 /* the original's length */);
  assert.deepEqual(problems, []);
  assert.equal(keptSeconds(parts), 52);

  // The walk as it was before the first cut, plus a dot placed on the cut video since.
  const record = {
    walk: { doors: [{ id: "in", t: 470, yaw: 0, label: { en: "Tools" }, to: "scenes/a/b.mp4" }], items: [{ id: "saw", label: { en: "Saw" }, pins: [{ t: 475, x: 0.5, y: 0.5 }] }] },
    parts: first,
  };
  const now = { doors: [], items: [{ id: "saw", label: { en: "Saw" }, pins: [] }, { id: "nut", label: { en: "Nut" }, pins: [{ t: 30, x: 0.1, y: 0.1 }] }], audio: "scenes/a/audio/sound-20261018-101500.mp3" };
  const { walk, lost } = originalWalk(record, now);
  assert.deepEqual(lost, []);
  assert.deepEqual(walk.doors.map((d) => d.t), [470], "the door cut away by the first cut comes back");
  assert.deepEqual(walk.items!.map((i) => [i.id, i.pins.map((p) => p.t)]), [["saw", [475]], ["nut", [290]]]);
  assert.equal(walk.audio, now.audio, "what was set since stays");
  const cut = remapWalk(walk, parts).walk;
  assert.deepEqual(cut.doors.map((d) => d.t), [22]);
  assert.deepEqual(cut.items!.map((i) => i.pins.map((p) => p.t)), [[27], []]);
});

test("the record kept by the first cuts (the walk alone) is still read", () => {
  assert.deepEqual(readCutRecord({ doors: [] }), { walk: { doors: [] } });
  assert.deepEqual(readCutRecord({ walk: { doors: [] }, parts: [{ from: 1, to: 5 }] }), { walk: { doors: [] }, parts: [{ from: 1, to: 5 }] });
  assert.equal(readCutRecord(null), null);
});
