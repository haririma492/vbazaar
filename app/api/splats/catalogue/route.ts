/**
 * GET /api/splats/catalogue?store=<id> — a store's product list
 * (`lib/splats/catalogue.ts`): what the walk's product cards show. Public: it
 * is the price list any shopper of the store sees anyway. Read with the S3 API
 * (rewritten in place), like `/api/splats/walks`.
 */
import { NextResponse } from "next/server";
import { r2Config, readCatalogue } from "@/lib/splats/r2";
import { STORE_RE } from "@/lib/splats/catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const NO_STORE = { "cache-control": "no-store" };
  const store = new URL(req.url).searchParams.get("store") ?? "";
  if (!STORE_RE.test(store)) return NextResponse.json({ ok: false, error: "No such store id." }, { status: 400, headers: NO_STORE });
  if (!r2Config().configured) return NextResponse.json({ ok: false, error: "R2 is not configured on this host." }, { status: 503, headers: NO_STORE });
  try {
    return NextResponse.json({ ok: true, catalogue: await readCatalogue(store) }, { headers: NO_STORE });
  } catch (e) {
    console.error("[splats/catalogue]", e);
    return NextResponse.json({ ok: false, error: `R2 refused the product list: ${(e as Error).message}` }, { status: 500, headers: NO_STORE });
  }
}
