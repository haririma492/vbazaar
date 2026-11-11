"use client";

/**
 * VISITOR STATISTICS ON EVERY PAGE, AND THE OPERATOR'S READOUT (owner, 2026-11-11: "add statistics collection to
 * vbazaar.app with admin mode (AAA + admin token) exactly similar to olgoo.com"). olgoo.com's `/visitor-stats.js`
 * as a component in the root layout.
 *
 * For everyone, nothing to see:
 *  - a heartbeat a minute to `/api/visitors` while the tab is open, and a leave message when it closes;
 *  - the journey: each page opened (with where the visit came from and its utm_*), the seconds it was looked at
 *    and the deepest scroll (with each heartbeat, and when the tab hides or the page changes), and clicks on `[data-track]`, on links that
 *    leave the site, on tel: and mailto:.
 *
 * For the operator, AAA (three "a" within 1.2 s, `useAdminMode`: the admin token is asked for once and checked by
 * the server) shows the readout at the top right; AAA again hides it:
 *  - two rows of pills, visits then distinct visitors: L online now, H last hour, S 6 h, D 24 h, W 7 days, T total;
 *  - Now / Today / Active / Total;
 *  - the last 24 h of journeys (visits, bounce, median seconds, pages a visit; clicks; from; left on);
 *  - the operator's own address and whether it is left out of the counts; «full readout» opens everything.
 *
 * ⚠️ NOT SHOWN BY ITSELF. olgoo.com shows the readout on every page once a token is in the browser. Here the
 * operator's browser is the one the walks are demonstrated on, so it waits for AAA. A browser that holds the token
 * is still marked (`vb_admin=1`) so its visits are never counted.
 * ⚠️ A PAGE CHANGE HERE IS NOT A PAGE LOAD (Next's router): the path is watched, and each new one is a page view.
 * Not counted: the store widget's frame (`/w/…`, shown on other sites and counted by itself), the offline demo.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { readAdminToken, useAdminMode } from "@/lib/admin/useAdminMode";
import { beacon, sessionId, track } from "@/lib/visitors/track";

const HEARTBEAT_MS = 60_000;
const STATS_MS = 60_000;
const OFFLINE = process.env.NEXT_PUBLIC_OFFLINE === "1";

type Segment = Record<"online" | "lastHour" | "last6h" | "last24h" | "last7d" | "total", number>;
type Counts = { visits: Segment; uniques: Segment };
type Top = { key: string; count: number }[];
type Day = { sessions: number; bounceRate: number; medianSecs: number; avgPages: number; events: Top; referrers: Top; exits: Top };
type Stats = {
  online?: { sessions?: number; newToday?: number }; today?: { newVisitors?: number; uniqueVisitors?: number };
  lifetime?: { uniqueVisitors?: number }; viewer?: { ip?: string; excluded?: boolean }; journeys?: { day?: Day };
};

const SEGMENTS: { key: keyof Segment; letter: string }[] = [
  { key: "online", letter: "L" }, { key: "lastHour", letter: "H" }, { key: "last6h", letter: "S" },
  { key: "last24h", letter: "D" }, { key: "last7d", letter: "W" }, { key: "total", letter: "T" },
];

const markOperator = () => { document.cookie = "vb_admin=1; path=/; max-age=31536000; SameSite=Lax"; };

function pageView(path: string) {
  const q = new URLSearchParams(window.location.search);
  let utm: Record<string, string | null> = { source: q.get("utm_source"), medium: q.get("utm_medium"), campaign: q.get("utm_campaign") };
  if (!utm.source && q.get("fbclid")) utm = { source: "facebook", medium: "click" };
  if (!utm.source && q.get("gclid")) utm = { source: "google", medium: "cpc" };
  return { page: path, ref: document.referrer || "", utm, lang: document.documentElement.lang || "" };
}

export default function VisitorStats() {
  const pathname = usePathname() || "/";
  const skip = OFFLINE || pathname.startsWith("/w/");
  const admin = useAdminMode(!skip);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  // What the page being looked at has had so far: seconds in view, deepest scroll.
  const page = useRef({ path: "", visibleMs: 0, since: 0, scroll: 0, viewSent: false });
  const adminRef = useRef(admin);
  adminRef.current = admin;
  const heartbeat = useRef<() => void>(() => {});

  // Each path: the page before it gets its seconds and scroll, the new one is a page view.
  useEffect(() => {
    if (skip) return;
    const p = page.current;
    const first = !p.path;
    if (!first && p.path !== pathname) {
      beacon({ stat: { page: p.path, secs: Math.round((p.visibleMs + (p.since ? Date.now() - p.since : 0)) / 1000), scroll: p.scroll } });
    }
    if (p.path === pathname) return;
    p.path = pathname;
    p.visibleMs = 0;
    p.since = document.visibilityState === "visible" ? Date.now() : 0;
    p.scroll = 0;
    // The first page's view goes with the first heartbeat (the effect below); a later page's goes by itself.
    if (!first) beacon({ view: pageView(pathname) });
  }, [pathname, skip]);

  // Once: the heartbeat, the leave message, seconds and scroll, clicks.
  useEffect(() => {
    if (skip) return;
    if (readAdminToken()) markOperator();
    const p = page.current;

    const scrolled = () => {
      const doc = document.documentElement;
      const h = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
      const pct = h > 0 ? Math.round(((window.scrollY || doc.scrollTop) + window.innerHeight) / h * 100) : 100;
      if (pct > p.scroll) p.scroll = Math.min(pct, 100);
    };
    const statNow = () => {
      scrolled();
      return { page: p.path, secs: Math.round((p.visibleMs + (p.since ? Date.now() - p.since : 0)) / 1000), scroll: p.scroll };
    };
    const sendStat = () => { if (p.path) beacon({ stat: statNow() }); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { if (!p.since) p.since = Date.now(); return; }
      if (p.since) { p.visibleMs += Date.now() - p.since; p.since = 0; }
      sendStat();
    };
    const onHide = () => { if (p.since) sendStat(); };
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-track],a[href]") as HTMLAnchorElement | null;
      if (!el) return;
      if (el.hasAttribute("data-track")) return track(el.getAttribute("data-track") || "");
      const href = el.getAttribute("href") || "";
      if (/^(tel|mailto):/i.test(href)) return track(href.split(":")[0].toLowerCase());
      if (el.host && el.host !== window.location.host) track("out:" + el.host.replace(/^www\./, ""));
    };
    const onUnload = () => {
      sendStat();
      try { navigator.sendBeacon?.("/api/visitors", new Blob([JSON.stringify({ sid: sessionId(), leave: true })], { type: "application/json" })); } catch { /* closing anyway */ }
    };

    heartbeat.current = () => {
      const payload: Record<string, unknown> = { sid: sessionId() };
      if (!p.viewSent && p.path) { payload.view = pageView(p.path); p.viewSent = true; }
      // The seconds and the scroll so far go with every heartbeat too: a phone often closes a tab without a word.
      else if (p.path) payload.stat = statNow();
      const token = adminRef.current ? readAdminToken() : "";
      fetch("/api/visitors", {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
        body: JSON.stringify(payload), cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Counts | null) => { if (j?.visits && j.uniques) setCounts(j); })
        .catch(() => {});
    };

    heartbeat.current();
    const timer = window.setInterval(() => heartbeat.current(), HEARTBEAT_MS);
    window.addEventListener("scroll", scrolled, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    (window as unknown as { vbTrack?: typeof track }).vbTrack = track;
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", scrolled);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [skip]);

  // Admin mode on: this browser is the operator's, the pills fill at once, the summary is asked for every minute.
  useEffect(() => {
    if (!admin) { setCounts(null); setStats(null); return; }
    markOperator();
    heartbeat.current();
    let live = true;
    const load = () => {
      fetch(`/api/visitors-stats?ts=${Date.now()}`, { headers: { "x-admin-token": readAdminToken() }, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Stats | null) => { if (live && j?.online) setStats(j); })
        .catch(() => { /* the last one stays */ });
    };
    load();
    const timer = window.setInterval(load, STATS_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [admin]);

  if (skip || !admin) return null;

  const openAll = async () => {
    try {
      const r = await fetch(`/api/visitors-stats?ts=${Date.now()}`, { headers: { "x-admin-token": readAdminToken() }, cache: "no-store" });
      const text = JSON.stringify(await r.json(), null, 2);
      window.open(URL.createObjectURL(new Blob([text], { type: "application/json" })), "_blank", "noopener");
    } catch { /* the readout on the page stays */ }
  };

  const list = (arr?: Top) => (arr ?? []).slice(0, 4).map((x) => `${x.key} ${x.count}`).join(" · ") || "—";
  const day = stats?.journeys?.day;
  const summary = stats && [
    { icon: "⚡", label: "Now", value: `${stats.online?.sessions ?? 0} (${stats.online?.newToday ?? 0} new)` },
    { icon: "🆕", label: "Today", value: `${stats.today?.newVisitors ?? 0} new` },
    { icon: "👥", label: "Active", value: String(stats.today?.uniqueVisitors ?? 0) },
    { icon: "∑", label: "Total", value: String(stats.lifetime?.uniqueVisitors ?? 0) },
  ];

  return (
    <div id="vb-visitor-stats" dir="ltr" style={S.box}>
      {counts && [counts.visits, counts.uniques].map((seg, row) => (
        <div key={row} style={{ ...S.row, borderColor: "rgba(197,155,65,0.35)" }}>
          {SEGMENTS.map((s, i) => (
            <span key={s.key} style={S.cell}>
              {i > 0 && <span style={S.divider} />}
              {s.key === "online" && row === 0 && <span style={S.dot} />}
              <span style={S.label}>{s.letter}:</span>
              <span style={S.value}>{seg?.[s.key] ?? 0}</span>
            </span>
          ))}
        </div>
      ))}
      {summary && (
        <div style={{ ...S.row, borderColor: "rgba(74,222,128,0.35)" }}>
          {summary.map((it, i) => (
            <span key={it.label} style={S.cell}>
              {i > 0 && <span style={S.divider} />}
              <span aria-hidden="true">{it.icon}</span>
              <span style={S.label}>{it.label}:</span>
              <span style={S.value}>{it.value}</span>
            </span>
          ))}
        </div>
      )}
      {day && (
        <>
          <div style={S.line}>24h: {day.sessions} visits · bounce {day.bounceRate}% · median {day.medianSecs}s · {day.avgPages} pages/visit</div>
          <div style={S.line}>clicks: {list(day.events)}</div>
          <div style={S.line}>from: {list(day.referrers)}</div>
          <div style={S.line}>left on: {list(day.exits)}</div>
        </>
      )}
      {stats?.viewer && (
        <div style={{ ...S.line, color: "rgba(255,255,255,0.55)", background: "rgba(0,0,0,0.5)", pointerEvents: "auto" }}>
          you: {stats.viewer.ip || "?"}{stats.viewer.excluded ? " · excluded ✓" : " · not excluded"}
          {" · "}
          <button type="button" onClick={openAll} style={S.link}>full readout ↗</button>
        </div>
      )}
    </div>
  );
}

const BLUR = { backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" } as const;
const S: Record<string, React.CSSProperties> = {
  box: {
    position: "fixed", right: 16, top: 92, zIndex: 2147483000, display: "flex", flexDirection: "column", alignItems: "flex-end",
    gap: 4, pointerEvents: "none", fontFamily: "Arial, sans-serif",
  },
  row: {
    display: "inline-flex", alignItems: "center", gap: 10, padding: "6px 14px", borderRadius: 20, background: "rgba(0,0,0,0.6)",
    border: "1px solid", fontSize: 13, color: "#fff", fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em", ...BLUR,
  },
  cell: { display: "inline-flex", alignItems: "center", gap: 6 },
  divider: { width: 1, height: 12, background: "rgba(255,255,255,0.25)", marginRight: 4 },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80", display: "inline-block" },
  label: { color: "rgba(255,255,255,0.55)", fontWeight: 700 },
  value: { fontWeight: 700, fontSize: 14 },
  line: {
    fontSize: 11, color: "rgba(255,255,255,0.8)", maxWidth: "min(560px, 90vw)", background: "rgba(0,0,0,0.6)", padding: "4px 12px",
    borderRadius: 12, textAlign: "right", ...BLUR,
  },
  link: { background: "none", border: 0, padding: 0, color: "#7dd3fc", font: "inherit", cursor: "pointer", textDecoration: "underline" },
};
