import { test } from "node:test";
import assert from "node:assert/strict";
import { REFRESH_STEPS, SKIPPED_NOTE, skipList, stepStates } from "./refreshSteps.ts";

test("only steps the run knows can be skipped, kept in the run's order", () => {
  assert.deepEqual(skipList(["Zoom photos", "Nonsense", "Store map", 7]), ["Store map", "Zoom photos"]);
  assert.deepEqual(skipList("Store map"), []);
  assert.deepEqual(skipList(undefined), []);
});

test("the card lists every step: done, working, waiting, and the ones to be skipped", () => {
  const run = { running: true, skip: ["Shelf Tour"], steps: [{ name: "Door photo", note: "The door photo opens both tours (7 s)." }, { name: "Shelf finder (new shelves)", note: `${SKIPPED_NOTE} What it had in hand finishes behind.` }, { name: "Store map", note: "working…" }] };
  const st = stepStates(run);
  assert.equal(st.length, REFRESH_STEPS.length);
  assert.deepEqual(st.map((s) => s.state), ["done", "skipped", "working", "skipped", "waiting", "waiting", "waiting"]);
  assert.equal(st[3].note, "Will be skipped.");
  // No run yet: nothing is working or waiting.
  assert.ok(stepStates(null).every((s) => s.state === "off"));
  assert.equal(stepStates({ running: false, steps: [{ name: "Title reader", note: "Failed: no key" }] })[4].state, "failed");
});
