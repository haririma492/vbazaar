"use client";

/**
 * `/vca/tour?s=<store>`: the Shelf Tour, the film (`ShelfTour`). With `&view=photos`: the shelf-and-level
 * photos (`ShelfLevels`; owner, 2026-11-05: "they are useful let's keep them but not a substitute for a shelf tour").
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ShelfLevels from "./ShelfLevels";
import ShelfTour from "./ShelfTour";

export default function TourPage() {
  const q = useSearchParams();
  const slug = q.get("s") ?? "";
  const photos = q.get("view") === "photos";
  const [got, setGot] = useState<null | false | { shelves: Parameters<typeof ShelfLevels>[0]["data"]; name: { en: string; fa?: string } | null; walk: string | null }>(null);
  useEffect(() => {
    if (!slug || !photos) { setGot(false); return; }
    void fetch(`/api/shelves/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => setGot(j?.ok && j.shelves?.shelves?.length ? j : false)).catch(() => setGot(false));
  }, [slug, photos]);
  if (got === null) return <div className="fixed inset-0 bg-black" />;
  if (got) return <ShelfLevels slug={slug} data={got.shelves} name={got.name} walkKey={got.walk} />;
  return <ShelfTour />;
}
