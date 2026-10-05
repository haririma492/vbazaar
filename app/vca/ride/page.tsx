import type { Metadata } from "next";
import VirtualRideDemo from "@/components/virtual-bazaar/VirtualRideDemo";

// `/vca/ride` — the Virtual Ride proof of concept: the visitor types where
// they are, picks a shopping district (`lib/virtualRide/districts.ts`), and
// rides there low over the real roads in Google's photorealistic 3D city,
// landing on the pavement outside to walk on in Street View.
// `?to=world-on-yonge` preselects. Standalone like the rest of `/vca`.
export const metadata: Metadata = {
  title: "سفر مجازی — سرکوچه",
  robots: { index: false },
};

export default function VirtualRidePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const to = typeof searchParams.to === "string" ? searchParams.to : null;
  return <VirtualRideDemo toId={to} />;
}
