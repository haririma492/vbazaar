import type { Metadata } from "next";
import Walk360 from "@/components/virtual-bazaar/walk/Walk360";

// `/vca/walk` — the Virtual Bazaar as the operator walked it: a 360° video
// played forward and back with the stick, looked round with a finger or the
// phone. The real footage, at the camera's quality, along the camera's path —
// the alternative to the Gaussian-splat scenes of `/vca/splat`. Videos are
// uploaded at `/operator/splats` (an .mp4) and opened with ?v=<key>.
export const metadata: Metadata = {
  title: "قدم زدن ۳۶۰ — سرکوچه",
  robots: { index: false },
};

export default function WalkPage() {
  return <Walk360 />;
}
