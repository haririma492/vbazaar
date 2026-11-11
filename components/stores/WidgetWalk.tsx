"use client";

/**
 * The store's widget when the store has a walk (`/w/<slug>`, framed by `/widget.js`): the Free Tour itself, in the
 * frame (owner, 2026-11-11: "add the wheel so viewers can adjust the speed and look around and listen to the music
 * the widget has to perform exactly like the free tour"). `Walk360` in its `embed` mode: the arch at the top left is
 * the only link, to `/w/<slug>/go` (counted, then the store on vbazaar.app, in a new tab).
 */

import { useEffect, useState } from "react";
import Walk360 from "@/components/virtual-bazaar/walk/Walk360";

export default function WidgetWalk({ slug, walkKey }: { slug: string; walkKey: string }) {
  const [from, setFrom] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const site = q.get("from") || document.referrer || "";
    setFrom(site);
    // Counted once a load; the operator's own preview on the store's page says so and is not counted.
    if (q.get("preview") !== "1") void fetch(`/api/w/${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site }), keepalive: true }).catch(() => undefined);
  }, [slug]);
  return <Walk360 walkKey={walkKey} embed={{ go: `/w/${slug}/go${from ? `?from=${encodeURIComponent(from)}` : ""}` }} />;
}
