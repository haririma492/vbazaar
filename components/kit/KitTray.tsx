"use client";

/**
 * THE TRAY (owner, 2026-11-15: "the 23% of the bottom will act as a news ticker moving tray in which the photo type
 * IV staying in the tray and moving very slowly and as the top view pass that shelf reaching the next shelf … very
 * smoothly the tray moves showing photo type IVs of the next shelf"). The bridge between the walk above and the shop:
 * the sections of the shelf in view, right to left, round and round, slowly. A new shelf slides in over the last one.
 * A tap on a photo is the shopper wanting to buy from it (`onPick`, with where the photo is on the screen).
 */
import { noSave } from "./noSave";
import Watermark from "./Watermark";
import { useEffect, useRef, useState } from "react";
import type { ShopSection, ShopShelf } from "@/lib/stores/kitRules";

/** Pixels a second the tray moves (owner: "moving very slowly"). */
const SPEED = 24;
const SWAP_MS = 900;

function Track({ shelf, paused, picked, onPick, leaving }: {
  shelf: ShopShelf; paused: boolean; picked: string | null; leaving: boolean;
  onPick: (s: ShopSection, el: HTMLElement) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const one = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Enough copies of the shelf's sections that one round is wider than the tray: then two rounds loop seamlessly.
  const [copies, setCopies] = useState(1);
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const fit = () => {
      const w = box.current?.clientWidth ?? 0, r = one.current?.scrollWidth ?? 0;
      if (w && r) setCopies((c) => Math.max(1, Math.ceil((w * c) / r)));
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (box.current) ro?.observe(box.current);
    return () => ro?.disconnect();
  }, [shelf.id]);
  useEffect(() => {
    let x = 0, last = performance.now(), id = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const round = one.current?.scrollWidth ?? 0;
      if (!pausedRef.current && round) {
        x -= SPEED * dt;
        if (-x >= round) x += round;
        if (row.current) row.current.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      }
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [shelf.id]);
  const list = Array.from({ length: copies }, () => shelf.sections).flat();
  const photos = (k: string) => list.map((s, i) => (
    <button
      key={`${k}${i}-${s.id}`} type="button" data-track="tray-photo" data-kit-section={s.id} data-kit-shelf={shelf.id}
      onClick={(e) => { e.stopPropagation(); onPick(s, e.currentTarget); }}
      aria-label={`${shelf.label.en}, section ${s.i}`}
      className={`relative h-full shrink-0 overflow-hidden rounded-lg bg-black/40 shadow-lg ring-1 transition-[box-shadow,opacity] ${picked === s.id ? "ring-2 ring-amber-300" : picked ? "opacity-60 ring-white/15" : "ring-white/15 hover:ring-amber-200/70"}`}
      style={{ aspectRatio: s.w && s.h ? `${s.w} / ${s.h}` : "4 / 3" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...noSave} src={s.thumb || s.url} alt="" loading="lazy" className="h-full w-full object-cover" />
      <Watermark size="sm" />
    </button>
  ));
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden transition-[opacity,transform] ease-out"
      style={{ transitionDuration: `${SWAP_MS}ms`, opacity: leaving || !shown ? 0 : 1, transform: leaving ? "translateX(-12%)" : shown ? "none" : "translateX(12%)", pointerEvents: leaving ? "none" : "auto" }}>
      <div ref={row} className="flex h-full w-max items-stretch gap-3 py-2.5 pl-3 will-change-transform">
        <div ref={one} className="flex h-full items-stretch gap-3">{photos("a")}</div>
        <div className="flex h-full items-stretch gap-3" aria-hidden="true">{photos("b")}</div>
      </div>
    </div>
  );
}

export default function KitTray({ shelf, paused, picked, onPick, lang }: {
  shelf: ShopShelf | null;
  paused: boolean;
  /** The section whose photo is open (marked in the tray). */
  picked: string | null;
  onPick: (s: ShopSection, el: HTMLElement) => void;
  lang: "fa" | "en";
}) {
  // The shelf on its way out stays a moment, fading left, while the new one slides in.
  const [layers, setLayers] = useState<Array<{ shelf: ShopShelf; leaving: boolean }>>([]);
  useEffect(() => {
    if (!shelf) return;
    setLayers((ls) => {
      if (ls.length && ls[ls.length - 1].shelf.id === shelf.id) return ls;
      return [...ls.map((l) => ({ ...l, leaving: true })), { shelf, leaving: false }];
    });
    const id = setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), SWAP_MS + 50);
    return () => clearTimeout(id);
  }, [shelf]);
  const name = shelf ? (lang === "fa" ? shelf.label.fa : shelf.label.en) : "";
  return (
    <div className="relative h-full w-full overflow-hidden border-t border-white/15 bg-gradient-to-b from-[#1b140d] to-[#0d0a07]">
      {layers.map((l) => <Track key={l.shelf.id} shelf={l.shelf} leaving={l.leaving} paused={paused} picked={picked} onPick={onPick} />)}
      {name && (
        <span dir="auto" className="pointer-events-none absolute left-2 top-1.5 z-10 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-bold text-amber-100 shadow">
          {name}
        </span>
      )}
    </div>
  );
}
