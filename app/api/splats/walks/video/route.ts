/**
 * GET /api/splats/walks/video?key=masters/<scene>/<file>.mov — a shop's
 * phone video (founder, 2026-10-10: the first shop interiors are filmed with
 * an iPhone), which the uploader keeps in the PRIVATE bucket. Answers with a
 * redirect to a short-lived signed link — and only for a key that a door in
 * the saved walks leads to: placing the door is the operator's choice to show
 * that one video to visitors. Every other masters key is refused, so this is
 * no way into the private bucket.
 */
import { NextRequest, NextResponse } from "next/server";
import { presignGetAny, r2Config, readWalks } from "@/lib/splats/r2";
import { isPhoneVideoKey } from "@/lib/splats/walks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Long enough to watch the shop, short enough not to be a permanent link. */
const LINK_SECONDS = 6 * 60 * 60;

export async function GET(req: NextRequest) {
  const NO_STORE = { "cache-control": "no-store" };
  const key = req.nextUrl.searchParams.get("key") || "";
  if (!isPhoneVideoKey(key)) return NextResponse.json({ ok: false, error: "Not a phone video key." }, { status: 400, headers: NO_STORE });
  if (!r2Config().configured) return NextResponse.json({ ok: false, error: "R2 is not configured on this host." }, { status: 503, headers: NO_STORE });
  try {
    const walks = await readWalks();
    const named = Object.values(walks.walks).some((w) => w.doors.some((d) => d.to === key));
    if (!named) return NextResponse.json({ ok: false, error: "No door leads to that video." }, { status: 404, headers: NO_STORE });
    return NextResponse.redirect(await presignGetAny(key, LINK_SECONDS), { status: 302, headers: NO_STORE });
  } catch (e) {
    console.error("[splats/walks/video]", e);
    return NextResponse.json({ ok: false, error: `R2 refused: ${(e as Error).message}` }, { status: 500, headers: NO_STORE });
  }
}
