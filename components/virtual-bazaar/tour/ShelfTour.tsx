"use client";

/**
 * THE SHELF TOUR (owner, 2026-11-05: "Camera moves logically well zoomed in on
 * each shelf then to the next shelf … fine as long as shoppers can add to the
 * basket"). The store's tour video (`lib/stores/tourJob.ts`) plays shelf by
 * shelf; each product on screen is a green light at its place
 * (`tour.items`, interpolated), and a tap on or near it opens the walk's own
 * product card (`ItemCard`): name, price, «Add to basket» into the bazaar's
 * basket. «‹ Shelf» / «Shelf ›» jump between shelves; the walk stays a link.
 *
 * ⚠️ ONE SHELF AT A TIME, AS LONG AS THE SHOPPER LIKES (owner, 2026-11-05: "Do
 * not move to next shelf until the user has asked. Let the user to explore one
 * shelf back and forth fully"). A shelf plays through once and stops on its last
 * frame (before its fade); the slider and the hold-down ◀ ▶ move along it, back
 * and forth; only «Next shelf ›» / «‹ Previous shelf» change shelf.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ItemCard } from "@/components/virtual-bazaar/walk/WalkItems";
import { checkCatalogue, type Catalogue } from "@/lib/splats/catalogue";
import type { Walk, WalkItem, WalkLabel } from "@/lib/splats/walks";
import { FADE } from "@/lib/stores/tour";

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
  const [now, setNow] = useState(0);
  const clipRef = useRef(0);
  const hold = useRef<number | null>(null);
  /** The part of clip `k` a shopper moves in: inside its fades. */
  const bounds = useCallback((k: number) => {
    const c = tour?.clips[k];
    return c ? { lo: c.at + FADE + 0.02, hi: c.at + c.len - FADE - 0.06 } : { lo: 0, hi: 0 };
  }, [tour]);
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
      setNow(t);
      // The shelf's end is a wall: playing stops there; nothing moves on to the next shelf by itself.
      const { lo, hi } = bounds(clipRef.current);
      if (t > hi + 0.02) { v.pause(); v.currentTime = hi; }
      else if (t < lo - 0.02 && !v.seeking) v.currentTime = lo;
    };
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number }) => void) => number }).requestVideoFrameCallback?.bind(v);
    const tick = () => {
      if (stop) return;
      if (rvfc) id = rvfc((_n, m) => { draw(m.mediaTime); tick(); });
      else { draw(v.currentTime); id = requestAnimationFrame(tick); }
    };
    tick();
    // The first shelf, ready at its start; it plays when the shopper taps ▶.
    const first = () => { if (v.currentTime < bounds(0).lo) v.currentTime = bounds(0).lo; };
    if (v.readyState >= 1) first(); else v.addEventListener("loadedmetadata", first, { once: true });
    const onSeek = () => draw(v.currentTime);
    v.addEventListener("seeked", onSeek);
    return () => { stop = true; cancelAnimationFrame(id); v.removeEventListener("seeked", onSeek); };
  }, [tour, bounds]);

  /** Play forward from here; at the shelf's end, from its start again. */
  function play() {
    const v = video.current;
    if (!v) return;
    const { lo, hi } = bounds(clipRef.current);
    if (v.currentTime >= hi - 0.05) v.currentTime = lo;
    void v.play();
  }
  /** Hold ◀: step back along the shelf (about walking speed) until let go. */
  function holdBack(on: boolean) {
    const v = video.current;
    if (hold.current !== null) { clearInterval(hold.current); hold.current = null; }
    if (!v || !on) return;
    v.pause();
    hold.current = window.setInterval(() => {
      const { lo } = bounds(clipRef.current);
      if (!v.seeking) v.currentTime = Math.max(lo, v.currentTime - 0.08);
    }, 60);
  }
  function holdOn(on: boolean) {
    const v = video.current;
    if (!v) return;
    if (on) play(); else v.pause();
  }

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
      if (video.current.paused) play(); else video.current.pause();
    }
  }
  /** Only the shopper changes shelf: to the next or the previous one, which then plays through once. */
  function jump(d: number) {
    if (!tour || !video.current) return;
    const k = Math.max(0, Math.min(tour.clips.length - 1, clip + d));
    clipRef.current = k;
    setClip(k);
    video.current.currentTime = tour.clips[k].at;
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
          <a className="text-white/80 underline" href={`/vca/tour?s=${encodeURIComponent(slug)}&view=photos`}>📷 Photos</a>
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
            <span className="rounded-full bg-black/55 px-5 py-3 text-[16px] font-bold">{now >= bounds(clip).hi - 0.1 ? "Drag along the shelf, or «Next shelf ›» · tap a green light to buy" : "▶ Tap to play · tap a green light to buy"}</span>
          </div>
        )}
        {card && tour && <ItemCard item={card} walkKey={tour.walk} walk={walk} catalogue={catalogue} onClose={() => setCard(null)} />}
      </div>
      {tour && (() => {
        const { lo, hi } = bounds(clip);
        const btn = "rounded-full border border-white/25 px-4 py-2 select-none touch-none";
        return (
          <div className="space-y-2 px-3 py-3 text-[15px]" dir="ltr">
            <div className="flex items-center gap-2">
              <button type="button" className={btn} aria-label="Back along the shelf"
                onPointerDown={() => holdBack(true)} onPointerUp={() => holdBack(false)} onPointerLeave={() => holdBack(false)} onPointerCancel={() => holdBack(false)}>◀</button>
              <input type="range" className="min-w-0 flex-1 accent-[#00B8C8]" aria-label="Along the shelf"
                min={lo} max={hi} step={0.04} value={Math.max(lo, Math.min(hi, now))}
                onChange={(e) => { const v = video.current; if (v) { v.pause(); v.currentTime = Number(e.target.value); } }} />
              <button type="button" className={btn} aria-label="On along the shelf"
                onPointerDown={() => holdOn(true)} onPointerUp={() => holdOn(false)} onPointerLeave={() => { if (!paused) holdOn(false); }} onPointerCancel={() => holdOn(false)}>▶</button>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button type="button" className="rounded-full border border-white/25 px-4 py-2 disabled:opacity-40" disabled={clip === 0} onClick={() => jump(-1)}>‹ Previous shelf</button>
              <span className="tabular-nums text-white/75">Shelf {clip + 1} / {tour.clips.length}</span>
              <button type="button" className="rounded-full bg-[#00B8C8] px-4 py-2 font-bold text-[#06131c] disabled:opacity-40" disabled={clip === tour.clips.length - 1} onClick={() => jump(1)}>Next shelf ›</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
