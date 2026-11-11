import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ONLINE_TTL_MS, EXCLUDE_TTL_MS, asVisitors, emptyJourneys, emptyVisitors, excludeIp, getCounts, getJourneyStats, getStats,
  isBotUserAgent, isExcludedIp, recordHeartbeat, recordJourney, recordLeave, refHost,
} from "./rules";

const T0 = Date.UTC(2026, 10, 11, 12, 0);
const min = (n: number) => T0 + n * 60_000;
const UA = "Mozilla/5.0 (Macintosh) Safari/605";

test("a tab's heartbeats are one visit; back after the gap is a second arrival of the same visitor", () => {
  const d = emptyVisitors();
  recordHeartbeat(d, { sid: "a", ip: "1.1.1.1", ua: UA }, min(0));
  recordHeartbeat(d, { sid: "a", ip: "1.1.1.1", ua: UA }, min(1));
  let c = getCounts(d, min(1));
  assert.deepEqual([c.visits.online, c.visits.lastHour, c.visits.total, c.uniques.total], [1, 1, 1, 1]);
  recordHeartbeat(d, { sid: "a", ip: "1.1.1.1", ua: UA }, min(10));
  c = getCounts(d, min(10));
  assert.deepEqual([c.visits.lastHour, c.uniques.lastHour, c.visits.total, c.uniques.total], [2, 1, 2, 1]);
});

test("two browsers behind one address are two visitors", () => {
  const d = emptyVisitors();
  recordHeartbeat(d, { sid: "a", ip: "1.1.1.1", ua: UA }, min(0));
  recordHeartbeat(d, { sid: "b", ip: "1.1.1.1", ua: UA + " Edg/1" }, min(0));
  assert.equal(getCounts(d, min(0)).uniques.online, 2);
});

test("online ends 2.5 min after the last heartbeat, or at once when the tab closes", () => {
  const d = emptyVisitors();
  recordHeartbeat(d, { sid: "a", ip: "1.1.1.1", ua: UA }, min(0));
  recordHeartbeat(d, { sid: "b", ip: "2.2.2.2", ua: UA }, min(0));
  assert.equal(recordLeave(d, "b"), true);
  assert.equal(recordLeave(d, "b"), false);
  assert.equal(getCounts(d, min(1)).visits.online, 1);
  assert.equal(getCounts(d, min(0) + ONLINE_TTL_MS + 1).visits.online, 0);
});

test("a link that loads a whole new page (leave, then a heartbeat from the same tab) is the same visit", () => {
  const d = emptyVisitors();
  recordHeartbeat(d, { sid: "a", ip: "1.1.1.1", ua: UA }, min(0));
  recordLeave(d, "a");
  assert.equal(getCounts(d, min(0)).visits.online, 0);
  recordHeartbeat(d, { sid: "a", ip: "1.1.1.1", ua: UA }, min(0) + 2000);
  const c = getCounts(d, min(0) + 2000);
  assert.deepEqual([c.visits.online, c.visits.total], [1, 1]);
});

test("the windows: hour, 6 h, 24 h, 7 days; the lifetime total outlives them", () => {
  const d = emptyVisitors();
  recordHeartbeat(d, { sid: "old", ip: "9.9.9.9", ua: UA }, T0 - 8 * 24 * 3600e3);
  recordHeartbeat(d, { sid: "w", ip: "3.3.3.3", ua: UA }, T0 - 3 * 24 * 3600e3);
  recordHeartbeat(d, { sid: "d", ip: "4.4.4.4", ua: UA }, T0 - 10 * 3600e3);
  recordHeartbeat(d, { sid: "s", ip: "5.5.5.5", ua: UA }, T0 - 3 * 3600e3);
  recordHeartbeat(d, { sid: "h", ip: "6.6.6.6", ua: UA }, T0 - 600e3);
  const c = getCounts(d, T0);
  assert.deepEqual(c.visits, { online: 0, lastHour: 1, last6h: 2, last24h: 3, last7d: 4, total: 5 });
  assert.equal(c.uniques.total, 5);
});

test("the summary: new today, active, lifetime", () => {
  const d = emptyVisitors();
  recordHeartbeat(d, { sid: "y", ip: "3.3.3.3", ua: UA }, T0 - 30 * 3600e3);
  recordHeartbeat(d, { sid: "y2", ip: "3.3.3.3", ua: UA }, min(-5));
  recordHeartbeat(d, { sid: "n", ip: "4.4.4.4", ua: UA }, min(0));
  const s = getStats(d, min(0));
  assert.deepEqual([s.online.sessions, s.online.newToday, s.today.newVisitors, s.today.uniqueVisitors], [1, 1, 1, 2]);
  assert.deepEqual(s.lifetime, { uniqueVisitors: 2, totalArrivals: 3 });
  assert.equal(s.today.date, "2026-11-11");
});

test("what was stored before, or damaged, still opens", () => {
  assert.deepEqual(asVisitors(null), emptyVisitors());
  assert.equal(asVisitors({ visits: "x", totals: { visits: 7 } }).totals.visits, 7);
});

test("bots are not visitors", () => {
  assert.equal(isBotUserAgent(""), true);
  assert.equal(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isBotUserAgent("Mozilla/5.0 HeadlessChrome/120"), true);
  assert.equal(isBotUserAgent(UA), false);
});

test("an operator's address is left out for 30 days after they last looked", () => {
  const list = {};
  excludeIp(list, "7.7.7.7", T0);
  excludeIp(list, "unknown", T0);
  assert.equal(isExcludedIp(list, "7.7.7.7", T0 + 1), true);
  assert.equal(isExcludedIp(list, "unknown", T0 + 1), false);
  assert.equal(isExcludedIp(list, "7.7.7.7", T0 + EXCLUDE_TTL_MS + 1), false);
});

test("where a visit came from: another site's name, never our own", () => {
  assert.equal(refHost("https://www.google.com/search?q=x", "vbazaar.app"), "google.com");
  assert.equal(refHost("https://vbazaar.app/tours", "www.vbazaar.app"), "");
  assert.equal(refHost("", "vbazaar.app"), "");
});

test("a journey: landing, pages with seconds and scroll, clicks, exit, bounce", () => {
  const d = emptyJourneys();
  recordJourney(d, { sid: "a", ownHost: "vbazaar.app", view: { page: "/", ref: "https://instagram.com/x", utm: { source: "instagram", medium: "bio" }, lang: "fa" } }, min(0));
  recordJourney(d, { sid: "a", stat: { page: "/", secs: 40, scroll: 80 } }, min(1));
  recordJourney(d, { sid: "a", stat: { page: "/", secs: 20, scroll: 30 } }, min(1)); // an older number arriving late
  recordJourney(d, { sid: "a", view: { page: "/walk/saraye-bamdad" } }, min(1));
  recordJourney(d, { sid: "a", event: { name: "basket-add", page: "/walk/saraye-bamdad" } }, min(2));
  recordJourney(d, { sid: "a", event: { name: "basket-add", page: "/walk/saraye-bamdad" } }, min(2));
  recordJourney(d, { sid: "b", view: { page: "/tours" } }, min(3));
  assert.equal(recordJourney(d, { sid: "ghost", stat: { page: "/", secs: 5, scroll: 5 } }, min(3)), false);

  const s = getJourneyStats(d, min(4)).day;
  assert.equal(s.sessions, 2);
  assert.equal(s.bounceRate, 50);
  assert.deepEqual(s.landing, [{ key: "/", count: 1 }, { key: "/tours", count: 1 }]);
  assert.deepEqual(s.referrers, [{ key: "instagram.com", count: 1 }, { key: "(direct)", count: 1 }]);
  assert.deepEqual(s.campaigns, [{ key: "instagram / bio", count: 1 }]);
  assert.deepEqual(s.events, [{ key: "basket-add", count: 1 }], "visits that did it, not presses");
  assert.deepEqual(s.pages.find((p) => p.page === "/"), { page: "/", views: 1, avgSecs: 40, avgScroll: 80 });
  assert.equal(s.exits.find((e) => e.key === "/walk/saraye-bamdad")?.count, 1);
  assert.equal(getJourneyStats(d, min(4)).latest[0].pages[0], "/tours 0s 0%");
});

test("a journey older than 14 days is dropped", () => {
  const d = emptyJourneys();
  recordJourney(d, { sid: "old", view: { page: "/" } }, T0 - 15 * 24 * 3600e3);
  recordJourney(d, { sid: "new", view: { page: "/" } }, T0);
  assert.deepEqual(Object.keys(d.journeys), ["new"]);
});
