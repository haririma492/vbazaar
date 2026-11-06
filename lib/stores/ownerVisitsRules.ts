/** The counting rule for owners' visits, pure (`ownerVisits.ts` stores it; tested in `ownerVisits.test.ts`). */
export type OwnerEvent = { kind: "login" | "visit"; at: string };
/**
 * ONE RECORD PER VISIT, WITH ITS STAY (owner, 2026-11-06: "on the store owner statistics create one record per visit
 * and indicate the stay on the site on each instance"). `start` is when the sitting began, `end` the last moment the
 * owner's page was seen open (it asks every 8 s; stored about once a minute), `login` whether they signed in during it.
 */
export type OwnerSession = { start: string; end: string; login: boolean };
export type OwnerVisits = {
  logins: number; visits: number; lastLogin: string | null; lastVisit: string | null; firstAt: string | null;
  recent: OwnerEvent[]; sessions: OwnerSession[];
};

export const VISIT_GAP_MS = 30 * 60_000;
export const RECENT = 30;
/** Visits kept, newest first. */
export const SESSIONS = 200;
export const empty = (): OwnerVisits => ({ logins: 0, visits: 0, lastLogin: null, lastVisit: null, firstAt: null, recent: [], sessions: [] });

/**
 * The counting rule, pure: a sign-in always counts, and starts a visit unless one is going on; a visit starts when the
 * owner was last seen over 30 min ago (`lastSeen`, the last request this server saw, may say it is still the same
 * sitting). Inside a sitting the visit's `end` moves on. Null when nothing changes.
 */
export function addEvent(v: OwnerVisits, kind: OwnerEvent["kind"], now: Date, lastSeen = 0): OwnerVisits | null {
  const at = now.toISOString();
  const t = now.getTime();
  const sessions = v.sessions ?? [];
  const cur = sessions[0];
  const lastStored = Math.max(cur ? Date.parse(cur.end) : 0, v.lastVisit ? Date.parse(v.lastVisit) : 0);
  const newVisit = t - Math.max(lastStored, lastSeen) >= VISIT_GAP_MS;
  if (!newVisit && kind === "visit" && cur && Date.parse(cur.end) >= t) return null;
  const next: OwnerVisits = { ...v, firstAt: v.firstAt ?? at, recent: v.recent, sessions };
  if (kind === "login" || newVisit) next.recent = [{ kind, at }, ...v.recent].slice(0, RECENT);
  if (kind === "login") { next.logins = v.logins + 1; next.lastLogin = at; }
  if (newVisit || !cur) {
    next.visits = v.visits + 1;
    next.lastVisit = at;
    next.sessions = [{ start: at, end: at, login: kind === "login" }, ...sessions].slice(0, SESSIONS);
  } else {
    next.sessions = [{ ...cur, end: at, login: cur.login || kind === "login" }, ...sessions.slice(1)];
  }
  return next;
}

/** How long a visit lasted, in words: «under a minute», «12 min», «1 h 5 min». */
export function stayOf(s: OwnerSession): string {
  const m = Math.round(Math.max(0, Date.parse(s.end) - Date.parse(s.start)) / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
