import type { Metadata } from "next";
import VirtualRideDemo from "@/components/virtual-bazaar/VirtualRideDemo";
import { DISTRICTS, districtById } from "@/lib/virtualRide/districts";

// `/vca/ride` — the Virtual Ride proof of concept: «Take Virtual Ride» flies
// Google's photorealistic 3D city from one shopping district to another and
// lands in the destination. Any two registered districts
// (`lib/virtualRide/districts.ts`): `?from=home&to=world-on-yonge`, the
// default. Standalone like the rest of `/vca` — nothing links here yet.
export const metadata: Metadata = {
  title: "سفر مجازی — سرکوچه",
  robots: { index: false },
};

export default function VirtualRidePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const pick = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : null);
  const from = districtById(pick("from")) ?? DISTRICTS[0];
  let to = districtById(pick("to")) ?? districtById("world-on-yonge")!;
  if (to.id === from.id) to = DISTRICTS.find((d) => d.id !== from.id)!;
  return <VirtualRideDemo fromId={from.id} toId={to.id} />;
}
