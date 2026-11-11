// VISITOR STATISTICS (owner, 2026-11-11: "exactly similar to olgoo.com"; olgoo.com's `api/visitors.js`).
//
//   POST { sid }                         a heartbeat from an open tab, one a minute
//   POST { sid, view | stat | event }    the journey: a page opened / its seconds and scroll / a click
//   POST { sid, beacon: true, … }        journey only, not a heartbeat (sent as the tab hides or closes)
//   POST { sid, leave: true }            the tab closed
//   GET                                  the counts
//
// Everyone gets { ok: true }. The counts ({ visits, uniques }) go only to a request carrying the admin token
// (`x-admin-token`; olgoo.com trusts a cookie for this, which anyone can set). The operator's own visits are
// never counted: the admin token, the `vb_admin=1` cookie their browser keeps, an address that opened the
// statistics in the last 30 days, or one named in EXCLUDED_IPS. Bots are not counted. Counting never fails a page.
import { NextRequest } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";
import { EMPTY_SEGMENT, getCounts, isBotUserAgent, recordHeartbeat, recordJourney, recordLeave, visitorHash } from "@/lib/visitors/rules";
import { clientIp, isIpExcluded, touch, visitorState } from "@/lib/visitors/store";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

// At most 120 messages a minute from one address: a page sends two or three.
const LIMIT = 120;
const hits = new Map<string, { at: number; n: number }>();
function tooMany(ip: string, now: number): boolean {
  if (hits.size > 5000) hits.clear();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) { hits.set(ip, { at: now, n: 1 }); return false; }
  return ++h.n > LIMIT;
}

const isAdmin = (req: NextRequest) => isAdminTokenValid(req.headers.get("x-admin-token") || "");
const hasAdminCookie = (req: NextRequest) => req.cookies.get("vb_admin")?.value === "1";

async function answer(admin: boolean) {
  if (!admin) return Response.json({ ok: true }, { headers: NO_STORE });
  try { return Response.json(getCounts((await visitorState()).visitors, Date.now()), { headers: NO_STORE }); }
  catch { return Response.json({ visits: EMPTY_SEGMENT, uniques: EMPTY_SEGMENT }, { headers: NO_STORE }); }
}

export async function GET(req: NextRequest) {
  return answer(isAdmin(req));
}

export async function POST(req: NextRequest) {
  const admin = isAdmin(req);
  const now = Date.now();
  const ip = clientIp(req);
  if (!admin && tooMany(ip, now)) return Response.json({ ok: true }, { headers: NO_STORE });
  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const sid = String(body.sid || "anon").slice(0, 48);
    const ua = req.headers.get("user-agent") || "";
    const counted = !admin && !hasAdminCookie(req) && !isBotUserAgent(ua) && !(await isIpExcluded(ip));
    const s = await visitorState();
    const { view, stat, event } = body as { view?: object; stat?: object; event?: object };
    if (counted && (view || stat || event)) {
      const changed = recordJourney(s.journeys, {
        sid, visitorId: visitorHash(ip, ua), ownHost: req.headers.get("x-forwarded-host") || req.headers.get("host") || "",
        country: req.headers.get("cf-ipcountry") || "", view, stat, event,
      }, now);
      if (changed) touch("journeys");
    }
    if (body.leave) {
      if (recordLeave(s.visitors, sid)) touch("visitors");
    } else if (counted && !body.beacon) {
      recordHeartbeat(s.visitors, { sid, ip, ua }, now);
      touch("visitors");
    }
  } catch (e) {
    console.error("[visitors]", e);
  }
  return answer(admin);
}
