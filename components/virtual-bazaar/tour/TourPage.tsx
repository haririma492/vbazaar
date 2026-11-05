"use client";

/** `/vca/tour?s=<store>`: the Shelf Tour by shelf and level when the store has one (`ShelfLevels`), else the video tour (`ShelfTour`). */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ShelfLevels from "./ShelfLevels";
import ShelfTour from "./ShelfTour";

export default function TourPage() {
  const slug = useSearchParams().get("s") ?? "";
  const [got, setGot] = useState<null | false | { shelves: Parameters<typeof ShelfLevels>[0]["data"]; name: { en: string; fa?: string } | null; walk: string | null }>(null);
  useEffect(() => {
    if (!slug) { setGot(false); return; }
    void fetch(`/api/shelves/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => setGot(j?.ok && j.shelves?.shelves?.length ? j : false)).catch(() => setGot(false));
  }, [slug]);
  if (got === null) return <div className="fixed inset-0 bg-black" />;
  if (got) return <ShelfLevels slug={slug} data={got.shelves} name={got.name} walkKey={got.walk} />;
  return <ShelfTour />;
}
