"use client";

/**
 * THE TRAY: the bridge between the walk above and the shop. The sections (Type IV) of the shelf the walk is at, side
 * by side, STANDING STILL, and the shelf's name, large, in the dark area on the right (owner, 2026-11-16: "lets the
 * bottom section stop moving, it should not move, the black area on the right side of this tray should say the name
 * of the shelf in a larger font and nice and readable"; it was a slow ticker, 2026-11-15).
 *
 * A NEW SHELF SLIDES IN THE WAY THE WALK MOVES (owner, 2026-11-16: "when center of moving tour is past the center of
 * the next shelf then the bottom tray will change to the next set of sections, this move should be smooth not jerky
 * and not all of a sudden and should happen in the direction of move of the tour and the old set of sections will
 * move away from the other side of the tray just as on top on the tour the old shelf is now getting away from view").
 * `dir` -1: the picture moved left, so the new set comes in from the right and the old one leaves to the left; +1 the
 * other way. When the walk changes shelf is `trayCross` (`kitRules.ts`), in `Walk360.tsx`.
 *
 * A tap on a photo is the shopper wanting to buy from it (`onPick`, with where the photo is on the screen). When the
 * sections are more than fit, the row scrolls under a finger; it never moves by itself.
 */
import { noSave } from "./noSave";
import Watermark from "./Watermark";
import { useEffect, useState } from "react";
import type { ShopSection, ShopShelf } from "@/lib/stores/kitRules";

/** How long a change of shelf takes: smooth, not sudden. */
const SWAP_MS = 1100;
const EASE = "cubic-bezier(.45,.05,.25,1)";

type Layer = { shelf: ShopShelf; state: "in" | "on" | "out"; from: 1 | -1 };

function Row({ shelf, picked, onPick, lang }: { shelf: ShopShelf; picked: string | null; onPick: (s: ShopSection, el: HTMLElement) => void; lang: "fa" | "en" }) {
  return (
    <div className="flex h-full w-full items-stretch gap-3 overflow-x-auto overflow-y-hidden px-3 py-2.5 [scrollbar-width:none]">
      {shelf.sections.map((s) => (
        <button
          key={s.id} type="button" data-track="tray-photo" data-kit-section={s.id} data-kit-shelf={shelf.id}
          onClick={(e) => { e.stopPropagation(); onPick(s, e.currentTarget); }}
          aria-label={`${lang === "fa" ? shelf.label.fa : shelf.label.en}, ${lang === "fa" ? "بخش" : "section"} ${s.i}`}
          className={`relative h-full shrink-0 overflow-hidden rounded-lg bg-black/40 shadow-lg ring-1 transition-[box-shadow,opacity] ${picked === s.id ? "ring-2 ring-amber-300" : picked ? "opacity-60 ring-white/15" : "ring-white/15 hover:ring-amber-200/70"}`}
          style={{ aspectRatio: s.w && s.h ? `${s.w} / ${s.h}` : "4 / 3" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img {...noSave} src={s.thumb || s.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          <Watermark size="sm" />
        </button>
      ))}
    </div>
  );
}

export default function KitTray({ shelf, dir, picked, onPick, lang }: {
  shelf: ShopShelf | null;
  /** The way the walk moved when the shelf changed (see above). */
  dir: 1 | -1;
  /** The section whose photo is open (marked in the tray). */
  picked: string | null;
  onPick: (s: ShopSection, el: HTMLElement) => void;
  lang: "fa" | "en";
}) {
  const [layers, setLayers] = useState<Layer[]>([]);
  useEffect(() => {
    if (!shelf) return;
    // The new set enters from the side the picture is coming from; the old one leaves by the other.
    const from: 1 | -1 = dir < 0 ? 1 : -1;
    setLayers((ls) => {
      if (ls.length && ls[ls.length - 1].shelf.id === shelf.id) return ls;
      if (!ls.length) return [{ shelf, state: "on", from }];
      return [...ls.map((l): Layer => ({ ...l, state: "out", from })), { shelf, state: "in", from }];
    });
    // Next frame: the new one slides to its place while the old one slides out.
    const go = requestAnimationFrame(() => requestAnimationFrame(() => setLayers((ls) => ls.map((l) => (l.state === "in" ? { ...l, state: "on" } : l)))));
    const done = setTimeout(() => setLayers((ls) => ls.filter((l) => l.state !== "out")), SWAP_MS + 80);
    return () => { cancelAnimationFrame(go); clearTimeout(done); };
  }, [shelf, dir]);
  const pos = (l: Layer) => (l.state === "on" ? "0%" : l.state === "in" ? `${l.from * 100}%` : `${-l.from * 100}%`);
  return (
    <div className="relative flex h-full w-full overflow-hidden border-t border-white/15 bg-gradient-to-b from-[#1b140d] to-[#0d0a07]">
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {layers.map((l) => (
          <div key={l.shelf.id} className="absolute inset-0" style={{ transform: `translate3d(${pos(l)},0,0)`, transition: `transform ${SWAP_MS}ms ${EASE}`, pointerEvents: l.state === "on" ? "auto" : "none" }}>
            <Row shelf={l.shelf} picked={picked} onPick={onPick} lang={lang} />
          </div>
        ))}
      </div>
      {/* The shelf's name, large and readable, on the dark right-hand side; it changes with the sections. */}
      <div className="relative w-[34%] max-w-[18rem] shrink-0 overflow-hidden border-l border-white/10 bg-black/70">
        {layers.map((l) => (
          <div key={l.shelf.id} className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center"
            style={{ opacity: l.state === "on" ? 1 : 0, transform: `translate3d(0,${l.state === "on" ? "0" : l.state === "in" ? "30%" : "-30%"},0)`, transition: `opacity ${SWAP_MS}ms ${EASE}, transform ${SWAP_MS}ms ${EASE}` }}>
            {/* One number, not two; the Farsi name large, the English smaller (owner, 2026-11-17: "there are two numbers (3)
                one is enough, english font is too large, make the farsi font larger"; the sections' count removed). */}
            <p dir="rtl" className="text-[clamp(18px,5vw,32px)] font-extrabold leading-tight text-amber-100 [text-wrap:balance]">
              {l.shelf.label.fa.replace(/^[\d۰-۹]+\s*·\s*/, "")}
            </p>
            <p dir="ltr" className="text-[clamp(11px,2.6vw,15px)] font-semibold leading-tight text-amber-100/70">
              {l.shelf.label.en}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
