/**
 * PUT /api/operator/splats/part?key=…&uploadId=…&partNumber=… — one upload part,
 * relayed to R2 by this server. x-admin-token. The body is the part's bytes;
 * the answer is `{ etag }`.
 *
 * The fallback for `/operator/splats` when the browser may not PUT to R2
 * itself (`lib/splats/r2.ts`, `uploadPartBytes`). Parts are at most a few tens
 * of MB (`partPlan`), so one is held in memory at a time.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";
import { isSplatKey } from "@/lib/splats/keys";
import { r2Config, uploadPartBytes } from "@/lib/splats/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
/** Bigger than any part `partPlan` makes for a file R2 accepts, with room. */
const MAX_PART_BYTES = 600 * 1024 * 1024;

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

export async function PUT(req: NextRequest) {
  if (!isAdminTokenValid(req.headers.get("x-admin-token") || "")) return fail(401, "Unauthorized");
  if (!r2Config().configured) return fail(503, "R2 is not configured on this host.");
  const q = req.nextUrl.searchParams;
  const key = q.get("key") || "";
  const kind = isSplatKey(key);
  const uploadId = q.get("uploadId") || "";
  const partNumber = Number(q.get("partNumber"));
  if (!kind) return fail(400, "Not a splat key.");
  if (!uploadId || uploadId.length > 1024) return fail(400, "No upload id.");
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return fail(400, "Part number 1–10000.");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_PART_BYTES) return fail(413, "Part too large.");
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > MAX_PART_BYTES) return fail(400, "Empty or oversized part.");
    const etag = await uploadPartBytes(kind, key, uploadId, partNumber, body);
    return NextResponse.json({ ok: true, etag }, { headers: NO_STORE });
  } catch (e) {
    console.error("[operator/splats/part]", e);
    // 500, not 502: a 502 is swapped for a bare page by the proxy in front.
    return fail(500, `R2 refused the part: ${(e as Error).message}`);
  }
}
