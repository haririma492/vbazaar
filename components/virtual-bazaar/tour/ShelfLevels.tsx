"use client";

/**
 * THE SHELF TOUR, BY SHELF AND LEVEL (owner, 2026-11-05: "we need decouple the
 * existing route and create a new route that is focused on each shelf and each
 * level of each shelf"). Not the camera's path: still pictures cut from the
 * recording (`lib/stores/levelsJob.ts`), one of each whole shelf with its levels
 * outlined, then one of each level, top to bottom. The shopper moves: ▲ ▼ between
 * levels, ‹ › between shelves (or taps a level on the shelf); nothing moves on by
 * itself. Every product is a green light at the exact place it was boxed; a tap
 * on it (anywhere on the product) opens the walk's own card, «Add to basket».
 */

import TourBazaarLink from "@/components/brand/TourBazaarLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { ItemCard } from "@/components/virtual-bazaar/walk/WalkItems";
import { checkCatalogue, type Catalogue } from "@/lib/splats/catalogue";
import type { Walk, WalkItem } from "@/lib/splats/walks";

type Item = { n: number; x: number; y: number; w: number; h: number };
type Still = { img: string; w: number; h: number; items: Item[] };
type Shelves = { store: string; shelves: Array<Still & { levels: Array<Still & { box: { x: number; y: number; w: number; h: number } }> }> };

const LIGHT = 16;

export default function ShelfLevels({ slug, data, name, walkKey }: { slug: string; data: Shelves; name: { en: string; fa?: string } | null; walkKey: string | null }) {
  const [at, setAt] = useState<{ s: number; l: number }>({ s: 0, l: -1 }); // l = -1: the whole shelf
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [card, setCard] = useState<WalkItem | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetch(`/api/splats/catalogue?store=${encodeURIComponent(`store-${slug}`)}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (j?.ok && j.catalogue) setCatalogue(checkCatalogue(j.catalogue).catalogue); })
      .catch(() => { /* the cards show the product's number */ });
  }, [slug]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shelf = data.shelves[at.s];
  const still: Still = at.l < 0 ? shelf : shelf.levels[at.l];
  // The picture inside the box (contain): where the fractions map to.
  const k = size.w && size.h ? Math.min(size.w / still.w, size.h / still.h) : 0;
  const pw = still.w * k, ph = still.h * k, left = (size.w - pw) / 2, top = (size.h - ph) / 2;

  const go = useCallback((d: { s?: number; l?: number }) => {
    setCard(null);
    setAt((a) => {
      if (d.s !== undefined) { const s = Math.max(0, Math.min(data.shelves.length - 1, a.s + d.s)); return { s, l: -1 }; }
      if (d.l !== undefined) { const n = data.shelves[a.s].levels.length; return { s: a.s, l: Math.max(-1, Math.min(n - 1, a.l + d.l)) }; }
      return a;
    });
  }, [data]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") go({ l: 1 }); else if (e.key === "ArrowUp") go({ l: -1 });
      else if (e.key === "ArrowRight") go({ s: 1 }); else if (e.key === "ArrowLeft") go({ s: -1 });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go]);

  function tap(e: React.MouseEvent) {
    if (!box.current || !k) return;
    const r = box.current.getBoundingClientRect();
    const fx = (e.clientX - r.left - left) / pw, fy = (e.clientY - r.top - top) / ph;
    // A product: anywhere on it, else the nearest light within reach.
    const hit = still.items.find((it) => Math.abs(fx - it.x) <= it.w / 2 && Math.abs(fy - it.y) <= it.h / 2)
      ?? still.items.map((it) => ({ it, d: Math.hypot((fx - it.x) * pw, (fy - it.y) * ph) })).filter((x) => x.d < 36).sort((a, b) => a.d - b.d)[0]?.it;
    if (hit && (at.l >= 0 || !shelf.levels.length)) { setCard({ id: `shelf-${hit.n}`, n: hit.n, label: { en: `#${hit.n}` }, pins: [] }); return; }
    // On the whole shelf: a tap on a level goes to it.
    if (at.l < 0) {
      const j = shelf.levels.findIndex((lv) => fx >= lv.box.x && fx <= lv.box.x + lv.box.w && fy >= lv.box.y && fy <= lv.box.y + lv.box.h);
      if (j >= 0) setAt({ s: at.s, l: j });
      else if (hit) setCard({ id: `shelf-${hit.n}`, n: hit.n, label: { en: `#${hit.n}` }, pins: [] });
    }
  }

  const walk: Walk | null = name ? { doors: [], title: { en: name.en, fa: name.fa ?? name.en } } : { doors: [] };
  const btn = "rounded-full border border-white/25 px-4 py-2 disabled:opacity-35";
  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[14px]">
        {/* The bazaar's logo on the right (owner, 2026-11-06); the header is right-to-left, so it comes first. */}
        <TourBazaarLink />
        <div className="me-auto min-w-0 flex-1 truncate"><b>{name?.en ?? slug}</b>{name?.fa ? <span className="text-white/60"> · {name.fa}</span> : null}</div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center rounded-full border border-white/25 bg-black/70 p-1 font-semibold">
            <span className="rounded-full bg-[#00B8C8] px-3 py-1 text-[#06131c]">🛒 Shelf Tour</span>
            {walkKey && <a className="rounded-full px-3 py-1 text-white/80" href={`/vca/walk?v=${encodeURIComponent(walkKey)}`}>👣 Free Tour</a>}
          </span>
          <a className="text-white/80 underline" href={`/vca/tour?s=${encodeURIComponent(slug)}`}>🎬 Back to the Shelf Tour</a>
          <a className="text-[#00B8C8] underline" href="/basket">Basket →</a>
        </div>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 select-none" onClick={tap}>
        {k > 0 && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={still.img} src={still.img} alt={at.l < 0 ? `Shelf ${at.s + 1}` : `Shelf ${at.s + 1}, level ${at.l + 1}`} draggable={false}
              className="absolute animate-[fadein_.35s_ease-out]" style={{ left, top, width: pw, height: ph }} />
            {at.l < 0 && shelf.levels.map((lv, j) => (
              <span key={j} className="pointer-events-none absolute rounded border-2 border-[#00B8C8]/80"
                style={{ left: left + lv.box.x * pw, top: top + lv.box.y * ph, width: lv.box.w * pw, height: lv.box.h * ph }}>
                <span className="absolute -left-0.5 -top-6 rounded bg-[#00B8C8] px-1.5 text-[12px] font-bold text-[#06131c]">Level {j + 1}</span>
              </span>
            ))}
            {still.items.map((it) => (
              <span key={it.n} className="pointer-events-none absolute rounded-full bg-[#22e05a]"
                style={{ width: LIGHT, height: LIGHT, left: left + it.x * pw - LIGHT / 2, top: top + it.y * ph - LIGHT / 2 }} />
            ))}
          </>
        )}
        {card && <ItemCard item={card} walkKey={walkKey ?? ""} walk={walk} catalogue={catalogue} onClose={() => setCard(null)} />}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-3 text-[15px]" dir="ltr">
        <button type="button" className={btn} disabled={at.s === 0} onClick={() => go({ s: -1 })}>‹ Shelf</button>
        <button type="button" className={btn} disabled={at.l <= -1} onClick={() => go({ l: -1 })}>▲ {at.l === 0 ? "Whole shelf" : "Level up"}</button>
        <span className="min-w-[9rem] text-center tabular-nums text-white/80">
          Shelf {at.s + 1}/{data.shelves.length} · {at.l < 0 ? "whole shelf" : `level ${at.l + 1}/${shelf.levels.length}`}
        </span>
        <button type="button" className="rounded-full bg-[#00B8C8] px-4 py-2 font-bold text-[#06131c] disabled:opacity-35" disabled={at.l >= shelf.levels.length - 1} onClick={() => go({ l: 1 })}>▼ Level {at.l + 2 <= shelf.levels.length ? at.l + 2 : ""}</button>
        <button type="button" className={btn} disabled={at.s === data.shelves.length - 1} onClick={() => go({ s: 1 })}>Shelf ›</button>
      </div>
      <style>{"@keyframes fadein{from{opacity:0}to{opacity:1}}"}</style>
    </div>
  );
}
