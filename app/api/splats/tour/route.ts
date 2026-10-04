/**
 * GET /api/splats/tour — the tour (`lib/splats/tour.ts`) for the viewer, read
 * from R2 by this server rather than through the bucket's public address.
 * Public: it is what any visitor of `/vca/splat` is shown anyway.
 *
 * ⚠️ NOT THROUGH r2.dev. `scenes/tour.json` is rewritten in place on every
 * save, and the public address sits behind Cloudflare's cache: a visitor could
 * be handed the tour from before the last save (even the "no such file" from
 * before the first one). Read with the S3 API, it is always the saved one.
 */
import { NextResponse } from "next/server";
import { r2Config, readTour } from "@/lib/splats/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const NO_STORE = { "cache-control": "no-store" };
  if (!r2Config().configured) return NextResponse.json({ ok: false, error: "R2 is not configured on this host." }, { status: 503, headers: NO_STORE });
  try {
    return NextResponse.json({ ok: true, tour: await readTour() }, { headers: NO_STORE });
  } catch (e) {
    console.error("[splats/tour]", e);
    return NextResponse.json({ ok: false, error: `R2 refused the tour: ${(e as Error).message}` }, { status: 500, headers: NO_STORE });
  }
}
