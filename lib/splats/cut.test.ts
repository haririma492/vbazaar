// Cutting a walk video down to the parts worth keeping: times as typed, the
// parts checked, doors and dots moved with the picture, ffmpeg's arguments.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PARTS, checkParts, concatList, keptOnOriginal, softFilter, keptSeconds, mapTime, originalWalk, partArgs, readCutRecord, readTime, remapWalk, sayTime, stitchArgs, unmapTime,
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

test("a part's soft edges (the Route optimizer's dips at rough joins) are kept and keep its length", () => {
  const { parts, problems } = checkParts([{ from: 1, to: 5, soft: { out: true } }, { from: 9, to: 12, soft: { in: true, bogus: 1 } }, { from: 14, to: 16, soft: "x" }], 20);
  assert.deepEqual(problems, []);
  assert.deepEqual(parts.map((p) => p.soft ?? null), [{ out: true }, { in: true }, null]);
  assert.deepEqual(softFilter(parts[0]), ["-vf", "fade=t=out:st=3.700:d=0.3"], "the dip ends with the part: its length is unchanged");
  assert.deepEqual(softFilter(parts[1]), ["-vf", "fade=t=in:st=0:d=0.3"]);
  assert.deepEqual(softFilter(parts[2]), []);
  assert.ok(partArgs("in.mp4", parts[0], "out.mp4").includes("fade=t=out:st=3.700:d=0.3"));
  assert.ok(MAX_PARTS >= 40, "room for a careful route");
});

test("a shelf's border and tray mark go back to the original's times, as they stand now", () => {
  // The cut kept 10–20 s and 40–50 s of the original; the cut video is 20 s long.
  const parts = [{ from: 10, to: 20 }, { from: 40, to: 50 }];
  const c = [0, 0, 1, 0, 1, 1, 0, 1];
  const before: Walk = { doors: [], zooms: [{ id: "z1", label: { en: "Shelf 1" }, pins: [{ t: 12, x: 0, y: 0 }], outline: [{ t: 12, c }] }] };
  // After the cut the operator redrew shelf 1 (3–15 s on the cut video) and marked the tray at 12 s.
  const now: Walk = { doors: [], zooms: [{ id: "z1", label: { en: "Shelf 1" }, pins: [{ t: 2, x: 0, y: 0 }], outline: [{ t: 3, c }, { t: 15, c }], trayAt: 12 }] };
  const z = originalWalk({ walk: before, parts }, now).walk.zooms![0];
  assert.deepEqual(z.outline!.map((f) => f.t), [13, 45]);
  assert.equal(z.trayAt, 42);
  // A record of the whole video (after «Put the original back»): times stay as they are.
  const same = originalWalk({ walk: now, parts: [{ from: 0, to: 60 }] }, now).walk.zooms![0];
  assert.deepEqual(same.outline!.map((f) => f.t), [3, 15]);
  assert.equal(same.trayAt, 12);
});

test("the Lock zone, the turn to the shelves and where tags begin move with the picture, and back", () => {
  const parts = [{ from: 10, to: 20 }, { from: 40, to: 50 }];
  const hide = { yaw: 0, width: 1, top: 0, auto: true, at: [{ t: 5, yaw: 0 }, { t: 15, yaw: 1 }, { t: 30, yaw: 2 }, { t: 45, yaw: 3 }] };
  const walk: Walk = { doors: [], hide, faceAt: 30, tagsFrom: 12 };
  const cut = remapWalk(walk, parts).walk;
  // 15 s → 5 s, 45 s → 15 s; 5 s and 30 s were cut out.
  assert.deepEqual(cut.hide!.at!.map((p) => [p.t, p.yaw]), [[5, 1], [15, 3]]);
  assert.equal(cut.faceAt, 10); // cut out: where the next kept stretch (40 s) starts
  assert.equal(cut.tagsFrom, 2);
  // Back, with a record made by a cut that moves them.
  const back = originalWalk({ walk, parts, v: 2 }, cut).walk;
  assert.deepEqual(back.hide!.at!.map((p) => p.t), [15, 45]);
  assert.equal(back.faceAt, 20); // the join between two kept stretches reads back as the end of the first
  assert.equal(back.tagsFrom, 12);
  // An older record: its cut left them on the original's times, so they stay.
  const old = originalWalk({ walk, parts }, walk).walk;
  assert.deepEqual(old.hide!.at!.map((p) => p.t), [5, 15, 30, 45]);
  assert.equal(old.faceAt, 30);
});

test("a walk's FIRST cut keeps the shelves' tray marks, moved with the picture", () => {
  const now: Walk = { doors: [], zooms: [{ id: "z", label: { en: "Shelf 1" }, pins: [{ t: 5, x: 0, y: 0 }], outline: [{ t: 5, c: [0, 0, 1, 0, 1, 1, 0, 1] }], trayAt: 3.7, trayEnd: 16.8 }] };
  // The record a first cut makes: the walk as it is, one part, the whole video.
  const onOriginal = originalWalk({ walk: now, parts: [{ from: 0, to: 141.18 }], v: 2 }, now).walk;
  const z = remapWalk(onOriginal, [{ from: 2, to: 141.18 }]).walk.zooms![0];
  assert.equal(z.trayAt, 1.7);
  assert.equal(z.trayEnd, 14.8);
});

test("cutting out stretches of the walk as it is now keeps the rest, on the original's times", () => {
  // Never cut: the video is the original; 10–20 s and 40–50 s cut out of a 60 s walk keep 0–10, 20–40, 50–60.
  assert.deepEqual(keptOnOriginal(60, [{ from: 10, to: 20 }, { from: 40, to: 50 }], []), [
    { from: 0, to: 10 }, { from: 20, to: 40 }, { from: 50, to: 60 },
  ]);
  // Overlapping and out-of-order stretches are merged; nothing cut out keeps the whole.
  assert.deepEqual(keptOnOriginal(60, [{ from: 30, to: 35 }, { from: 20, to: 32 }], []), [{ from: 0, to: 20 }, { from: 35, to: 60 }]);
  assert.deepEqual(keptOnOriginal(60, [], []), [{ from: 0, to: 60 }]);
  // After a cut that kept 100–160 and 200–260 of the original (the video now is 120 s): cutting 50–70 of the video now
  // keeps 100–150 of the original, and from video 70 on (original 200 + 10) to the end.
  const last = [{ from: 100, to: 160 }, { from: 200, to: 260 }];
  assert.deepEqual(keptOnOriginal(120, [{ from: 50, to: 70 }], last), [
    { from: 100, to: 150 }, { from: 200 + 10, to: 260 },
  ]);
  // A stretch cut out of the video now that reaches over the join keeps both sides, mapped apart.
  assert.deepEqual(keptOnOriginal(120, [{ from: 55, to: 65 }], last), [
    { from: 100, to: 155 }, { from: 200 + 5, to: 260 },
  ]);
});
