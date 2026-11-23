import { test } from "node:test";
import assert from "node:assert/strict";
import { dhashFromGray, groupDuplicates, hamming } from "./photoDedupRules.ts";

const gradient = (flip = false) => Array.from({ length: 72 }, (_, i) => {
  const c = i % 9; return flip ? 255 - c * 28 : c * 28;
});

test("the same picture at another size gives the same hash; a different one does not", () => {
  const a = dhashFromGray(gradient());
  assert.equal(hamming(a, dhashFromGray(gradient().map((v) => Math.min(255, v + 3)))), 0);
  assert.ok(hamming(a, dhashFromGray(gradient(true))) > 20);
});

test("duplicates are grouped, the first id leads; a lone picture is not a group", () => {
  const a = "f0f0f0f0f0f0f0f0", near = "f0f0f0f0f0f0f0f1", other = "0f0f0f0f0f0f0f0f";
  assert.deepEqual(groupDuplicates([{ id: "x", hash: a }, { id: "y", hash: near }, { id: "z", hash: other }]), [["x", "y"]]);
});
