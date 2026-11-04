"use client";

/**
 * THE SHELF TOUR (owner, 2026-11-05: "Camera moves logically well zoomed in on
 * each shelf then to the next shelf … fine as long as shoppers can add to the
 * basket"). The store's tour video (`lib/stores/tourJob.ts`) plays shelf by
 * shelf; each product on screen is a green light at its place
 * (`tour.items`, interpolated), and a tap on or near it opens the walk's own
 * product card (`ItemCard`): name, price, «Add to basket» into the bazaar's
 * basket. «‹ Shelf» / «Shelf ›» jump between shelves; the walk stays a link.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ItemCard } from "@/components/virtual-bazaar/walk/WalkItems";
import { checkCatalogue, type Catalogue } from "@/lib/splats/catalogue";
import type { Walk, WalkItem, WalkLabel } from "@/lib/splats/walks";

type OnScreen = { n: number; t: number[]; x: number[]; y: number[] };
type Tour = {
  store: string; walk: string; video: string; w: number; h: number; seconds: number;
  clips: Array<{ shelf: number; at: number; len: number; products: number[] }>;
  items: OnScreen[];
};

/** Where product `o` is on screen at `t` (fractions), between its two nearest steps; null when not on screen. */
export function placeOn(o: OnScreen, t: number): { x: number; y: number } | null {
  const ts = o.t;
  let lo = 0, hi = ts.length - 1;
  if (!ts.length || t < ts[0] - 0.15 || t > ts[hi] + 0.15) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
  if (Math.abs(ts[lo] - t) > 0.3 && Math.abs(ts[hi] - t) > 0.3) return null;
  if (ts[hi] - ts[lo] > 0.45 || hi === lo) { const i = Math.abs(ts[lo] - t) < Math.abs(ts[hi] - t) ? lo : hi; return { x: o.x[i], y: o.y[i] }; }
  const k = Math.max(0, Math.min(1, (t - ts[lo]) / (ts[hi] - ts[lo])));
  return { x: o.x[lo] + (o.x[hi] - o.x[lo]) * k, y: o.y[lo] + (o.y[hi] - o.y[lo]) * k };
}

const LIGHT = 18;

export default function ShelfTour() {
  const slug = useSearchParams().get("s") ?? "";
  const [tour, setTour] = useState<Tour | null>(null);
  const [title, setTitle] = useState<WalkLabel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [card, setCard] = useState<WalkItem | null>(null);
  const [shown, setShown] = useState<Array<{ n: number; x: number; y: number }>>([]);
  const [clip, setClip] = useState(0);
  const [paused, setPaused] = useState(true);
  const video = useRef<HTMLVideoElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!slug) { setErr("No store given."); return; }
    void fetch(`/api/tour/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (j?.ok) { setTour(j.tour); setTitle(j.title); } else setErr(j?.error ?? "No tour."); })
      .catch(() => setErr("The tour could not be loaded. Check the connection and try again."));
    void fetch(`/api/splats/catalogue?store=${encodeURIComponent(`store-${slug}`)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (j?.ok && j.catalogue) setCatalogue(checkCatalogue(j.catalogue).catalogue); })
      .catch(() => { /* the cards show the product's number */ });
  }, [slug]);

  // The lights follow the frame on screen.
  useEffect(() => {
    const v = video.current;
    if (!v || !tour) return;
    let stop = false, id = 0;
    const draw = (t: number) => {
      const on: Array<{ n: number; x: number; y: number }> = [];
      for (const o of tour.items) { const p = placeOn(o, t); if (p) on.push({ n: o.n, ...p }); }
      setShown(on);
      let k = 0;
      for (const [i, c] of tour.clips.entries()) if (t >= c.at - 0.01) k = i;
      setClip(k);
    };
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number }) => void) => number }).requestVideoFrameCallback?.bind(v);
    const tick = () => {
      if (stop) return;
      if (rvfc) id = rvfc((_n, m) => { draw(m.mediaTime); tick(); });
      else { draw(v.currentTime); id = requestAnimationFrame(tick); }
    };
    tick();
    const onSeek = () => draw(v.currentTime);
    v.addEventListener("seeked", onSeek);
    return () => { stop = true; cancelAnimationFrame(id); v.removeEventListener("seeked", onSeek); };
  }, [tour]);

  /** The video's picture inside the box (object-contain): where the fractions map to. */
  const rect = useCallback(() => {
    const b = box.current?.getBoundingClientRect();
    if (!b || !tour) return null;
    const s = Math.min(b.width / tour.w, b.height / tour.h);
    const w = tour.w * s, h = tour.h * s;
    return { left: (b.width - w) / 2, top: (b.height - h) / 2, w, h, b };
  }, [tour]);

  function tap(e: React.MouseEvent) {
    const r = rect();
    if (!r) return;
    const px = e.clientX - r.b.left, py = e.clientY - r.b.top;
    let best: { n: number; d: number } | null = null;
    for (const s of shown) {
      const d = Math.hypot(r.left + s.x * r.w - px, r.top + s.y * r.h - py);
      if (d < 44 && (!best || d < best.d)) best = { n: s.n, d };
    }
    if (best) {
      video.current?.pause();
      setCard({ id: `tour-${best.n}`, n: best.n, label: { en: `#${best.n}` }, pins: [] });
    } else if (video.current) {
      if (video.current.paused) void video.current.play(); else video.current.pause();
    }
  }
  function jump(d: number) {
    if (!tour || !video.current) return;
    const k = Math.max(0, Math.min(tour.clips.length - 1, clip + d));
    video.current.currentTime = tour.clips[k].at + 0.3;
    void video.current.play();
  }

  const r = rect();
  const walk: Walk | null = tour ? { doors: [], ...(title ? { title: { en: title.en, fa: title.fa ?? title.en } } : {}) } : null;
  const name = title?.en ?? slug;
  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[14px]">
        <div className="min-w-0 truncate"><b>{name}</b>{title?.fa ? <span className="text-white/60"> · {title.fa}</span> : null} · <span className="text-white/60">Shelf Tour</span></div>
        <div className="flex shrink-0 items-center gap-3">
          {tour && (
            <span className="flex items-center rounded-full border border-white/25 bg-black/70 p-1 font-semibold">
              <span className="rounded-full bg-[#00B8C8] px-3 py-1 text-[#06131c]">🛒 Shelf Tour</span>
              <a className="rounded-full px-3 py-1 text-white/80" href={`/vca/walk?v=${encodeURIComponent(tour.walk)}`}>👣 Free Tour</a>
            </span>
          )}
          <a className="text-[#00B8C8] underline" href="/basket">Basket →</a>
        </div>
      </div>
      <div ref={box} className="relative min-h-0 flex-1" onClick={tap}>
        {err && <p className="p-6 text-center text-amber-200">{err}</p>}
        {tour && (
          <video ref={video} src={tour.video} className="absolute inset-0 h-full w-full object-contain" playsInline preload="auto"
            onPlay={() => setPaused(false)} onPause={() => setPaused(true)} />
        )}
        {r && shown.map((s) => (
          <span key={s.n} className="pointer-events-none absolute rounded-full bg-[#22e05a]"
            style={{ width: LIGHT, height: LIGHT, left: r.left + s.x * r.w - LIGHT / 2, top: r.top + s.y * r.h - LIGHT / 2 }} />
        ))}
        {tour && paused && !card && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-black/55 px-5 py-3 text-[16px] font-bold">▶ Play · tap a green light to buy</span>
          </div>
        )}
        {card && tour && <ItemCard item={card} walkKey={tour.walk} walk={walk} catalogue={catalogue} onClose={() => setCard(null)} />}
      </div>
      {tour && (
        <div className="flex items-center justify-center gap-3 px-3 py-3 text-[15px]">
          <button type="button" className="rounded-full border border-white/25 px-4 py-2" onClick={() => jump(-1)}>‹ Shelf</button>
          <span className="tabular-nums text-white/75">Shelf {clip + 1} / {tour.clips.length}</span>
          <button type="button" className="rounded-full border border-white/25 px-4 py-2" onClick={() => jump(1)}>Shelf ›</button>
        </div>
      )}
    </div>
  );
}
