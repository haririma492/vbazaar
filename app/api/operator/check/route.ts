/**
 * GET /api/operator/check — does this browser's admin token open anything?
 * 204 if it does, 401 if not. AAA asks this before arming admin mode, so a
 * mistyped token is refused at the keyboard rather than after the first click.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ok = isAdminTokenValid(req.headers.get("x-admin-token") || "");
  return new NextResponse(null, { status: ok ? 204 : 401, headers: { "cache-control": "no-store" } });
}
