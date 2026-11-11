/**
 * VISITOR STATISTICS, THE SERVER'S COPY. olgoo.com keeps its documents in Redis and writes on every heartbeat;
 * here the store is the bucket (R2, masters, `analytics/…json`), where a write a heartbeat would be slow and cost
 * money. So the documents live in this server's memory, read from the bucket once, and are written back at most
 * once every 30 s while something changed. A restart (a deploy) loses at most those 30 s.
 *
 * ⚠️ ONE SERVER. vbazaar.app runs one `next start`; two would each hold their own copy and overwrite each other.
 * ⚠️ A FAILED READ IS NOT AN EMPTY DOCUMENT. If the bucket cannot be read, counting goes on in memory but nothing
 * is written (that would wipe the stored totals), and the read is tried again a minute later.
 */
import { r2Config, readMastersText, writeMastersJson } from "@/lib/splats/r2";
import {
  asJourneys, asVisitors, emptyJourneys, emptyVisitors, excludeIp, isExcludedIp,
  type Excluded, type JourneysDoc, type VisitorsDoc,
} from "./rules";

const KEYS = { visitors: "analytics/visitors.json", journeys: "analytics/journeys.json", excluded: "analytics/excluded-ips.json" } as const;
type Part = keyof typeof KEYS;
type State = { visitors: VisitorsDoc; journeys: JourneysDoc; excluded: Excluded; stored: boolean };

const FLUSH_MS = 30_000;
const RETRY_MS = 60_000;

// On `globalThis`: Next builds each route apart, and they must share the one copy.
const g = globalThis as typeof globalThis & { __vbVisitors?: { state: Promise<State> | null; failedAt: number; dirty: Set<Part>; timer: ReturnType<typeof setTimeout> | null } };
const mem = (g.__vbVisitors ??= { state: null, failedAt: 0, dirty: new Set<Part>(), timer: null });

async function load(): Promise<State> {
  const blank = (stored: boolean): State => ({ visitors: emptyVisitors(), journeys: emptyJourneys(), excluded: {}, stored });
  const cfg = r2Config();
  if (!cfg.configured || cfg.offline) return blank(false);
  try {
    const [v, j, e] = await Promise.all((Object.keys(KEYS) as Part[]).map(async (p) => { const t = await readMastersText(KEYS[p]); return t ? JSON.parse(t) as unknown : null; }));
    return { visitors: asVisitors(v), journeys: asJourneys(j), excluded: (e && typeof e === "object" ? e : {}) as Excluded, stored: true };
  } catch (err) {
    console.error("[visitors] could not read the stored statistics; counting in memory only", err);
    mem.failedAt = Date.now();
    return blank(false);
  }
}

/** The documents, to read or change in place; after a change call `touch`. */
export async function visitorState(): Promise<State> {
  // A read that failed: once a minute, try again, and carry over what was counted meanwhile only if still failing.
  if (mem.state && mem.failedAt && Date.now() - mem.failedAt > RETRY_MS) {
    mem.failedAt = 0;
    const again = load();
    const s = await again;
    if (s.stored) mem.state = again;
  }
  return (mem.state ??= load());
}

/** Something changed in this part: it will be written within 30 s. */
export function touch(...parts: Part[]): void {
  for (const p of parts) mem.dirty.add(p);
  if (mem.timer) return;
  mem.timer = setTimeout(() => { mem.timer = null; void flush(); }, FLUSH_MS);
  mem.timer.unref?.();
}

async function flush(): Promise<void> {
  const s = await visitorState();
  const parts = [...mem.dirty];
  mem.dirty.clear();
  if (!s.stored) return;
  for (const p of parts) {
    try { await writeMastersJson(KEYS[p], s[p]); }
    catch (err) { console.error("[visitors] not stored:", p, err); mem.dirty.add(p); }
  }
  if (mem.dirty.size) touch();
}

/** The operator's own traffic: an address that opened the statistics (30 days), or one named in EXCLUDED_IPS. */
export async function isIpExcluded(ip: string): Promise<boolean> {
  if ((process.env.EXCLUDED_IPS || "").split(",").map((x) => x.trim()).filter(Boolean).includes(ip)) return true;
  return isExcludedIp((await visitorState()).excluded, ip, Date.now());
}

export async function registerExcludedIp(ip: string): Promise<void> {
  const s = await visitorState();
  const before = s.excluded[ip]?.expiresAt || 0;
  excludeIp(s.excluded, ip, Date.now());
  // Pushing the 30 days on is stored once a day, not on every look.
  if ((s.excluded[ip]?.expiresAt || 0) - before > 24 * 3600e3) touch("excluded");
}

export async function unregisterExcludedIp(ip: string): Promise<void> {
  const s = await visitorState();
  if (!s.excluded[ip]) return;
  delete s.excluded[ip];
  touch("excluded");
}

/** The caller's address (Railway puts it first in x-forwarded-for). */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
