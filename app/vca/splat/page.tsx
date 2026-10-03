import type { Metadata } from "next";
import SplatTour from "@/components/virtual-bazaar/splat/SplatTour";

// `/vca/splat` — the Virtual Bazaar as real places: Gaussian-splat scenes from
// R2, linked by exits the visitor chooses, drawn by Spark in our own Three.js
// renderer with its load and frame-rate numbers on screen. `/vca` itself is
// untouched until this works on real phones. Scenes and the tour are managed
// at `/operator/splats`.
export const metadata: Metadata = {
  title: "بازار مجازی (اسپلت) — سرکوچه",
  robots: { index: false },
};

export default function SplatTourPage() {
  return <SplatTour />;
}
