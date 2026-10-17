// Cutting a walk video down to the parts worth keeping: times as typed, the
// parts checked, doors and dots moved with the picture, ffmpeg's arguments.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { checkParts, cutArgs, keptSeconds, mapTime, readTime, remapWalk, sayTime } from "./cut.ts";
import type { Walk } from "./walks.ts";

test("times as people type them", () => {
  assert.equal(readTime("4:20"), 260);
  assert.equal(readTime(" 7:48 "), 468);
  assert.equal(readTime("1:02:03"), 3723);
  assert.equal(readTime("260.5"), 260.5);
  assert.equal(readTime("4:75"), null);
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

test("ffmpeg reads only the parts, joins them, writes H.264 without sound", () => {
  const a = cutArgs("https://r2/x.mp4?sig", [{ from: 260, to: 280 }, { from: 468, to: 500 }], "/tmp/out.mp4");
  const s = a.join(" ");
  assert.match(s, /-ss 260 -to 280 -i https:\/\/r2\/x\.mp4\?sig -ss 468 -to 500 -i/);
  assert.match(s, /concat=n=2:v=1:a=0\[v\]/);
  assert.match(s, /-an -c:v libx264/);
  assert.equal(a.at(-1), "/tmp/out.mp4");
});
