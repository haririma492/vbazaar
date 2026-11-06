import { test } from "node:test";
import assert from "node:assert/strict";
import { addEvent, stayOf, VISIT_GAP_MS, type OwnerVisits } from "./ownerVisitsRules";

const empty: OwnerVisits = { logins: 0, visits: 0, lastLogin: null, lastVisit: null, firstAt: null, recent: [], sessions: [] };
const at = (min: number) => new Date(Date.UTC(2026, 10, 6, 10, 0) + min * 60_000);

test("a sign-in counts, and starts a visit", () => {
  const v = addEvent(empty, "login", at(0))!;
  assert.equal(v.logins, 1); assert.equal(v.visits, 1);
});
test("the page polling inside a sitting is the same visit", () => {
  const v = addEvent(empty, "login", at(0))!;
  const w = addEvent(v, "visit", at(5))!;
  assert.equal(w.visits, 1, "the same visit, its stay longer");
  assert.equal(w.sessions[0].end, at(5).toISOString());
});
test("back after 30 min away is a new visit, not a sign-in", () => {
  const v = addEvent(addEvent(empty, "login", at(0))!, "visit", at(31))!;
  assert.equal(v.visits, 2); assert.equal(v.logins, 1);
});
test("a request this server saw recently keeps it the same sitting", () => {
  const v = addEvent(empty, "visit", at(0))!;
  assert.equal(addEvent(v, "visit", at(40), at(39).getTime())!.visits, 1);
});
test("a second sign-in inside a sitting counts the sign-in, not a second visit", () => {
  const v = addEvent(addEvent(empty, "login", at(0))!, "login", at(2))!;
  assert.equal(v.logins, 2); assert.equal(v.visits, 1);
});
test("the gap is 30 min", () => assert.equal(VISIT_GAP_MS, 1_800_000));
test("each visit is one record, with how long the owner stayed", () => {
  let v = addEvent(empty, "login", at(0))!;
  v = addEvent(v, "visit", at(12))!;
  v = addEvent(v, "visit", at(50))!; // 38 min away: a new visit
  v = addEvent(v, "visit", at(53))!;
  assert.equal(v.visits, 2);
  assert.equal(v.sessions.length, 2);
  assert.deepEqual(v.sessions.map(stayOf), ["3 min", "12 min"]);
  assert.equal(v.sessions[1].login, true);
  assert.equal(v.sessions[0].login, false);
});
test("a stored file from before visits had records still works", () => {
  const old = { logins: 1, visits: 1, lastLogin: at(0).toISOString(), lastVisit: at(0).toISOString(), firstAt: at(0).toISOString(), recent: [] } as unknown as OwnerVisits;
  const v = addEvent(old, "visit", at(5))!;
  assert.equal(v.visits, 2, "no record to extend: this visit starts one");
  assert.equal(v.sessions.length, 1);
});
test("an hour and more reads as hours", () => {
  assert.equal(stayOf({ start: at(0).toISOString(), end: at(65).toISOString(), login: false }), "1 h 5 min");
  assert.equal(stayOf({ start: at(0).toISOString(), end: at(0).toISOString(), login: false }), "under a minute");
});
