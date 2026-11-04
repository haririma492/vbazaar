"use client";

/**
 * THE SHELF TOUR, ON THE STORE'S PAGE (owner, 2026-11-05). The operator builds
 * it (free: ffmpeg on the sightings the finder already made) and watches it;
 * shoppers open it at `/vca/tour?s=<store>`, tap a green light, add to basket.
 */

import { useCallback, useEffect, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";

type Tour = { made: string; seconds: number; shelves: number; products: number; video: string; walk: string };

export default function TourCard({ api, operator }: { api: string; operator: boolean }) {
  const [tour, setTour] = useState<Tour | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [page, setPage] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const j = await postJson<{ tour: Tour | null; working: boolean; note: string; page: string }>(api, { action: "tour" });
      setTour(j.tour); setWorking(j.working ? j.note || "working…" : null); setPage(j.page);
    } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);
  async function build() {
    try { await postJson(api, { action: "tourBuild" }); setSaid({ ok: true, text: "Building the Shelf Tour… a few minutes; this card updates by itself. · در حال ساخت…" }); void load(); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  }
  const mm = (x: number) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, "0")}`;
  return (
    <Card>
      <Bi fa="گشت قفسه‌به‌قفسه" en="Shelf Tour — the camera on each shelf in turn; shoppers tap a light to add to basket" className="text-[15px] font-bold text-amber-100" />
      <div dir="ltr" className="mt-3 space-y-1 text-left text-[14px]">
        {working ? <p className="text-amber-200">Working: {working}</p>
          : tour ? (
            <>
              <p>{tour.shelves} shelves · {mm(tour.seconds)} · {tour.products} products lit.</p>
              <p><a className="text-[#00B8C8] underline" href={page} target="_blank" rel="noopener">Watch the Shelf Tour ↗</a> <span className="text-white/45">(what shoppers see; tap a green light)</span></p>
              <p className="text-white/40">Made {new Date(tour.made).toLocaleString()}.</p>
            </>
          ) : <p className="text-white/60">Not built yet.</p>}
        <p className="text-white/45">How: the finder&apos;s sightings grouped into shelves in walking order; a shelf seen twice keeps its closest visit; for each, 3–6 s round the moment its products are biggest, a camera aimed at them and zoomed to fit, cut from the original upload. Free.</p>
      </div>
      {operator && !working && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={tour ? QUIET : KEY} onClick={() => void build()}>{tour ? "Build again · دوباره" : "Build the Shelf Tour · ساخت"}</button>
        </div>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
