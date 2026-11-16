"use client";

/**
 * WHERE EACH SHELF IS ON THE WALK, FOR THE TRAY (owner, 2026-11-16: "the bottom tray does not move to the next shelf,
 * on the store page there needs to be a way that operator mark where each shelf is so it can switch the bottom tray to
 * the shelf as shopper pass in front of each"). The walk's own video (the whole panorama, as filmed) with a time bar:
 * each shelf's bordered stretch drawn on it, and its mark. Play or drag to where a shelf comes in front, then «The
 * tray shows this shelf from here». The Free Tour's tray then follows these marks (`trayByTime`): from a shelf's mark
 * to the next one's, it shows that shelf's sections. Each change saves itself and says so; «▶ Go there» plays from a
 * mark, «Take the mark off» goes back to following the picture.
 */
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/stores/upload";

type Shelf = { id: string; label: { en: string; fa: string }; trayAt: number | null; border: [number, number] | null };
const say = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;
const COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171", "#2dd4bf", "#fb923c"];

export default function TrayTimeline({ api, video, shelves, onSaved }: { api: string; video: string; shelves: Shelf[]; onSaved: () => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    const tick = () => setT(el.currentTime);
    const meta = () => setDur(el.duration || 0);
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    el.addEventListener("loadedmetadata", meta);
    return () => { el.removeEventListener("timeupdate", tick); el.removeEventListener("seeked", tick); el.removeEventListener("loadedmetadata", meta); };
  }, [video]);
  const go = (s: number) => { if (v.current) { v.current.currentTime = s; setT(s); } };
  const mark = async (sh: Shelf, at: number | null) => {
    try {
      await postJson(api, { action: "kitTrayAt", shelf: sh.id, at });
      setSaid({ ok: true, text: at === null ? `✓ «${sh.label.en}»: mark taken off.` : `✓ The tray shows «${sh.label.en}» from ${say(at)}. · ذخیره شد` });
      onSaved();
    } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
  };
  const pct = (s: number) => `${dur ? Math.min(100, Math.max(0, (s / dur) * 100)) : 0}%`;
  const marked = shelves.filter((s) => s.trayAt !== null).length;

  return (
    <div dir="ltr" className="mt-3 space-y-2 rounded-lg border border-sky-300/30 bg-sky-300/[0.05] p-3 text-left text-[13px]">
      <p className="text-[15px] font-bold text-sky-100">When the tray shows each shelf · زمان نمایش هر قفسه در سینی</p>
      <p className="text-white/60">Play or drag the walk to where a shelf comes in front of the shopper, then press «The tray shows this shelf from here». From that moment until the next shelf&apos;s mark, the tray under the Free Tour shows that shelf&apos;s sections. {marked ? `${marked} of ${shelves.length} shelves marked.` : "No shelf is marked yet: the tray follows the picture, which can miss."}</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={v} src={video} controls playsInline preload="metadata" className="aspect-[2/1] w-full rounded bg-black" />
      {/* The time bar: each shelf's bordered stretch, its mark, and where the video is. Tap to go there. */}
      <div className="relative h-9 cursor-pointer rounded bg-white/10" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); go(((e.clientX - r.left) / r.width) * dur); }}>
        {shelves.map((s, i) => s.border && (
          <div key={`b${s.id}`} className="absolute top-1 h-2 rounded opacity-50" style={{ left: pct(s.border[0]), width: `calc(${pct(s.border[1])} - ${pct(s.border[0])})`, background: COLORS[i % COLORS.length], top: `${4 + (i % 3) * 3}px` }} />
        ))}
        {shelves.map((s, i) => s.trayAt !== null && (
          <div key={`m${s.id}`} className="absolute bottom-0 top-0 w-1 rounded" style={{ left: pct(s.trayAt), background: COLORS[i % COLORS.length] }} title={`${s.label.en} from ${say(s.trayAt)}`} />
        ))}
        <div className="absolute bottom-0 top-0 w-0.5 bg-white" style={{ left: pct(t) }} />
        <span className="absolute bottom-0.5 right-1 text-[11px] text-white/60">{say(t)} / {say(dur)}</span>
      </div>
      <ul className="space-y-1.5">
        {shelves.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded bg-black/25 p-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="font-bold">{s.label.en}{s.label.fa !== s.label.en ? ` · ${s.label.fa}` : ""}</span>
            <span className="text-white/55">{s.border ? `bordered ${say(s.border[0])}–${say(s.border[1])}` : "no border on the walk"}</span>
            <span className={s.trayAt !== null ? "text-emerald-300" : "text-amber-200"}>{s.trayAt !== null ? `tray from ${say(s.trayAt)}` : "not marked"}</span>
            <span className="ml-auto flex flex-wrap gap-1">
              <button type="button" className="rounded-full bg-sky-400 px-3 py-1 text-[12px] font-semibold text-black" onClick={() => void mark(s, Math.round(t * 10) / 10)}>The tray shows this shelf from here ({say(t)})</button>
              {s.trayAt !== null && <button type="button" className="rounded-full border border-white/20 px-2 py-1 text-[12px]" onClick={() => { go(s.trayAt!); void v.current?.play(); }}>▶ Go there</button>}
              {s.trayAt !== null && <button type="button" className="rounded-full border border-white/20 px-2 py-1 text-[12px] text-rose-200" onClick={() => void mark(s, null)}>Take the mark off</button>}
            </span>
          </li>
        ))}
      </ul>
      {said && <p className={said.ok ? "text-emerald-300" : "text-rose-300"}>{said.text}</p>}
    </div>
  );
}
