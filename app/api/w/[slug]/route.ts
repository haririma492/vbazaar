/**
 * /api/w/<slug>
 *   GET            the widget's settings for this store ({ on, place, width, lang }), which `/widget.js` asks for on
 *                  the store's own site before it draws: everything is changed on OUR side, never in the store's
 *                  code (owner, 2026-11-11). Open to any site (CORS *): nothing private in it. Never cached for long.
 *   POST { site }  the widget was seen on the store's site (counted; `lib/stores/widget.ts`).
 */
import { NextRequest, NextResponse } from "next/server";
import { SLUG_RE } from "@/lib/stores/store";
import { hit } from "@/lib/stores/widget";
import { readStore } from "@/lib/stores/bucket";
import { siteOf, widgetSettings } from "@/lib/stores/widgetRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) return NextResponse.json({ ok: false }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { site?: string };
  hit(params.slug, "view", siteOf(body.site));
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

const OPEN = { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" };

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) return NextResponse.json({ ok: false }, { status: 404, headers: OPEN });
  const s = await readStore(params.slug).catch(() => null);
  if (!s) return NextResponse.json({ ok: false }, { status: 404, headers: OPEN });
  return NextResponse.json({ ok: true, ...widgetSettings(s.widget) }, { headers: OPEN });
}
