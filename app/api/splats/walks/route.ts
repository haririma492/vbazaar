/**
 * GET /api/splats/walks — the walks (`lib/splats/walks.ts`): which doors along
 * the 360° street walk lead into which shop's video, and the walk visitors
 * start on. Public: it is what any visitor of `/vca/walk` is shown anyway.
 *
 * Read with the S3 API, not through the bucket's public address, for the
 * tour's reason (`/api/splats/tour`): `scenes/walks.json` is rewritten in
 * place, and Cloudflare's cache could hand out the one from before the save.
 */
import { NextResponse } from "next/server";
import { r2Config, readWalks } from "@/lib/splats/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const NO_STORE = { "cache-control": "no-store" };
  if (!r2Config().configured) return NextResponse.json({ ok: false, error: "R2 is not configured on this host." }, { status: 503, headers: NO_STORE });
  try {
    return NextResponse.json({ ok: true, walks: await readWalks() }, { headers: NO_STORE });
  } catch (e) {
    console.error("[splats/walks]", e);
    return NextResponse.json({ ok: false, error: `R2 refused the walks: ${(e as Error).message}` }, { status: 500, headers: NO_STORE });
  }
}
