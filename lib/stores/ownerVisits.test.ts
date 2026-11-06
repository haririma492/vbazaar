import { test } from "node:test";
import assert from "node:assert/strict";
import { addEvent, VISIT_GAP_MS, type OwnerVisits } from "./ownerVisitsRules";

const empty: OwnerVisits = { logins: 0, visits: 0, lastLogin: null, lastVisit: null, firstAt: null, recent: [] };
const at = (min: number) => new Date(Date.UTC(2026, 10, 6, 10, 0) + min * 60_000);

test("a sign-in counts, and starts a visit", () => {
  const v = addEvent(empty, "login", at(0))!;
  assert.equal(v.logins, 1); assert.equal(v.visits, 1);
});
test("the page polling inside a sitting is the same visit", () => {
  const v = addEvent(empty, "login", at(0))!;
  assert.equal(addEvent(v, "visit", at(5)), null);
});
test("back after 30 min away is a new visit, not a sign-in", () => {
  const v = addEvent(addEvent(empty, "login", at(0))!, "visit", at(31))!;
  assert.equal(v.visits, 2); assert.equal(v.logins, 1);
});
test("a request this server saw recently keeps it the same sitting", () => {
  const v = addEvent(empty, "visit", at(0))!;
  assert.equal(addEvent(v, "visit", at(40), at(39).getTime()), null);
});
test("a second sign-in inside a sitting counts the sign-in, not a second visit", () => {
  const v = addEvent(addEvent(empty, "login", at(0))!, "login", at(2))!;
  assert.equal(v.logins, 2); assert.equal(v.visits, 1);
});
test("the gap is 30 min", () => assert.equal(VISIT_GAP_MS, 1_800_000));
