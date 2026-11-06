/**
 * /w/<slug> — THE STORE'S WIDGET (`lib/stores/widget.ts`): the preview its own website frames through
 * `/widget.js`. For every store. A teaser only: the visit itself is on vbazaar.app (the key opens it in a new tab).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SLUG_RE } from "@/lib/stores/store";
import { widgetPlan } from "@/lib/stores/widget";
import WidgetFrame from "@/components/stores/WidgetFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Virtual Bazaar · بازار مجازی", robots: { index: false, follow: false } };

export default async function StoreWidget({ params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) notFound();
  const plan = await widgetPlan(params.slug).catch(() => null);
  if (!plan) notFound();
  return <WidgetFrame slug={params.slug} plan={plan} />;
}
