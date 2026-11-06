import { test } from "node:test";
import assert from "node:assert/strict";
import { fixWord, isTextKey } from "./wordFixRules.ts";

// The misspelt word, built from pieces so the repo itself never spells it (owner: "everywhere").
const W = "gal" + "ery";
const Wc = "Gal" + "ery";

test("one l → gallery, keeping its case, inside words and addresses", () => {
  assert.equal(fixWord(`stores/shiraz${W}/uploads/video/20261106-Shiraz${Wc}1.mp4`, W, "gallery"),
    "stores/shirazgallery/uploads/video/20261106-ShirazGallery1.mp4");
  assert.equal(fixWord(`Shiraz${W}canada@gmail.com`, W, "gallery"), "Shirazgallerycanada@gmail.com");
  assert.equal(fixWord(`SHIRAZ ${W.toUpperCase()}`, W, "gallery"), "SHIRAZ GALLERY");
  assert.equal(fixWord("https://www.shirazgallery.ca/", W, "gallery"), "https://www.shirazgallery.ca/", "already right: untouched");
});

test("only text files are rewritten", () => {
  assert.ok(isTextKey("stores/x/store.json"));
  assert.ok(!isTextKey("scenes/store-x/walk-1.mp4"));
  assert.ok(!isTextKey("scenes/store-x/logo.png"));
});
