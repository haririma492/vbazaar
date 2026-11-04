import type { Metadata } from "next";
import { Suspense } from "react";
import ShelfTour from "@/components/virtual-bazaar/tour/ShelfTour";

// `/vca/tour?s=<store>` — a store's Shelf tour: the camera on each shelf in turn, its products lit;
// a tap on one opens its card and «Add to basket» (owner, 2026-11-05). Noindex like a shop's walk.
export const metadata: Metadata = { title: "Shelf Tour · Virtual Bazaar", robots: { index: false, follow: true } };

export default function TourPage() {
  return (
    <Suspense fallback={null}>
      <ShelfTour />
    </Suspense>
  );
}
