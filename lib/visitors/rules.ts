/**
 * VISITOR STATISTICS, THE RULES (owner, 2026-11-11: "add statistics collection to vbazaar.app with admin mode
 * (AAA + admin token) exactly similar to olgoo.com"). A port of olgoo.com's `api/_lib/visitorStore.js` and
 * `journeyStore.js`: the same windows, the same numbers, the same names in the answers, so the two sites read alike.
 *
 * Two documents:
 *  - VISITORS answers "how many": who is online (a heartbeat a minute per open tab), arrivals for 7 days, one row
 *    per visitor for 30 days, and the lifetime totals.
 *  - JOURNEYS answers "why do they leave": per visit, where it came from, the pages it saw, the seconds and the
 *    scroll on each, and what it clicked. Kept 14 days.
 *
 * Pure: every function takes the document and the time. The server's copy and its storing are in `store.ts`.
 * A visitor is a hash of IP + browser (never the IP itself), so a shared router is not one visitor.
 */
import { createHash } from "node:crypto";

// How long after its last heartbeat a session is still "online"; also the gap after which the same tab is a new
// arrival. Well above the 60 s heartbeat, so nobody present flickers offline.
export const ONLINE_TTL_MS = 150_000;
const VISIT_RETENTION_MS = 7 * 24 * 3600e3;
const VISITOR_RETENTION_MS = 30 * 24 * 3600e3;
const MAX_VISITS = 20_000;
const MAX_VISITORS = 50_000;
const MAX_SESSIONS = 5_000;
/** An operator's IP stays out of the counts 30 days after they last opened the statistics. */
export const EXCLUDE_TTL_MS = 30 * 24 * 3600e3;

const JOURNEY_RETENTION_MS = 14 * 24 * 3600e3;
const MAX_JOURNEYS = 4000;
const MAX_PAGES = 40;
const MAX_EVENTS = 60;

export type VisitorsDoc = {
  sessions: Record<string, { ts: number; visitorId: string; left?: boolean }>;
  visits: { ts: number; visitorId: string }[];
  visitors: Record<string, { firstSeen: number; lastSeen: number; arrivalCount: number }>;
  /** Lifetime totals (olgoo.com keeps these as two counters beside its document). */
  totals: { visits: number; uniques: number };
};
export type Segment = { online: number; lastHour: number; last6h: number; last24h: number; last7d: number; total: number };
export const EMPTY_SEGMENT: Segment = { online: 0, lastHour: 0, last6h: 0, last24h: 0, last7d: 0, total: 0 };
export type Excluded = Record<string, { addedAt: number; expiresAt: number }>;

export const emptyVisitors = (): VisitorsDoc => ({ sessions: {}, visits: [], visitors: {}, totals: { visits: 0, uniques: 0 } });

/** Whatever was stored, as a document (a missing or damaged part is empty). */
export function asVisitors(v: unknown): VisitorsDoc {
  const d = (v && typeof v === "object" ? v : {}) as Partial<VisitorsDoc>;
  const obj = <T,>(x: unknown): Record<string, T> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, T>) : {});
  return {
    sessions: obj(d.sessions), visits: Array.isArray(d.visits) ? d.visits : [], visitors: obj(d.visitors),
    totals: { visits: Number(d.totals?.visits) || 0, uniques: Number(d.totals?.uniques) || 0 },
  };
}

const BOT_UA = [
  /\bbot\b/i, /\bcrawler?\b/i, /\bspider\b/i, /headlesschrome/i, /phantomjs/i,
  /\bcurl\b/i, /\bwget\b/i, /python-requests/i, /^Java\//i, /scrapy/i,
  /facebookexternalhit/i, /pingdom/i, /\blighthouse\b/i, /uptimerobot/i,
  /ahrefsbot/i, /semrushbot/i, /mj12bot/i, /dotbot/i, /yandex/i, /baidu/i,
  /googlebot/i, /bingbot/i, /applebot/i, /linkedinbot/i, /twitterbot/i,
  /telegrambot/i, /whatsapp/i, /slackbot/i, /discordbot/i,
];
/** A request that is almost surely not a person (no browser name at all counts as one). */
export const isBotUserAgent = (ua: string): boolean => !ua || BOT_UA.some((p) => p.test(ua));

export const visitorHash = (ip: string, ua: string): string => createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 16);

function prune(doc: VisitorsDoc, now: number) {
  for (const [sid, s] of Object.entries(doc.sessions)) if (!s || Number(s.ts || 0) <= now - ONLINE_TTL_MS) delete doc.sessions[sid];
  doc.visits = doc.visits.filter((v) => Number(v.ts || 0) > now - VISIT_RETENTION_MS);
  if (doc.visits.length > MAX_VISITS) doc.visits = doc.visits.slice(-MAX_VISITS);
  let rows = Object.entries(doc.visitors).filter(([, r]) => r && Number(r.lastSeen || 0) > now - VISITOR_RETENTION_MS);
  if (rows.length > MAX_VISITORS) rows = rows.sort((a, b) => b[1].lastSeen - a[1].lastSeen).slice(0, MAX_VISITORS);
  doc.visitors = Object.fromEntries(rows);
}

/** One heartbeat of an open tab. Changes `doc` in place. */
export function recordHeartbeat(doc: VisitorsDoc, p: { sid: string; ip: string; ua: string }, now: number): void {
  const visitorId = visitorHash(p.ip || "unknown", p.ua || "");
  const prev = doc.sessions[p.sid];
  const isNewVisit = !prev || now - Number(prev.ts || 0) > ONLINE_TTL_MS;
  // A flood of made-up tabs must not grow the document: past the cap a new one is not taken.
  if (!prev && Object.keys(doc.sessions).length >= MAX_SESSIONS) return;
  doc.sessions[p.sid] = { ts: now, visitorId };
  const known = doc.visitors[visitorId];
  doc.visitors[visitorId] = {
    firstSeen: known?.firstSeen || now, lastSeen: now,
    arrivalCount: Number(known?.arrivalCount || 0) + (isNewVisit ? 1 : 0),
  };
  if (isNewVisit) { doc.visits.push({ ts: now, visitorId }); doc.totals.visits++; }
  if (!known) doc.totals.uniques++;
  prune(doc, now);
}

/**
 * The tab closed, or went to another page of the site: offline at once. True when something changed.
 * ⚠️ The session is marked, not removed. A link that loads a whole new page sends "leave" and then, from the same
 * tab, a heartbeat; removing it made every such page a new arrival (olgoo.com counts that way; here a visit is a
 * visit).
 */
export function recordLeave(doc: VisitorsDoc, sid: string): boolean {
  const s = sid ? doc.sessions[sid] : undefined;
  if (!s || s.left) return false;
  s.left = true;
  return true;
}

/** The two rows of pills: visits and distinct visitors, L / H / S / D / W / T. */
export function getCounts(doc: VisitorsDoc, now: number): { visits: Segment; uniques: Segment } {
  const cut = { h: now - 3600e3, s: now - 6 * 3600e3, d: now - 24 * 3600e3, w: now - 7 * 24 * 3600e3 };
  let vH = 0, vS = 0, vD = 0, vW = 0;
  const uH = new Set<string>(), uS = new Set<string>(), uD = new Set<string>(), uW = new Set<string>();
  for (const v of doc.visits) {
    const ts = Number(v.ts || 0), id = String(v.visitorId || "");
    if (ts > cut.w) { vW++; if (id) uW.add(id); }
    if (ts > cut.d) { vD++; if (id) uD.add(id); }
    if (ts > cut.s) { vS++; if (id) uS.add(id); }
    if (ts > cut.h) { vH++; if (id) uH.add(id); }
  }
  let vOn = 0;
  const uOn = new Set<string>();
  for (const s of Object.values(doc.sessions)) {
    if (s.left || Number(s.ts || 0) <= now - ONLINE_TTL_MS) continue;
    vOn++;
    if (s.visitorId) uOn.add(s.visitorId);
  }
  return {
    visits: { online: vOn, lastHour: vH, last6h: vS, last24h: vD, last7d: vW, total: Math.max(doc.totals.visits, vW) },
    uniques: {
      online: uOn.size, lastHour: uH.size, last6h: uS.size, last24h: uD.size, last7d: uW.size,
      total: Math.max(doc.totals.uniques, Object.keys(doc.visitors).length),
    },
  };
}

/** The operator's summary: online, today (UTC day for "new", last 24 h for arrivals, as olgoo.com), week, lifetime. */
export function getStats(doc: VisitorsDoc, now: number) {
  const date = new Date(now).toISOString().slice(0, 10);
  const todayStart = Date.parse(`${date}T00:00:00Z`);
  const dayCut = now - 24 * 3600e3, weekCut = now - 7 * 24 * 3600e3;

  let onlineSessions = 0;
  const onlineVisitors = new Set<string>();
  for (const s of Object.values(doc.sessions)) {
    if (s.left || Number(s.ts || 0) <= now - ONLINE_TTL_MS) continue;
    onlineSessions++;
    if (s.visitorId) onlineVisitors.add(s.visitorId);
  }
  const todayVisitors = new Set<string>(), weekVisitors = new Set<string>();
  const perVisitor = new Map<string, number>();
  let todayArrivals = 0, weekArrivals = 0;
  for (const v of doc.visits) {
    const ts = Number(v.ts || 0), id = String(v.visitorId || "");
    if (ts >= dayCut) { todayArrivals++; if (id) { todayVisitors.add(id); perVisitor.set(id, (perVisitor.get(id) || 0) + 1); } }
    if (ts >= weekCut) { weekArrivals++; if (id) weekVisitors.add(id); }
  }
  let newToday = 0, newWeek = 0;
  for (const r of Object.values(doc.visitors)) {
    if (Number(r.firstSeen || 0) >= todayStart) newToday++;
    if (Number(r.firstSeen || 0) >= weekCut) newWeek++;
  }
  let onlineNewToday = 0;
  onlineVisitors.forEach((id) => { if (Number(doc.visitors[id]?.firstSeen || 0) >= todayStart) onlineNewToday++; });

  return {
    generatedAt: now,
    online: { sessions: onlineSessions, uniqueVisitors: onlineVisitors.size, newToday: onlineNewToday },
    today: {
      date, newVisitors: newToday, uniqueVisitors: todayVisitors.size, totalArrivals: todayArrivals,
      topVisitors: [...perVisitor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([visitorId, count]) => ({ visitorId, count })),
    },
    week: { newVisitors: newWeek, uniqueVisitors: weekVisitors.size, totalArrivals: weekArrivals },
    lifetime: { uniqueVisitors: Math.max(doc.totals.uniques, Object.keys(doc.visitors).length), totalArrivals: doc.totals.visits },
  };
}

// ── The operator's own traffic is not counted ───────────────────────────────

export const isExcludedIp = (list: Excluded, ip: string, now: number): boolean =>
  Boolean(ip && ip !== "unknown" && Number(list[ip]?.expiresAt || 0) > now);

/** Add an operator's IP, or push its 30 days on; expired ones go. Changes `list` in place. */
export function excludeIp(list: Excluded, ip: string, now: number): void {
  if (!ip || ip === "unknown") return;
  for (const k of Object.keys(list)) if (Number(list[k]?.expiresAt || 0) <= now) delete list[k];
  list[ip] = { addedAt: list[ip]?.addedAt || now, expiresAt: now + EXCLUDE_TTL_MS };
}

export const listExcluded = (list: Excluded, now: number) =>
  Object.entries(list).filter(([, m]) => Number(m?.expiresAt || 0) > now)
    .map(([ip, m]) => ({ ip, addedAt: m.addedAt, expiresAt: m.expiresAt })).sort((a, b) => b.addedAt - a.addedAt);

// ── Journeys ────────────────────────────────────────────────────────────────

export type Journey = {
  start: number; last: number; visitorId: string; country: string; landing: string; ref: string;
  utm?: { source: string; medium: string; campaign: string }; lang: string;
  pages: { p: string; at: number; secs: number; scroll: number }[];
  events: { n: string; p: string; at: number }[];
};
export type JourneysDoc = { journeys: Record<string, Journey> };
export type JourneyMessage = {
  sid: string; visitorId?: string; ownHost?: string; country?: string;
  view?: { page?: unknown; ref?: unknown; utm?: unknown; lang?: unknown };
  stat?: { page?: unknown; secs?: unknown; scroll?: unknown };
  event?: { name?: unknown; page?: unknown };
};

export const emptyJourneys = (): JourneysDoc => ({ journeys: {} });
export function asJourneys(v: unknown): JourneysDoc {
  const j = (v as JourneysDoc | null)?.journeys;
  return j && typeof j === "object" && !Array.isArray(j) ? { journeys: j } : emptyJourneys();
}

const clip = (s: unknown, n: number) => String(s == null ? "" : s).slice(0, n);
const cleanPage = (p: unknown) => clip(p, 120).replace(/[^\w\-./%~+]/g, "") || "/";
const cleanName = (n: unknown) => clip(n, 60).replace(/[^\w\-.:/]/g, "");

/** "https://www.google.com/search?q=…" → "google.com"; our own site, or none → "". */
export function refHost(ref: unknown, ownHost?: string): string {
  try {
    const h = new URL(String(ref)).hostname.replace(/^www\./, "").toLowerCase();
    const own = String(ownHost || "").replace(/^www\./, "").replace(/:\d+$/, "").toLowerCase();
    return !h || h === own ? "" : h.slice(0, 80);
  } catch { return ""; }
}

/** One message from the page (a page opened / its seconds and scroll / a click). True when something changed. */
export function recordJourney(doc: JourneysDoc, m: JourneyMessage, now: number): boolean {
  if (!m.sid || (!m.view && !m.stat && !m.event)) return false;
  let j = doc.journeys[m.sid];
  if (m.view) {
    const page = cleanPage(m.view.page);
    if (!j) {
      const utm = (m.view.utm && typeof m.view.utm === "object" ? m.view.utm : {}) as Record<string, unknown>;
      j = doc.journeys[m.sid] = {
        start: now, last: now, visitorId: m.visitorId || "", country: clip(m.country, 4),
        landing: page, ref: refHost(m.view.ref, m.ownHost),
        utm: clip(utm.source, 60) ? { source: clip(utm.source, 60), medium: clip(utm.medium, 60), campaign: clip(utm.campaign, 80) } : undefined,
        lang: clip(m.view.lang, 8), pages: [], events: [],
      };
    }
    if (j.pages.length < MAX_PAGES) j.pages.push({ p: page, at: now, secs: 0, scroll: 0 });
  }
  if (!j) return false; // seconds or a click of a visit that was never seen opening a page
  if (m.stat) {
    const page = cleanPage(m.stat.page);
    // The latest opening of that page takes the numbers; they only grow, so the larger is kept.
    for (let i = j.pages.length - 1; i >= 0; i--) {
      if (j.pages[i].p !== page) continue;
      j.pages[i].secs = Math.max(j.pages[i].secs, Math.min(Math.round(Number(m.stat.secs) || 0), 4 * 3600));
      j.pages[i].scroll = Math.max(j.pages[i].scroll, Math.min(Math.round(Number(m.stat.scroll) || 0), 100));
      break;
    }
  }
  if (m.event) {
    const name = cleanName(m.event.name);
    if (name && j.events.length < MAX_EVENTS) j.events.push({ n: name, p: cleanPage(m.event.page), at: now });
  }
  j.last = now;
  let rows = Object.entries(doc.journeys).filter(([, x]) => x && Number(x.last || 0) > now - JOURNEY_RETENTION_MS);
  if (rows.length > MAX_JOURNEYS) rows = rows.sort((a, b) => b[1].last - a[1].last).slice(0, MAX_JOURNEYS);
  doc.journeys = Object.fromEntries(rows);
  return true;
}

const top = (map: Map<string, number>, n = 10) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));
const bump = (map: Map<string, number>, k: string, by = 1) => map.set(k, (map.get(k) || 0) + by);

function summarize(list: Journey[]) {
  const landing = new Map<string, number>(), refs = new Map<string, number>(), sources = new Map<string, number>();
  const exits = new Map<string, number>(), events = new Map<string, number>();
  const views = new Map<string, number>(), secsOf = new Map<string, number>(), scrollOf = new Map<string, number>();
  const totals: number[] = [];
  let bounces = 0;
  for (const j of list) {
    bump(landing, j.landing);
    bump(refs, j.ref || "(direct)");
    if (j.utm?.source) bump(sources, [j.utm.source, j.utm.medium, j.utm.campaign].filter(Boolean).join(" / "));
    const last = j.pages[j.pages.length - 1];
    if (last) bump(exits, last.p);
    let secs = 0;
    for (const pg of j.pages) { secs += pg.secs; bump(views, pg.p); bump(secsOf, pg.p, pg.secs); bump(scrollOf, pg.p, pg.scroll); }
    totals.push(secs);
    for (const n of new Set(j.events.map((e) => e.n))) bump(events, n); // visits that did it, not presses
    if (j.pages.length <= 1 && !j.events.length) bounces++;
  }
  const sorted = [...totals].sort((a, b) => a - b);
  return {
    sessions: list.length,
    bounceRate: list.length ? Math.round((bounces / list.length) * 100) : 0,
    avgSecs: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0,
    medianSecs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    avgPages: list.length ? Math.round((list.reduce((a, j) => a + j.pages.length, 0) / list.length) * 10) / 10 : 0,
    landing: top(landing), referrers: top(refs), campaigns: top(sources), exits: top(exits), events: top(events, 20),
    pages: [...views.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([page, v]) => ({
      page, views: v, avgSecs: Math.round((secsOf.get(page) || 0) / v), avgScroll: Math.round((scrollOf.get(page) || 0) / v),
    })),
  };
}

/** The last 24 h and 7 days summed up, and the latest visits one by one. */
export function getJourneyStats(doc: JourneysDoc, now: number, recent = 25) {
  const all = Object.values(doc.journeys).filter((j) => j.pages?.length);
  return {
    day: summarize(all.filter((j) => j.start > now - 24 * 3600e3)),
    week: summarize(all.filter((j) => j.start > now - 7 * 24 * 3600e3)),
    latest: [...all].sort((a, b) => b.start - a.start).slice(0, recent).map((j) => ({
      start: j.start, country: j.country, lang: j.lang, ref: j.ref || "(direct)", utm: j.utm,
      pages: j.pages.map((p) => `${p.p} ${p.secs}s ${p.scroll}%`), events: j.events.map((e) => e.n),
    })),
  };
}
