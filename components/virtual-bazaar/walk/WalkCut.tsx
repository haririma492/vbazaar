"use client";

/**
 * «Cut» on the walk's edit page (founder, 2026-10-18: "4:20 - 4:40, 7:48 -
 * 8:20 … cut and stitch couple of sections and save on olgoo (under the same
 * name)"). One question per card, with «← Back» (CLAUDE.md, operator
 * screens): the parts to keep, each its start then its end (typed, or «where
 * the video is now») → «Keep 0:52 and cut the rest?» → our server cuts and
 * saves it under the same name and says so. The first cut keeps the original:
 * «Put the original back» undoes it. The rules: `lib/splats/cut.ts`.
 *
 * ⚠️ Every time on this card is the ORIGINAL video's (founder: "we mean 4:20
 * to 4:40 from original video"): after a cut, the card shows the parts the
 * last cut kept, and «where the video is now» is said in the original's time.
 */

import { useEffect, useRef, useState } from "react";
import { checkParts, keptSeconds, readTime, sayTime, unmapTime, type Part } from "@/lib/splats/cut";
import { isWalkKey } from "@/lib/splats/walks";
import { readAdminToken } from "@/lib/admin/useAdminMode";

type Job = {
  kind: "cut" | "restore"; state: "working" | "done" | "failed"; step: string; percent: number;
  error: string | null; dropped: string[]; seconds: number | null;
};
type Step = "list" | "from" | "to" | "confirm" | "undo" | "working";

type Info = { original?: boolean; seconds?: number | null; parts?: Part[] };

async function ask(body: Record<string, unknown>): Promise<{ job: Job | null } & Info> {
  const res = await fetch("/api/operator/splats", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; job?: Job | null } & Info;
  if (res.status === 401) throw new Error("you are not signed in as operator on this site — sign in and try again");
  if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return { job: j.job ?? null, original: j.original, seconds: j.seconds, parts: j.parts };
}

export function CutEditor({ video, viewKey }: { video: () => HTMLVideoElement | null; viewKey: string | null }) {
  const [step, setStep] = useState<Step>("list");
  const [parts, setParts] = useState<Part[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [original, setOriginal] = useState(false);
  /** The original's length, once a cut has kept it; and the parts the last cut kept (on the original's times). */
  const [originalSeconds, setOriginalSeconds] = useState<number | null>(null);
  const [lastParts, setLastParts] = useState<Part[]>([]);
  const poll = useRef<number | null>(null);

  // The original's timeline: as uploaded, or the one the last cut came from.
  const duration = original ? originalSeconds ?? 0 : video()?.duration ?? 0;
  /** Where the video is now, in the original's time; null when that cannot be known. */
  const nowOnOriginal = (): number | null => {
    const t = video()?.currentTime ?? 0;
    if (!original) return t;
    return lastParts.length ? unmapTime(t, lastParts) : null;
  };

  // A cut already running (or just done) for this video: show it.
  useEffect(() => {
    if (!viewKey) return;
    void ask({ action: "cutStatus", key: viewKey, info: true }).then(({ job: j, original: o, seconds, parts: last }) => {
      setOriginal(Boolean(o));
      setOriginalSeconds(seconds ?? null);
      setLastParts(last ?? []);
      if (last?.length) setParts(last);
      if (j?.state === "working") { setJob(j); setStep("working"); }
    }).catch(() => {});
  }, [viewKey]);

  useEffect(() => {
    if (step !== "working" || !viewKey) return;
    poll.current = window.setInterval(() => {
      void ask({ action: "cutStatus", key: viewKey }).then(({ job: j }) => {
        setJob(j);
        // Done: the page reloads by itself onto the new video.
        if (j?.state === "done") window.setTimeout(() => window.location.reload(), j.dropped.length ? 8000 : 3000);
      }).catch((e) => setNote(`Could not ask how the cut is going: ${(e as Error).message} (it carries on; reload to check)`));
    }, 2000);
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [step, viewKey]);

  if (!viewKey || !isWalkKey(viewKey)) {
    return <p className="text-white/70">Only a 360° walk video from the bucket (?v=scenes/…/….mp4) can be cut here.</p>;
  }

  const primary = "rounded-md bg-[#00B8C8] px-3 py-2 text-[14px] font-bold text-black disabled:opacity-40";
  const quiet = "rounded-md border border-white/25 px-3 py-2 text-[13px] text-white/85";
  const field = "w-28 rounded-md border border-white/20 bg-black/50 px-2 py-1.5 font-mono text-[15px] text-white";
  const title = "text-[15px] font-bold";
  const back = (s: Step) => <button className={quiet} onClick={() => { setNote(null); setStep(s); }}>← Back</button>;
  const said = note && <p className="whitespace-pre-line text-[12px] text-amber-200">{note}</p>;

  async function start(body: Record<string, unknown>) {
    setNote(null);
    try {
      const { job: j } = await ask(body);
      setJob(j);
      setStep("working");
    } catch (e) {
      setNote(`Not started: ${(e as Error).message}`);
    }
  }

  if (step === "working") {
    const verb = job?.kind === "restore" ? "Putting the original back" : "Cutting";
    if (job?.state === "done") {
      return (
        <div className="space-y-2">
          <div className={title}>✓ Saved{job.seconds ? ` — the walk is now ${sayTime(job.seconds)}` : ""}</div>
          {job.dropped.length > 0 && (
            <p className="whitespace-pre-line text-[12px] text-amber-200">In the parts cut away, so taken off:{"\n"}{job.dropped.join("\n")}</p>
          )}
          <p className="text-white/70">Reloading onto the new video…</p>
        </div>
      );
    }
    if (job?.state === "failed") {
      return (
        <div className="space-y-2">
          <div className={title}>Not saved</div>
          <p className="whitespace-pre-line text-[13px] text-red-300">{job.error}</p>
          <p className="text-white/60">The video is as it was.</p>
          {back("list")}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className={title}>{verb}… {job?.percent ? `${job.percent}%` : ""}</div>
        <p className="text-white/70">{job?.step ?? "starting"}</p>
        <p className="text-white/50">4K takes our server a few minutes. You may leave this page; it carries on.</p>
        {said}
      </div>
    );
  }

  if (step === "from" || step === "to") {
    const isFrom = step === "from";
    const value = isFrom ? from : to;
    const set = isFrom ? setFrom : setTo;
    const next = () => {
      const t = readTime(value);
      if (t === null) return setNote("Type a time like 4:20.");
      if (!isFrom) {
        const f = readTime(from) ?? 0;
        const { parts: checked, problems } = checkParts([...parts, { from: f, to: t }], duration);
        if (problems.length) return setNote(problems.join("\n"));
        setParts(checked);
        setFrom(""); setTo("");
        setStep("list");
      } else setStep("to");
      setNote(null);
    };
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-white/45">Part {parts.length + 1}{!isFrom ? ` · from ${from}` : ""}</div>
        <div className={title}>{isFrom ? "Where does this part start?" : "Where does it end?"}</div>
        <p className="text-white/70">
          The time in the original video{duration ? ` (0:00–${sayTime(duration)})` : ""}. Type it, or play the video to that
          moment and tap «Where the video is now».
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input key={step} autoFocus className={field} value={value} placeholder="4:20" inputMode="decimal"
            onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") next(); }} />
          {nowOnOriginal() !== null && (
            <button className={quiet} onClick={() => set(sayTime(nowOnOriginal()!))}>Where the video is now ({sayTime(nowOnOriginal()!)})</button>
          )}
        </div>
        {said}
        <div className="flex gap-2">
          {back(isFrom ? "list" : "from")}
          <button className={`${primary} flex-1`} onClick={next}>{isFrom ? "Next →" : "Keep this part"}</button>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    const kept = keptSeconds(parts);
    return (
      <div className="space-y-2">
        <div className={title}>Keep {sayTime(kept)} and cut the rest?</div>
        <ul className="font-mono text-[13px] text-white/85">
          {parts.map((p, i) => <li key={i}>{i + 1}. {sayTime(p.from)} – {sayTime(p.to)}</li>)}
        </ul>
        <p className="text-white/70">
          Each part is cut out of the original, then the parts are stitched in this order and saved under the same name,
          so every link still works. Doors and product dots move
          with the picture; those in parts cut away are taken off. The original is kept: «Put the original back» undoes it.
        </p>
        {said}
        <div className="flex gap-2">
          {back("list")}
          <button className={`${primary} flex-1`} onClick={() => void start({ action: "cut", key: viewKey, parts })}>Cut and save</button>
        </div>
      </div>
    );
  }

  if (step === "undo") {
    return (
      <div className="space-y-2">
        <div className={title}>Put the original back?</div>
        <p className="text-white/70">The video as it was first uploaded, with its doors and dots as they were before the first cut.</p>
        {said}
        <div className="flex gap-2">
          {back("list")}
          <button className={`${primary} flex-1`} onClick={() => void start({ action: "cutRestore", key: viewKey })}>Put it back</button>
        </div>
      </div>
    );
  }

  // The parts so far.
  return (
    <div className="space-y-2">
      <div className={title}>{parts.length ? "Parts to keep" : "Keep only the good parts?"}</div>
      {parts.length > 0 && (
        <p className="text-[12px] text-white/55">
          Times in the original video (0:00–{sayTime(duration)}){lastParts.length && parts === lastParts ? " — what the last cut kept; add or remove parts and cut again" : ""}.
        </p>
      )}
      {parts.length ? (
        <ul className="space-y-1">
          {parts.map((p, i) => (
            <li key={i} className="flex items-center justify-between rounded-md bg-white/5 px-2 py-1 font-mono text-[13px]">
              <span>{i + 1}. {sayTime(p.from)} – {sayTime(p.to)}</span>
              <button className="text-white/60 hover:text-white" aria-label="Remove this part"
                onClick={() => setParts(parts.filter((_, k) => k !== i))}>✕</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-white/70">
          Choose the parts of the {original ? "original " : ""}video worth walking (0:00–{sayTime(duration)}). Each is cut out of
          it on its own, then they are stitched together into one video and the rest is left out.
        </p>
      )}
      {said}
      <div className="flex gap-2">
        <button className={`${parts.length ? quiet : primary} flex-1`} onClick={() => { setFrom(""); setTo(""); setNote(null); setStep("from"); }}>
          + {parts.length ? "Another part" : "Add a part to keep"}
        </button>
        {parts.length > 0 && <button className={`${primary} flex-1`} onClick={() => setStep("confirm")}>Next →</button>}
      </div>
      {original && (
        <button className="text-[12px] text-white/60 underline" onClick={() => setStep("undo")}>Put the original back</button>
      )}
    </div>
  );
}
