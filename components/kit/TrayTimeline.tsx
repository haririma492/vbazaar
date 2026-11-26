"use client";

/**
 * WHERE EACH SHELF STARTS AND ENDS ON THE WALK, FOR THE TRAY (owner, 2026-11-16: "this UI is unintuitive and does not
 * work properly, redesign it in a much easier way all we need is to lock that when a shelf / section start and when
 * ends"). One question at a time (the operator screens' rule): the walk, one big slider under it, and ONE key:
 * «Shelf 1 starts here», then «Shelf 1 ends here», then on to the next shelf by itself. Each press saves itself and
 * says so. Below, every shelf's start → end, «Mark again» and «▶ Watch it». The Free Tour's tray shows a shelf from its
 * start to its end, and keeps it until the next shelf starts (`trayByTime`).
 *
 * THE SAME WALK, THE SAME SPEED (owner, 2026-11-26: "why speed of walk when we select shelf display spots are so fast?
 * let operator have the speed bar there as well"): the video plays at the Free Tour's speed bar (`driveRate`), starting
 * at this store's own default; «Make this the free walk's default» saves the bar's speed for this store only.
 *
 * CUT OUT PARTS OF THE WALK (owner, 2026-11-26: "allow the operator to cut any part of the free walk with a display
 * similar to location of shelves below, operator selects a start and then end and that part will be marked for
 * deletion"): the same kind of bar, in red. Marks are only marks until «Cut out and replace the walk» — which keeps
 * what is not marked, on the original's times, through the walk's own cut job (`lib/splats/cut.ts`, the editor's «Cut»).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { postJson } from "@/components/stores/upload";
import { readAdminToken } from "@/lib/admin/useAdminMode";
import { checkParts, keptOnOriginal, keptSeconds, sayTime, type Part } from "@/lib/splats/cut";
import { FILM_FPS, defaultSpeedOf, driveRate, placeOf, speedAt } from "@/lib/splats/pace";
import PanoView from "./PanoView";

type Shelf = { id: string; label: { en: string; fa: string }; trayAt: number | null; trayEnd: number | null };
type Cut = { from: number; to: number };
type Job = { state: "working" | "done" | "failed"; step: string; percent: number; error: string | null };
const say = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;
const COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171", "#2dd4bf", "#fb923c"];

/** The operator's cut and cut-status calls (as the walk editor's «Cut» makes them). */
async function operatorPost(body: Record<string, unknown>): Promise<{ job: Job | null; parts?: Part[] }> {
  const res = await fetch("/api/operator/splats", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; job?: Job | null; parts?: Part[] };
  if (res.status === 401) throw new Error("you are not signed in as operator on this site — sign in and try again");
  if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return { job: j.job ?? null, parts: j.parts };
}

export default function TrayTimeline({ api, video, flat, shelves, onSaved, walkKey, pace, speed }: {
  api: string; video: string; flat: boolean; shelves: Shelf[]; onSaved: () => void;
  /** The walk's key (the cut acts on it); the walk's pace, and this store's own free-walk speed (m/s, or null: 7 fps). */
  walkKey: string | null; pace: number | null; speed: number | null;
}) {
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

  // THE SPEED: the bar's speed (m/s), the walk plays at it as the Free Tour does; this store's default is kept as saved.
  const [mps, setMps] = useState(() => defaultSpeedOf(speed, pace));
  const [defaultMps, setDefaultMps] = useState<number | null>(speed);
  useEffect(() => { setDefaultMps(speed); }, [speed]);
  const fpsAt = (v: number) => Math.round(FILM_FPS * Math.abs(driveRate(v, false, pace)));

  // THE CUTS: parts marked to be cut out, in the walk as it is now; a start waits for its end.
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [cutFrom, setCutFrom] = useState<number | null>(null);
  const [plan, setPlan] = useState<{ parts: Part[]; problems: string[] } | null>(null);
  const [cutting, setCutting] = useState<Job | null>(null);

  useEffect(() => {
    if (!el) return;
    // The Free Tour's rate for the bar's speed (the same rule as the shopper's walk).
    el.playbackRate = Math.abs(driveRate(mps, false, pace));
  }, [el, mps, pace]);

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

  // A cut running: asked every 2 s; done → the page reloads onto the new walk.
  useEffect(() => {
    if (cutting?.state !== "working" || !walkKey) return;
    const id = window.setInterval(() => {
      void operatorPost({ action: "cutStatus", key: walkKey }).then(({ job }) => {
        if (!job) return;
        setCutting(job);
        if (job.state === "done") {
          window.setTimeout(() => window.location.reload(), 3000);
        }
      }).catch((e) => setSaid({ ok: false, text: `Could not ask how the cut is going: ${(e as Error).message} (it carries on; reload to check)` }));
    }, 2000);
    return () => window.clearInterval(id);
  }, [cutting?.state, walkKey]);

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

  const saveDefault = async (v: number | null) => {
    setBusy(true);
    try {
      await postJson(api, { action: "kitSpeed", speed: v });
      setDefaultMps(v);
      setSaid({ ok: true, text: v === null ? "✓ The free walk of this store starts at the standard 7 fps." : `✓ The free walk of this store starts at ${fpsAt(v)} fps. · ذخیره شد` });
      onSaved();
    } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    setBusy(false);
  };

  /** Keep what is not marked, on the original's times, and show it for a yes. */
  const review = async () => {
    if (!walkKey || !cuts.length) return;
    setBusy(true); setSaid(null);
    try {
      // The last cut's parts map the walk as it is now back to the original (`keptOnOriginal`).
      const { parts: last } = await operatorPost({ action: "cutStatus", key: walkKey, info: true });
      const kept = keptOnOriginal(dur, cuts, last ?? []);
      const { parts, problems } = checkParts(kept, 0);
      if (!parts.length && !problems.length) problems.push("Nothing would be left of the walk.");
      setPlan({ parts, problems });
    } catch (e) { setSaid({ ok: false, text: `Not checked: ${(e as Error).message}` }); }
    setBusy(false);
  };

  const start = async () => {
    if (!walkKey || !plan) return;
    setBusy(true); setSaid(null);
    try {
      const { job } = await operatorPost({ action: "cut", key: walkKey, parts: plan.parts });
      setCutting(job ?? { state: "working", step: "starting", percent: 0, error: null });
    } catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
    setBusy(false);
  };

  const pct = (s: number) => `${dur ? Math.min(100, Math.max(0, (s / dur) * 100)) : 0}%`;
  const done = shelves.filter((s) => { const x = marks.get(s.id); return x?.at != null && x?.end != null; }).length;
  const color = (i: number) => COLORS[i % COLORS.length];
  const now = Math.round(t * 10) / 10;
  const tooEarly = asking === "end" && m?.at != null && now <= m.at;
  const cutTooEarly = cutFrom !== null && now <= cutFrom;
  const cutSeconds = cuts.reduce((s, c) => s + (c.to - c.from), 0);

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
          <span className="shrink-0 whitespace-nowrap text-right font-mono text-[13px] tabular-nums">{say(t)} / {say(dur)}</span>
        </div>
        <div className="relative ml-[6.5rem] mr-[8.5rem] h-3 rounded bg-white/10">
          {shelves.map((s, i) => { const x = marks.get(s.id); return x?.at != null && (
            <div key={s.id} className="absolute top-0 h-3 rounded" title={s.label.en}
              style={{ left: pct(x.at), width: x.end != null ? `calc(${pct(x.end)} - ${pct(x.at)})` : "3px", background: color(i), opacity: 0.85 }} />
          ); })}
          <div className="absolute -top-1 h-5 w-0.5 bg-white" style={{ left: pct(t) }} />
        </div>
      </div>

      {/* THE SPEED, as the Free Tour's bar: the video plays at it here. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/25 p-2">
        <span className="shrink-0 text-white/80">🐢 Speed · سرعت</span>
        <input type="range" min={0} max={1} step={0.001} value={placeOf(mps)} onChange={(e) => setMps(speedAt(Number(e.target.value)))}
          aria-label="Walking speed" className="h-8 min-w-[8rem] flex-1 accent-sky-400" />
        <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-white/90">{fpsAt(mps)} fps</span>
        <button type="button" disabled={busy || (defaultMps !== null && Math.abs(defaultMps - mps) < 0.002)}
          onClick={() => void saveDefault(mps)} className="rounded-full border border-white/25 px-2.5 py-1 text-[12px] disabled:opacity-40">
          ★ Make this the free walk&apos;s default
        </button>
        {defaultMps !== null && <button type="button" disabled={busy} onClick={() => void saveDefault(null)} className="text-[12px] text-white/65 underline disabled:opacity-40">use the standard 7 fps</button>}
        <span className="basis-full text-[12px] text-white/55">
          {defaultMps !== null ? `This store's free walk starts at ${fpsAt(defaultMps)} fps.` : "This store's free walk starts at the standard 7 fps."} Moving the bar changes nothing until you press ★.
        </span>
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

      {/* CUT OUT PARTS OF THE WALK: the same bar in red; a part is marked, and nothing is cut until the last press. */}
      <div className="space-y-2 rounded-lg border border-rose-300/30 bg-rose-300/[0.05] p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-[15px] font-bold text-rose-100">Cut out parts of the walk · حذف بخش‌هایی از فیلم</p>
          <span className="text-white/65">{cuts.length ? `${cuts.length} marked: ${Math.round(cutSeconds)} s cut out, ${Math.round(Math.max(0, dur - cutSeconds))} s kept` : "none marked"}</span>
        </div>
        <div className="relative ml-[6.5rem] mr-[8.5rem] h-3 rounded bg-white/10">
          {cuts.map((c, i) => (
            <div key={i} className="absolute top-0 h-3 rounded bg-rose-500/80" title={`cut out ${say(c.from)} → ${say(c.to)}`}
              style={{ left: pct(c.from), width: `calc(${pct(c.to)} - ${pct(c.from)})` }} />
          ))}
          {cutFrom !== null && <div className="absolute top-0 h-3 w-[3px] rounded bg-rose-300" style={{ left: pct(cutFrom) }} />}
          <div className="absolute -top-1 h-5 w-0.5 bg-white" style={{ left: pct(t) }} />
        </div>

        {cutting ? (
          <div className="rounded-xl border border-white/20 bg-black/30 p-3">
            {cutting.state === "done" ? (
              <p className="text-[15px] font-bold text-emerald-200">✓ The walk is cut and saved. Reloading onto it…</p>
            ) : cutting.state === "failed" ? (
              <>
                <p className="text-[15px] font-bold text-rose-200">Not saved</p>
                <p className="whitespace-pre-line text-rose-300">{cutting.error}</p>
                <p className="text-white/60">The walk is as it was; the marks are kept on this page until you reload.</p>
              </>
            ) : (
              <>
                <p className="text-[15px] font-bold">Cutting and stitching… {cutting.percent ? `${cutting.percent}%` : ""}</p>
                <p className="text-white/70">{cutting.step}</p>
                <p className="text-white/50">4K takes our server a few minutes. You may leave this page; it carries on.</p>
              </>
            )}
          </div>
        ) : plan ? (
          <div className="space-y-2 rounded-xl border-2 border-rose-300/60 p-3">
            {plan.problems.length > 0 ? (
              <p className="whitespace-pre-line text-amber-200">{plan.problems.join("\n")}</p>
            ) : (
              <>
                <p className="text-[15px] font-bold">Keep {plan.parts.length} part{plan.parts.length > 1 ? "s" : ""} ({sayTime(keptSeconds(plan.parts))}) and replace the walk?</p>
                <ol className="list-decimal ps-5 font-mono text-[12px] text-white/80">
                  {plan.parts.map((p, i) => <li key={i}>{sayTime(p.from)} – {sayTime(p.to)} · of the original</li>)}
                </ol>
                <p className="text-white/65">The original is kept: the walk&apos;s «Cut» page has «Put the original back». Doors, dots and shelves move with the picture; a shelf or dot in a part cut out goes.</p>
              </>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => setPlan(null)} className="rounded-md border border-white/25 px-3 py-2 text-[13px]">← Back</button>
              <button type="button" disabled={busy || plan.problems.length > 0} onClick={() => void start()}
                className="flex-1 rounded-md bg-rose-400 px-3 py-2 text-[14px] font-bold text-black disabled:opacity-40">Cut out and replace the walk</button>
            </div>
          </div>
        ) : (
          <>
            {cutFrom === null ? (
              <p className="text-white/75">Play or drag to where the part to CUT OUT starts, then press:</p>
            ) : (
              <p className="text-white/75">It starts at {say(cutFrom)}. Play or drag to where it ENDS, then press:</p>
            )}
            <button type="button" disabled={busy || !el || cutTooEarly} onClick={() => {
              if (cutFrom === null) { setCutFrom(now); return; }
              setCuts([...cuts, { from: cutFrom, to: now }].sort((a, b) => a.from - b.from));
              setCutFrom(null);
              setPlan(null);
              setSaid({ ok: true, text: `Marked ${say(cutFrom)} → ${say(now)} to be cut out. Nothing is cut until «Cut out and replace the walk».` });
            }}
              className="w-full rounded-xl py-3 text-[16px] font-bold text-black disabled:opacity-40" style={{ background: cutFrom === null ? "#fda4af" : "#f43f5e" }}>
              {cutFrom === null ? `✂ Cut out from here · ${say(now)}` : `✂ Cut out until here · ${say(now)}`}
            </button>
            {cutTooEarly && <p className="text-amber-200">Play on past {say(cutFrom!)} first: a part ends after it starts.</p>}
            {cutFrom !== null && <button type="button" className="text-[12px] text-white/70 underline" onClick={() => setCutFrom(null)}>Cancel this start</button>}

            {cuts.length > 0 && (
              <ul className="space-y-1.5">
                {cuts.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded bg-black/25 p-1.5">
                    <span className="inline-block h-3 w-3 rounded-full bg-rose-500" />
                    <span className="font-mono text-white/85">{say(c.from)} → {say(c.to)}</span>
                    <span className="text-white/55">{Math.round((c.to - c.from) * 10) / 10} s</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" className="rounded-full border border-white/20 px-2 py-1 text-[12px]" onClick={() => { go(c.from); void el?.play().catch(() => {}); }}>▶ Watch it</button>
                      <button type="button" className="rounded-full border border-white/20 px-2 py-1 text-[12px]" onClick={() => { setCuts(cuts.filter((_, k) => k !== i)); setPlan(null); }}>Remove</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {cuts.length > 0 && (
              <button type="button" disabled={busy || !walkKey} onClick={() => void review()}
                className="w-full rounded-md bg-rose-400 px-3 py-2 text-[14px] font-bold text-black disabled:opacity-40">
                Check the cut → keep the rest of the walk
              </button>
            )}
          </>
        )}
      </div>

      {said && <p className={said.ok ? "text-emerald-300" : "text-rose-300"}>{said.text}</p>}
    </div>
  );
}
