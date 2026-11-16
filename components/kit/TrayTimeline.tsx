"use client";

/**
 * WHERE EACH SHELF STARTS AND ENDS ON THE WALK, FOR THE TRAY (owner, 2026-11-16: "this UI is unintuitive and does not
 * work properly, redesign it in a much easier way all we need is to lock that when a shelf / section start and when
 * ends"). One question at a time (the operator screens' rule): the walk, one big slider under it, and ONE key:
 * «Shelf 1 starts here», then «Shelf 1 ends here», then on to the next shelf by itself. Each press saves itself and
 * says so. Below, every shelf's start → end, «Mark again» and «▶ Watch it». The Free Tour's tray shows a shelf from its
 * start to its end, and keeps it until the next shelf starts (`trayByTime`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { postJson } from "@/components/stores/upload";
import PanoView from "./PanoView";

type Shelf = { id: string; label: { en: string; fa: string }; trayAt: number | null; trayEnd: number | null };
const say = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;
const COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171", "#2dd4bf", "#fb923c"];

export default function TrayTimeline({ api, video, flat, shelves, onSaved }: { api: string; video: string; flat: boolean; shelves: Shelf[]; onSaved: () => void }) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const onVideo = useCallback((x: HTMLVideoElement | null) => setEl(x), []);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The marks as saved here (the page reloads them too).
  const [marks, setMarks] = useState(() => new Map(shelves.map((s) => [s.id, { at: s.trayAt, end: s.trayEnd }])));
  useEffect(() => { setMarks(new Map(shelves.map((s) => [s.id, { at: s.trayAt, end: s.trayEnd }]))); }, [shelves]);
  // Which shelf and which end is asked now: the first shelf not fully marked, unless the operator chose one.
  const firstOpen = useMemo(() => shelves.findIndex((s) => { const m = marks.get(s.id); return m?.at == null || m?.end == null; }), [shelves, marks]);
  const [chosen, setChosen] = useState<number | null>(null);
  const at = chosen ?? firstOpen;
  const shelf = at >= 0 ? shelves[at] : null;
  const m = shelf ? marks.get(shelf.id) : undefined;
  const asking: "start" | "end" = m?.at == null ? "start" : m?.end == null ? "end" : "start";

  useEffect(() => {
    if (!el) return;
    const tick = () => setT(el.currentTime);
    const meta = () => setDur(el.duration || 0);
    const pl = () => setPlaying(!el.paused);
    if (el.readyState >= 1) meta();
    const evs: Array<[string, () => void]> = [["timeupdate", tick], ["seeked", tick], ["loadedmetadata", meta], ["durationchange", meta], ["play", pl], ["pause", pl], ["ended", pl]];
    evs.forEach(([n, f]) => el.addEventListener(n, f));
    // A smoother clock than timeupdate (4 a second) while it plays.
    let raf = 0;
    const loop = () => { setT(el.currentTime); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { evs.forEach(([n, f]) => el.removeEventListener(n, f)); cancelAnimationFrame(raf); };
  }, [el]);
  const go = (s: number) => { if (el) { el.currentTime = Math.max(0, Math.min(dur || s, s)); setT(el.currentTime); } };
  const toggle = () => { if (!el) return; if (el.paused) void el.play().catch((e) => setSaid({ ok: false, text: `The video would not play: ${(e as Error).message}. Drag the slider instead.` })); else el.pause(); };

  const save = async (sh: Shelf, which: "start" | "end", sec: number | null) => {
    setBusy(true);
    try {
      await postJson(api, { action: "kitTrayAt", shelf: sh.id, ...(which === "start" ? { at: sec } : { end: sec }) });
      setMarks((x) => { const n = new Map(x); const cur = n.get(sh.id) ?? { at: null, end: null }; n.set(sh.id, which === "start" ? { ...cur, at: sec } : { ...cur, end: sec }); return n; });
      setSaid({ ok: true, text: sec === null ? `✓ «${sh.label.en}»: taken off.` : `✓ «${sh.label.en}» ${which === "start" ? "starts" : "ends"} at ${say(sec)}. · ذخیره شد` });
      if (which === "end" && sec !== null) setChosen(null); // on to the next shelf not marked
      onSaved();
    } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    setBusy(false);
  };
  const pct = (s: number) => `${dur ? Math.min(100, Math.max(0, (s / dur) * 100)) : 0}%`;
  const done = shelves.filter((s) => { const x = marks.get(s.id); return x?.at != null && x?.end != null; }).length;
  const color = (i: number) => COLORS[i % COLORS.length];
  const now = Math.round(t * 10) / 10;
  const tooEarly = asking === "end" && m?.at != null && now <= m.at;

  return (
    <div dir="ltr" className="mt-3 space-y-3 rounded-lg border border-sky-300/30 bg-sky-300/[0.05] p-3 text-left text-[13px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[15px] font-bold text-sky-100">Where each shelf starts and ends · شروع و پایان هر قفسه</p>
        <span className={done === shelves.length ? "text-emerald-300" : "text-amber-200"}>{done} of {shelves.length} shelves done</span>
      </div>

      {flat
        // eslint-disable-next-line jsx-a11y/media-has-caption
        ? <video ref={onVideo} src={video} playsInline muted preload="auto" className="w-full rounded bg-black" />
        : <PanoView video={video} onVideo={onVideo} />}

      {/* One big slider: drag to any moment; the shelves' marked stretches under it in their colours. */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggle} disabled={!el} className="h-10 w-24 shrink-0 rounded-full bg-white/15 text-[14px] font-bold disabled:opacity-40">{playing ? "❚❚ Pause" : "▶ Play"}</button>
          <input type="range" min={0} max={dur || 1} step={0.1} value={Math.min(t, dur || 1)} onChange={(e) => go(Number(e.target.value))} disabled={!el || !dur}
            aria-label="Where along the walk" className="h-10 min-w-0 flex-1 accent-sky-400" />
          <span className="w-24 shrink-0 text-right font-mono text-[13px] tabular-nums">{say(t)} / {say(dur)}</span>
        </div>
        <div className="relative mx-[6.5rem] h-3 rounded bg-white/10">
          {shelves.map((s, i) => { const x = marks.get(s.id); return x?.at != null && (
            <div key={s.id} className="absolute top-0 h-3 rounded" title={s.label.en}
              style={{ left: pct(x.at), width: x.end != null ? `calc(${pct(x.end)} - ${pct(x.at)})` : "3px", background: color(i), opacity: 0.85 }} />
          ); })}
          <div className="absolute -top-1 h-5 w-0.5 bg-white" style={{ left: pct(t) }} />
        </div>
      </div>

      {/* THE ONE QUESTION. */}
      {shelf ? (
        <div className="rounded-xl border-2 p-3" style={{ borderColor: color(at) }}>
          <p className="text-[12px] text-white/60">Shelf {at + 1} of {shelves.length}</p>
          <p className="text-[17px] font-bold">{shelf.label.en}{shelf.label.fa !== shelf.label.en ? ` · ${shelf.label.fa}` : ""}</p>
          <p className="mt-1 text-white/75">
            {asking === "start"
              ? "Play or drag to the moment this shelf COMES IN FRONT of the shopper, then press:"
              : `It starts at ${say(m!.at!)}. Now play or drag to the moment it LEAVES the view, then press:`}
          </p>
          <button type="button" disabled={busy || !el || tooEarly} onClick={() => void save(shelf, asking, now)}
            className="mt-2 w-full rounded-xl py-3 text-[17px] font-bold text-black disabled:opacity-40"
            style={{ background: asking === "start" ? "#34d399" : "#fb7185" }}>
            {asking === "start" ? `▶ ${shelf.label.en} starts here · ${say(now)}` : `■ ${shelf.label.en} ends here · ${say(now)}`}
          </button>
          {tooEarly && <p className="mt-1 text-amber-200">Play on past {say(m!.at!)} first: a shelf ends after it starts.</p>}
          <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
            {asking === "end" && <button type="button" className="underline text-white/70" onClick={() => void save(shelf, "start", null)}>← Back: mark its start again</button>}
            {chosen !== null && <button type="button" className="underline text-white/70" onClick={() => setChosen(null)}>Cancel</button>}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-emerald-300/40 bg-emerald-300/10 p-3 text-[15px] font-bold text-emerald-200">✓ Every shelf has its start and end. The tray follows them. Press «Mark again» on a shelf to change it.</p>
      )}

      {/* Every shelf, as marked. */}
      <ul className="space-y-1.5">
        {shelves.map((s, i) => { const x = marks.get(s.id); return (
          <li key={s.id} className={`flex flex-wrap items-center gap-2 rounded p-1.5 ${i === at ? "bg-white/10" : "bg-black/25"}`}>
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: color(i) }} />
            <span className="font-bold">{s.label.en}</span>
            <span className="font-mono text-white/80">{x?.at != null ? say(x.at) : "—"} → {x?.end != null ? say(x.end) : "—"}</span>
            <span className="ml-auto flex gap-1">
              {x?.at != null && <button type="button" className="rounded-full border border-white/20 px-2 py-1 text-[12px]" onClick={() => { go(x.at!); void el?.play().catch(() => {}); }}>▶ Watch it</button>}
              <button type="button" className="rounded-full border border-white/20 px-2 py-1 text-[12px]" onClick={() => { setChosen(i); if (x?.at != null) go(Math.max(0, x.at - 1)); void save(s, "start", null).then(() => save(s, "end", null)); }}>Mark again</button>
            </span>
          </li>
        ); })}
      </ul>
      {said && <p className={said.ok ? "text-emerald-300" : "text-rose-300"}>{said.text}</p>}
    </div>
  );
}
