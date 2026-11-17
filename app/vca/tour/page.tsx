import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import TourView from "@/components/virtual-bazaar/tour/TourPage";
import { SLUG_RE } from "@/lib/stores/store";
import { RESERVED_SLUGS, shelfTourPath } from "@/lib/stores/productLink";

// `/vca/tour?s=<store>` — a store's Shelf tour: its shelves' own photos, section by section (a store with a shelf kit), else
// the film: the camera on each shelf in turn, its products lit;
// a tap on one opens its card and «Add to basket» (owner, 2026-11-05). Noindex like a shop's walk.
// Its address is now `vbazaar.app/<store>?shelf` (owner, 2026-11-17): the old one is sent on there; the film's
// «📷 Photos» (`&view=photos`) stays here.
export const metadata: Metadata = { title: "Shelf Tour · Virtual Bazaar", robots: { index: false, follow: true } };
export const dynamic = "force-dynamic";

export default function TourPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const s = typeof searchParams.s === "string" ? searchParams.s.toLowerCase() : "";
  if (s && !searchParams.view && SLUG_RE.test(s) && !RESERVED_SLUGS.has(s)) redirect(shelfTourPath(s));
  return (
    <Suspense fallback={null}>
      <TourView />
    </Suspense>
  );
}
