/**
 * /w/<slug> — THE STORE'S WIDGET (`lib/stores/widget.ts`): the preview its own website frames through
 * `/widget.js`. For every store, the same: its Free Tour itself (the 360° walk with the wheel, the speed bar and the
 * music; owner, 2026-11-11), and the arch at the top left, the frame's only link, opens the store on vbazaar.app.
 * A store with no walk yet shows its photos and «Coming soon».
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SLUG_RE } from "@/lib/stores/store";
import { widgetPlan } from "@/lib/stores/widget";
import WidgetFrame from "@/components/stores/WidgetFrame";
import WidgetWalk from "@/components/stores/WidgetWalk";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Virtual Bazaar · بازار مجازی", robots: { index: false, follow: false } };

export default async function StoreWidget({ params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) notFound();
  const plan = await widgetPlan(params.slug).catch(() => null);
  if (!plan) notFound();
  if (plan.walkKey) return <WidgetWalk slug={params.slug} walkKey={plan.walkKey} />;
  return <WidgetFrame slug={params.slug} plan={plan} />;
}
