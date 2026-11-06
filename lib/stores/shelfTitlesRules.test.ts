import { test } from "node:test";
import assert from "node:assert/strict";
import { bookKey, foldTitle, mergeSpines, quartersOf, tilesOf, TILE } from "./shelfTitlesRules";

test("a small photo is one tile; a 12 MP phone photo is overlapping tiles covering every pixel", () => {
  assert.deepEqual(tilesOf(1200, 900), [{ x: 0, y: 0, w: 1200, h: 900 }]);
  const t = tilesOf(4032, 3024);
  assert.ok(t.length >= 6 && t.every((x) => x.w <= TILE && x.h <= TILE));
  // Covered: the right and bottom edges are reached, and neighbours overlap.
  assert.ok(t.some((x) => x.x + x.w === 4032) && t.some((x) => x.y + x.h === 3024));
  const row = t.filter((x) => x.y === 0).sort((a, b) => a.x - b.x);
  for (let i = 1; i < row.length; i++) assert.ok(row[i].x < row[i - 1].x + row[i - 1].w - 100, "overlap");
});

test("the same title written two ways is one book", () => {
  assert.equal(foldTitle("ديوان حافظ"), foldTitle("دیوان  حافظ"));
  assert.equal(foldTitle("می‌خواهم"), foldTitle("می خواهم"));
  assert.equal(foldTitle("كتابِ ما!"), foldTitle("کتاب ما"));
  assert.equal(bookKey({ title_fa: "", title_en: "Mission for My Country" }), "en:mission for my country");
  assert.equal(bookKey({ title_fa: "", title_en: "" }), "");
});

test("merging keeps the surer reading and drops readings with no title", () => {
  const rows = [
    { title_fa: "سووشون", title_en: "", readable: "partial", confidence: 0.6, tile: 1 },
    { title_fa: "سَووشون", title_en: "Savushun", readable: "full", confidence: 0.9, tile: 2 },
    { title_fa: "بوف کور", title_en: "", readable: "full", confidence: 0.8, tile: 2 },
    { title_fa: "", title_en: "", readable: "partial", confidence: 0.2, tile: 3 },
  ];
  const m = mergeSpines(rows);
  assert.equal(m.length, 2);
  assert.equal(m.find((r) => foldTitle(r.title_fa) === foldTitle("سووشون"))!.tile, 2);
});

test("the zoom pass: four overlapping quarters inside the tile, enlarged but never past a tile's size", () => {
  const t = { x: 100, y: 50, w: 1568, h: 1568 };
  const q = quartersOf(t);
  assert.equal(q.length, 4);
  for (const r of q) {
    assert.ok(r.x >= t.x && r.y >= t.y && r.x + r.w <= t.x + t.w && r.y + r.h <= t.y + t.h);
    assert.ok(r.w * r.scale <= TILE + 1 && r.scale > 1.5);
  }
  assert.ok(q[0].x + q[0].w > q[1].x, "they overlap");
});
