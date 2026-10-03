/**
 * GET /api/splats/config — where the viewer (`/vca/splat`) fetches scenes from.
 * Public: it is the same address every scene url already shows.
 *
 * ⚠️ READ AT RUNTIME, NOT BUILD TIME. A `NEXT_PUBLIC_` variable is baked into
 * the page when it is built, so setting it on Railway did nothing until the
 * next build. This route reads it on each request (`r2Config` looks it up by a
 * computed name, which the bundler cannot inline).
 */
import { NextResponse } from "next/server";
import { r2Config } from "@/lib/splats/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ base: r2Config().publicBase || null }, { headers: { "cache-control": "no-store" } });
}
