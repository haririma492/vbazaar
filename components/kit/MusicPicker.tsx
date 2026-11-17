"use client";

/**
 * THE SHOPPER'S MUSIC KEY IN THE FREE TOUR'S TRAY (owner, 2026-11-17: "on the lower panel allow a drop down for music
 * let the shopper a) change channel and b) change the volume"). A 🎵 key on the tray's dark side; it opens a small
 * panel above the tray: the live channels the operator ticked on the store's page (`Walk.radios`, the default first
 * lit), and a volume bar (`setMusicVolume`, kept on the device). The choice of channel lasts the visit.
 */
import { useEffect, useRef, useState } from "react";
import type { RadioSource } from "@/lib/radio";
import { useMusicVolume } from "@/components/virtual-bazaar/walk/WalkSound";

export default function MusicPicker({ channels, current, onPick, lang }: {
  channels: RadioSource[]; current: string | null; onPick: (r: RadioSource) => void; lang: "fa" | "en";
}) {
  const [open, setOpen] = useState(false);
  const [vol, setVol] = useMusicVolume();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);
  const fa = lang === "fa";
  return (
    <div ref={box} className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" data-track="tray-music" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[13px] font-semibold text-white hover:bg-white/20">
        🎵 <span>{fa ? "موسیقی" : "Music"}</span> <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div dir={fa ? "rtl" : "ltr"} className="fixed bottom-[calc(23%+8px)] right-2 z-[60] w-[min(20rem,calc(100vw-1rem))] space-y-3 rounded-xl border border-white/20 bg-black/90 p-3 text-white shadow-2xl backdrop-blur">
          {channels.length > 1 && (
            <div className="space-y-1">
              <p className="text-[12px] font-bold text-white/70">{fa ? "کانال" : "Channel"}</p>
              <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
                {channels.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onPick(c)}
                      className={`w-full rounded-lg px-3 py-2 text-start text-[14px] ${current === c.id ? "bg-amber-300/20 font-bold text-amber-100 ring-1 ring-amber-300/60" : "hover:bg-white/10"}`}>
                      {current === c.id ? "● " : "○ "}{fa ? c.fa || c.en : c.en || c.fa}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-[12px] font-bold text-white/70">{fa ? "صدا" : "Volume"} · {Math.round(vol * 100)}%</span>
            <span dir="ltr" className="flex items-center gap-2">
              <span aria-hidden>🔈</span>
              <input type="range" min={0} max={1} step={0.01} value={vol} onChange={(e) => setVol(Number(e.target.value))}
                aria-label={fa ? "صدا" : "Volume"} className="h-8 min-w-0 flex-1 accent-amber-300" />
              <span aria-hidden>🔊</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
