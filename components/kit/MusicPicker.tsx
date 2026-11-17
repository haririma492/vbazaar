"use client";

/**
 * THE SHOPPER'S MUSIC IN THE FREE TOUR'S TRAY (owner, 2026-11-17: "on the lower panel allow a drop down for music let
 * the shopper a) change channel and b) change the volume"; then "let music choice drop down to be right there where the
 * key is do not open another window on top also add an option "No Music" so it stops them all, make the key wider").
 * Right on the tray's dark side, nothing opening over the walk: a wide dropdown of the live channels the operator ticked
 * on the store's page (`Walk.radios`; or the store's own music) and «No music», which stops it all; under it a volume
 * bar for every player on the page (`setMusicVolume`, kept on the device). The choice lasts the visit.
 */
import type { RadioSource } from "@/lib/radio";
import { primeAudio, turnSoundOn, useMusicVolume } from "@/components/virtual-bazaar/walk/WalkSound";

export const NO_MUSIC = "none";

export default function MusicPicker({ channels, current, onPick, lang, compact = false }: {
  /** One row, the volume beside the choice (a sideways phone's short header, 2026-11-17). */
  compact?: boolean;
  /** The channels to choose from; empty: the walk's own music, as one choice. */
  channels: RadioSource[];
  /** The channel playing, `NO_MUSIC`, or null (the walk's own music). */
  current: string | null;
  onPick: (r: RadioSource | typeof NO_MUSIC | null) => void;
  lang: "fa" | "en";
}) {
  const [vol, setVol] = useMusicVolume();
  const fa = lang === "fa";
  const off = current === NO_MUSIC;
  return (
    <div className={compact ? "flex w-full items-center gap-2" : "w-full space-y-1"} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {/* Our own ▾ at the end (owner, 2026-11-17: "missing the small arrow that shows that under this field there is a drop
          down"): an iPhone draws none on a styled box, so the box draws no arrow of its own and this one is always there. */}
      <span className={`relative block ${compact ? "min-w-0 flex-1" : "w-full"}`}>
      <select data-track="tray-music" dir={fa ? "rtl" : "ltr"} value={current ?? ""} aria-label={fa ? "موسیقی" : "Music"}
        onChange={(e) => { const v = e.target.value; if (v !== NO_MUSIC) { turnSoundOn(); primeAudio(); } onPick(v === NO_MUSIC ? NO_MUSIC : v === "" ? null : channels.find((c) => c.id === v) ?? null); }}
        className="w-full cursor-pointer appearance-none rounded-full border border-white/25 bg-[#1b140d] py-1 pe-8 ps-3 text-[13px] font-semibold text-white hover:bg-[#2a2016]">
        {channels.length
          ? channels.map((c) => <option key={c.id} value={c.id}>🎵 {fa ? c.fa || c.en : c.en || c.fa}</option>)
          : <option value="">🎵 {fa ? "موسیقی فروشگاه" : "The store's music"}</option>}
        <option value={NO_MUSIC}>🔇 {fa ? "بدون موسیقی" : "No music"}</option>
      </select>
      <svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-white ${fa ? "left-3" : "right-3"}`}>
        <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      </span>
      {!off && (
        <span dir="ltr" className={`flex items-center gap-1.5 px-1 text-[12px] text-white/80 ${compact ? "w-28 shrink-0" : ""}`}>
          {!compact && <span className="shrink-0 font-semibold">{fa ? "صدا" : "Volume"}</span>}
          <span aria-hidden>🔈</span>
          <input type="range" min={0} max={1} step={0.01} value={vol} onChange={(e) => setVol(Number(e.target.value))}
            aria-label={fa ? "صدا" : "Volume"} className="h-5 min-w-0 flex-1 cursor-pointer accent-amber-300" />
          <span aria-hidden>🔊</span>
        </span>
      )}
    </div>
  );
}
