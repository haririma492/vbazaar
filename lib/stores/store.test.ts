// The Store Builder crew's record of a store: intake answers, uploads, and
// which step runs next.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import {
  addUpload, applyEdits, checkAnswer, checkIntake, checkUploadName, isUploadKeyOf, newStore, nextStep, parseStore, setStep, slugOf, statusOf, uploadKey,
  type Intake,
} from "./store.ts";
import { matchFileName, photoList, picturesByProduct, productSheet, readBook } from "./workbook.ts";

const intake: Intake = {
  nameEn: "Ali's Market", nameFa: "سوپرمارکت علی", category: "Grocery", contact: "Ali", phone: "+1 416 555 0101",
  email: "ali@example.com", address: "1 Yonge St, Toronto", hours: "", website: "@alismarket", password: "saffron1",
};
const now = new Date("2026-10-30T12:00:00Z");
const file = (name: string) => ({ key: uploadKey("alis-market", "video", name, now), name, size: 1, at: now.toISOString() });

test("a store's address comes from its English name", () => {
  assert.equal(slugOf("Ali's Market"), "alis-market");
  assert.equal(slugOf("سوپرمارکت"), "");
});

test("each answer is checked as it is typed; optional ones may be empty", () => {
  assert.equal(checkAnswer("hours", ""), null);
  assert.ok(checkAnswer("phone", "12"));
  assert.ok(checkAnswer("password", "abc"));
  assert.equal(checkAnswer("website", "@alismarket"), null);
  assert.deepEqual(checkIntake(intake), []);
  assert.equal(checkIntake({ ...intake, nameFa: "" }).length, 1);
});

test("the raw .insv is refused with what to do; the Studio .mp4 is taken", () => {
  assert.match(checkUploadName("video", "VID_20261030.insv") ?? "", /Insta360 Studio/);
  assert.equal(checkUploadName("video", "walk.mp4"), null);
  assert.ok(checkUploadName("sheet", "list.csv"));
  assert.ok(isUploadKeyOf("alis-market", uploadKey("alis-market", "photo", "My Saffron (1).JPG", now)));
  assert.ok(!isUploadKeyOf("other", uploadKey("alis-market", "photo", "a.jpg", now)));
});

test("the crew runs in order: nothing before the uploads, the video and the list first, the report last", () => {
  let s = newStore("alis-market", intake, "scrypt$x$y", now);
  assert.equal(s.website, "https://www.instagram.com/alismarket/");
  assert.equal(nextStep(s), null, "no uploads yet");
  assert.equal(statusOf(s).tone, "you");
  s = addUpload(s, "sheet", file("list.xlsx"));
  assert.equal(nextStep(s), "catalogue");
  s = setStep(s, "catalogue", "done", "", now);
  assert.equal(nextStep(s), "photos");
  s = setStep(s, "photos", "done", "", now);
  assert.equal(nextStep(s), null, "the tagger waits for the video");
  s = addUpload(s, "video", file("walk.mp4"));
  assert.equal(nextStep(s), "video");
  s = setStep(s, "video", "failed", "ffmpeg stopped", now);
  assert.equal(nextStep(s), "video", "tried again");
  s = setStep(s, "video", "failed", "", now);
  s = setStep(s, "video", "failed", "", now);
  assert.equal(nextStep(s), null, "three tries, then it waits for a person");
  assert.equal(statusOf(s).tone, "you");
  s = addUpload(s, "video", file("walk-2.mp4"));
  for (const n of ["video", "lock", "tag", "place"] as const) {
    assert.equal(nextStep(s), n);
    s = setStep(s, n, "done", "", now);
  }
  assert.equal(nextStep(s), "check");
  s = setStep(s, "check", "done", "", now);
  assert.equal(nextStep(s), null);
  assert.equal(statusOf(s).tone, "ready", "a new store waits for «Publish»");
  s = addUpload(s, "photo", file("112.jpg"));
  assert.deepEqual([s.steps.photos.state, s.steps.tag.state, s.steps.video.state], ["todo", "todo", "done"], "a new photo redoes only what it touches");
});

test("details are changed on the page and checked; the record reads back", () => {
  const s = newStore("alis-market", intake, "scrypt$x$y", now);
  const { store, problems } = applyEdits(s, { phone: "1", hours: "9–9" });
  assert.equal(problems.length, 1);
  assert.equal(store.hours, "9–9");
  assert.equal(store.phone, s.phone);
  assert.deepEqual(parseStore(JSON.parse(JSON.stringify(store))), store);
  assert.equal(parseStore({ slug: "../x" }), null);
});

/** A workbook with a product sheet (a picture on row 3) and a photo list sheet. */
function workbook(): Uint8Array {
  const sheet = (rows: string[][]) =>
    `<worksheet xmlns:r="r"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${i + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join("")}</row>`).join("")}</sheetData><drawing r:id="rId1"/></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Products" r:id="rId1"/><sheet name="Photos" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet([["product no", "title_en", "title_fa", "unit", "unit price"], ["SKU-0045", "Saffron 1g", "زعفران", "piece", "12.99"], ["SKU-0112", "Pistachio", "پسته", "lb", "9.49"]])),
    "xl/worksheets/_rels/sheet1.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>`),
    "xl/drawings/drawing1.xml": strToU8(`<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:pic><a:blip r:embed="rId1"/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`),
    "xl/drawings/_rels/drawing1.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>`),
    "xl/media/image1.png": new Uint8Array([137, 80, 78, 71]),
    "xl/worksheets/sheet2.xml": strToU8(sheet([["Product", "Photo file"], ["SKU-0045", "saffron-front.jpg"]]).replace(`<drawing r:id="rId1"/>`, "")),
  });
}

test("the workbook: numbers given when it has none, a picture on a row is that row's product, a photo list names files", () => {
  const book = readBook(workbook());
  assert.deepEqual(book.sheets.map((s) => s.name), ["Products", "Photos"]);
  const ps = productSheet(book)!;
  assert.equal(ps.sheet, "Products");
  assert.deepEqual(ps.products.map((p) => [p.n, p.sku, p.en, p.priceCents]), [[1, "SKU-0045", "Saffron 1g", 1299], [2, "SKU-0112", "Pistachio", 949]]);
  const list = photoList(book, ps.products, ps.sheet);
  assert.deepEqual(list.map((l) => [l.n, l.photo]), [[1, "saffron-front.jpg"]]);
  const pics = picturesByProduct(book, ps, list);
  assert.deepEqual([...pics.values()], [{ n: 2, how: "in the sheet" }]);
  assert.deepEqual(matchFileName("saffron-front.JPG", ps.products, list), { n: 1, how: "photo list" });
  assert.deepEqual(matchFileName("0112.jpg", ps.products, list), { n: 2, how: "file name" });
  assert.deepEqual(matchFileName("SKU-0045_b.png", ps.products, list), { n: 1, how: "file name" });
  assert.equal(matchFileName("IMG_4412.jpg", ps.products, list), null, "a camera's own name is left to the Photo matcher");
});
