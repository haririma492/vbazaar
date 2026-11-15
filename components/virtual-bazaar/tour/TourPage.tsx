"use client";

/**
 * `/vca/tour?s=<store>`: the Shelf Tour. A store with a shelf kit (its shelves' quality photos, sections and products;
 * owner, 2026-11-15, the pastry redesign) gets the tour made from those photos (`KitShelfTour`: no video). Any other
 * store keeps the film (`ShelfTour`). With `&view=photos`: the shelf-and-level photos (`ShelfLevels`; owner,
 * 2026-11-05: "they are useful let's keep them but not a substitute for a shelf tour").
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import KitShelfTour from "@/components/kit/KitShelfTour";
import { kitReady, type ShopKit } from "@/lib/stores/kitRules";
import ShelfLevels from "./ShelfLevels";
import ShelfTour from "./ShelfTour";

export default function TourPage() {
  const q = useSearchParams();
  const slug = q.get("s") ?? "";
  const photos = q.get("view") === "photos";
  const [got, setGot] = useState<null | false | { shelves: Parameters<typeof ShelfLevels>[0]["data"]; name: { en: string; fa?: string } | null; walk: string | null }>(null);
  /** null while asked; false: no kit (the film). */
  const [kit, setKit] = useState<ShopKit | null | false>(null);
  useEffect(() => {
    if (!slug || !photos) { setGot(false); return; }
    void fetch(`/api/shelves/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => setGot(j?.ok && j.shelves?.shelves?.length ? j : false)).catch(() => setGot(false));
  }, [slug, photos]);
  useEffect(() => {
    if (!slug || photos) { setKit(false); return; }
    let gone = false;
    void fetch(`/api/kit/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (!gone) setKit(j?.ok && kitReady(j.kit) ? (j.kit as ShopKit) : false); })
      .catch(() => { if (!gone) setKit(false); });
    return () => { gone = true; };
  }, [slug, photos]);
  if (got === null || kit === null) return <div className="fixed inset-0 bg-black" />;
  if (got) return <ShelfLevels slug={slug} data={got.shelves} name={got.name} walkKey={got.walk} />;
  if (kit) return <KitShelfTour slug={slug} kit={kit} />;
  return <ShelfTour />;
}
