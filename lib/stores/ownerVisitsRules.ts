/** The counting rule for owners' visits, pure (`ownerVisits.ts` stores it; tested in `ownerVisits.test.ts`). */
export type OwnerEvent = { kind: "login" | "visit"; at: string };
export type OwnerVisits = { logins: number; visits: number; lastLogin: string | null; lastVisit: string | null; firstAt: string | null; recent: OwnerEvent[] };

export const VISIT_GAP_MS = 30 * 60_000;
export const RECENT = 30;
export const empty = (): OwnerVisits => ({ logins: 0, visits: 0, lastLogin: null, lastVisit: null, firstAt: null, recent: [] });

/**
 * The counting rule, pure: a sign-in always counts, and starts a visit; a visit counts when the owner's last
 * visit began over 30 min ago (`lastSeen`, the last request this server saw, may say it is still the same sitting).
 * Null when nothing changes.
 */
export function addEvent(v: OwnerVisits, kind: OwnerEvent["kind"], now: Date, lastSeen = 0): OwnerVisits | null {
  const at = now.toISOString();
  const t = now.getTime();
  const lastStored = v.lastVisit ? Date.parse(v.lastVisit) : 0;
  const newVisit = t - Math.max(lastStored, lastSeen) >= VISIT_GAP_MS;
  if (kind === "visit" && !newVisit) return null;
  const next: OwnerVisits = { ...v, firstAt: v.firstAt ?? at, recent: [{ kind, at }, ...v.recent].slice(0, RECENT) };
  if (kind === "login") { next.logins = v.logins + 1; next.lastLogin = at; }
  if (newVisit) { next.visits = v.visits + 1; next.lastVisit = at; }
  return next;
}

