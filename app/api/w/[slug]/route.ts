/** /api/w/<slug> — POST { site }: the widget was seen on the store's site (counted; `lib/stores/widget.ts`). */
import { NextRequest, NextResponse } from "next/server";
import { SLUG_RE } from "@/lib/stores/store";
import { hit } from "@/lib/stores/widget";
import { siteOf } from "@/lib/stores/widgetRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) return NextResponse.json({ ok: false }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { site?: string };
  hit(params.slug, "view", siteOf(body.site));
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
