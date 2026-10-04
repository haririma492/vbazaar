import type { Metadata } from "next";
import SplatVR from "@/components/virtual-bazaar/splat/SplatVR";

// `/vr` — the Virtual Bazaar's splat tour in a VR headset (WebXR): «Enter VR»
// in the headset's browser, then walk the paths, window-shop, and point at
// exits and shop doors with a controller or a hand. The same tour, scenes and
// paths as `/vca/splat` (managed at `/operator/splats`).
export const metadata: Metadata = {
  title: "بازار مجازی در واقعیت مجازی — سرکوچه",
  robots: { index: false },
};

export default function VRPage() {
  return <SplatVR />;
}
