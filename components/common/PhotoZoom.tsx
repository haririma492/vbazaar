"use client";

/**
 * A PRODUCT'S PHOTO, LARGE (owner, 2026-11-01: "allow maximizing the photo").
 * The small photo is a button; a tap shows it as large as the screen allows
 * over everything (inside the walk's full screen when it is in one), and a
 * tap anywhere or Escape closes it.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PhotoZoom({ src, className, alt = "" }: { src: string; className: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (<>
    <button type="button" aria-label="Enlarge the photo" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className="relative shrink-0 cursor-zoom-in">
      {/* eslint-disable-next-line @next/next/no-img-element -- hot-linked product photo */}
      <img src={src} alt={alt} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className={className} />
      <span aria-hidden className="absolute bottom-1 end-1 rounded bg-black/60 px-1 text-[11px] leading-4 text-white">⤢</span>
    </button>
    {open && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/85 p-4" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the same photo, large */}
        <img src={src} alt={alt} className="max-h-full max-w-full rounded-xl bg-white object-contain shadow-2xl" />
        <span className="absolute end-4 top-4 text-[26px] text-white/80" aria-hidden>✕</span>
      </div>,
      document.fullscreenElement ?? document.body,
    )}
  </>);
}
