// GET /api/visitors-stats — the operator's full readout (olgoo.com's `api/visitors-stats.js`). Admin token only,
// in the `x-admin-token` header (not in the address, where it would be written into the server's log).
//
// Opening it puts the viewer's address on the excluded list for 30 days (pushed on at every look), so the
// operator's own visits, from any browser on that address, stop being counted. `?exclude=0` looks without
// registering; `?unexclude=<ip>` takes an address off the list.
//
// { generatedAt, online, today, week, lifetime, viewer: { ip, excluded }, excludedIps, journeys: { day, week, latest } }
import { NextRequest } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";
import { getJourneyStats, getStats, listExcluded } from "@/lib/visitors/rules";
import { clientIp, isIpExcluded, registerExcludedIp, unregisterExcludedIp, visitorState } from "@/lib/visitors/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAdminTokenValid(req.headers.get("x-admin-token") || "")) {
    return Response.json({ error: "Invalid admin token." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const ip = clientIp(req);
  const q = req.nextUrl.searchParams;
  const remove = q.get("unexclude");
  if (remove) await unregisterExcludedIp(remove);
  else if (q.get("exclude") !== "0") await registerExcludedIp(ip);

  const s = await visitorState();
  const now = Date.now();
  return Response.json({
    ...getStats(s.visitors, now),
    viewer: { ip, excluded: await isIpExcluded(ip) },
    excludedIps: listExcluded(s.excluded, now),
    journeys: getJourneyStats(s.journeys, now),
  }, { headers: { "cache-control": "no-store" } });
}
