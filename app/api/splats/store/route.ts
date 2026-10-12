/**
 * GET /api/splats/store?store=<id> — a store's aisles: its shelf videos in
 * order (`aislesOf`), for the walk's «‹ Previous aisle · Next aisle ›».
 * Public: they are the videos any shopper of the store walks.
 */
import { NextResponse } from "next/server";
import { listSplats, r2Config } from "@/lib/splats/r2";
import { STORE_RE, aislesOf } from "@/lib/splats/catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const NO_STORE = { "cache-control": "no-store" };
  const store = new URL(req.url).searchParams.get("store") ?? "";
  if (!STORE_RE.test(store)) return NextResponse.json({ ok: false, error: "No such store id." }, { status: 400, headers: NO_STORE });
  if (!r2Config().configured) return NextResponse.json({ ok: false, error: "R2 is not configured on this host." }, { status: 503, headers: NO_STORE });
  try {
    const keys = (await listSplats()).filter((o) => o.kind === "web").map((o) => o.key);
    return NextResponse.json({ ok: true, aisles: aislesOf(keys, store) }, { headers: NO_STORE });
  } catch (e) {
    console.error("[splats/store]", e);
    return NextResponse.json({ ok: false, error: `R2 refused the listing: ${(e as Error).message}` }, { status: 500, headers: NO_STORE });
  }
}
