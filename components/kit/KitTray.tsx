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
import { useEffect, useState, type ReactNode } from "react";
import type { ShopSection, ShopShelf } from "@/lib/stores/kitRules";

/** How long a change of shelf takes: smooth, not sudden. */
const SWAP_MS = 1100;
const EASE = "cubic-bezier(.45,.05,.25,1)";

type Layer = { shelf: ShopShelf; state: "in" | "on" | "out"; from: 1 | -1 };

function Row({ shelf, picked, onPick, lang, vertical }: { shelf: ShopShelf; picked: string | null; onPick: (s: ShopSection, el: HTMLElement) => void; lang: "fa" | "en"; vertical?: boolean }) {
  return (
    <div className={vertical
      ? "flex h-full w-full flex-col items-stretch gap-2 overflow-y-auto overflow-x-hidden px-2 py-2 [scrollbar-width:none]"
      : "flex h-full w-full items-stretch gap-3 overflow-x-auto overflow-y-hidden px-3 py-2.5 [scrollbar-width:none]"}>
      {shelf.sections.map((s) => (
        <button
          key={s.id} type="button" data-track="tray-photo" data-kit-section={s.id} data-kit-shelf={shelf.id}
          onClick={(e) => { e.stopPropagation(); onPick(s, e.currentTarget); }}
          aria-label={`${lang === "fa" ? shelf.label.fa : shelf.label.en}, ${lang === "fa" ? "بخش" : "section"} ${s.i}`}
          className={`relative ${vertical ? "w-full" : "h-full"} shrink-0 cursor-pointer overflow-hidden rounded-lg bg-black/40 shadow-lg ring-1 transition-[box-shadow,opacity,transform] duration-200 hover:-translate-y-1 hover:scale-[1.03] hover:shadow-2xl ${picked === s.id ? "ring-2 ring-amber-300" : picked ? "opacity-60 ring-white/15" : "ring-white/15 hover:ring-amber-200/70"}`}
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

export default function KitTray({ shelf, dir, picked, onPick, lang, music, vertical = false }: {
  shelf: ShopShelf | null;
  /** A phone held sideways (owner, 2026-11-17): the tray is a column at the right, its photos one under another. */
  vertical?: boolean;
  /** The shopper's music key (`MusicPicker`), at the top of the dark side. */
  music?: ReactNode;
  /** The way the walk moved when the shelf changed (see above). */
  dir: 1 | -1;
  /** The section whose photo is open (marked in the tray). */
  picked: string | null;
  onPick: (s: ShopSection, el: HTMLElement) => void;
  lang: "fa" | "en";
}) {
  const [layers, setLayers] = useState<Layer[]>([]);
  useEffect(() => {
    // No shelf (the walk outside every marked stretch): the set slides out, the tray stays empty.
    if (!shelf) {
      setLayers((ls) => ls.map((l): Layer => ({ ...l, state: "out", from: dir < 0 ? 1 : -1 })));
      const t = setTimeout(() => setLayers((ls) => ls.filter((l) => l.state !== "out")), SWAP_MS + 80);
      return () => clearTimeout(t);
    }
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
    <div className={`relative flex h-full w-full overflow-hidden bg-[#1c1610] ${vertical ? "flex-col border-l border-white/10" : "border-t border-white/10"}`}>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {layers.map((l) => (
          <div key={l.shelf.id} className="absolute inset-0" style={{ transform: `translate3d(${pos(l)},0,0)`, transition: `transform ${SWAP_MS}ms ${EASE}`, pointerEvents: l.state === "on" ? "auto" : "none" }}>
            <Row shelf={l.shelf} picked={picked} onPick={onPick} lang={lang} vertical={vertical} />
          </div>
        ))}
      </div>
      {/* The shelf's name, large and readable, on the dark right-hand side; it changes with the sections. */}
      <div className={`relative shrink-0 overflow-hidden ${vertical ? "h-[4.5rem] w-full border-t border-white/10" : "w-[34%] max-w-[18rem] border-l border-white/10"}`}>
        {music && <div className="absolute inset-x-2 top-1.5 z-10">{music}</div>}
        {layers.map((l) => (
          <div key={l.shelf.id} className={`absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center ${music ? "pt-12" : ""}`}
            style={{ opacity: l.state === "on" ? 1 : 0, transform: `translate3d(0,${l.state === "on" ? "0" : l.state === "in" ? "30%" : "-30%"},0)`, transition: `opacity ${SWAP_MS}ms ${EASE}, transform ${SWAP_MS}ms ${EASE}` }}>
            {/* The shelf's name is no longer here (owner, 2026-11-17: "remove shelf names from lower panel … add them to
                the label below shelf photo (Type III)"): only how to buy. */}
            {/* How to buy (owner, 2026-11-17: on the black area of the lower panel). */}
            <p dir="rtl" className={`mt-1.5 leading-snug text-white/70 ${vertical ? "text-[10px]" : "text-[clamp(10px,2.3vw,13px)]"}`}>
              برای خرید روی تصویر طبقات در اینجا یا روی تصویر قفسه در بالا سمت چپ کلیک کنید
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
