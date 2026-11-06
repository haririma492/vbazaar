/**
 * /w/<slug>/go — the widget's key: counted as a click, then on to the store's visit on vbazaar.app (its Free Tour,
 * or the bazaar's front door while the store is not published yet). The snippet's no-script link comes here too.
 */
import { NextRequest, NextResponse } from "next/server";
import { SLUG_RE } from "@/lib/stores/store";
import { hit, widgetPlan } from "@/lib/stores/widget";
import { WIDGET_ORIGIN, siteOf } from "@/lib/stores/widgetRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || WIDGET_ORIGIN;
  if (!SLUG_RE.test(params.slug)) return NextResponse.redirect(new URL("/", base), 302);
  const plan = await widgetPlan(params.slug).catch(() => null);
  if (!plan) return NextResponse.redirect(new URL("/", base), 302);
  hit(params.slug, "click", siteOf(req.nextUrl.searchParams.get("from") || req.headers.get("referer")));
  const to = new URL(plan.go, base);
  to.searchParams.set("utm_source", "store-widget");
  to.searchParams.set("utm_medium", params.slug);
  return NextResponse.redirect(to, 302);
}
