"use client";

/**
 * «Cut» on the walk's edit page (founder, 2026-10-18: "4:20 - 4:40, 7:48 -
 * 8:20 … cut and stitch couple of sections and save on olgoo (under the same
 * name)"; then: "lets list all parts that are selected with begining and end
 * Second, allow user to add or delete or modify the list, when list is final
 * allow user to stich the result and replace the video").
 *
 * THE LIST: every part kept, its start and end in seconds (typed — «4:20» is
 * read too — or «where the video is now»), each row changed or deleted in
 * place and checked as it is typed; «+ Add a part». The list is kept on this
 * device until it is stitched (a draft), and starts from what the last cut
 * kept. «Stitch and replace the video» → one «Are you sure?» card (← Back) →
 * our server cuts each part out of the original, stitches them and saves the
 * result under the same name, and says so. «Put the original back» undoes it.
 * The rules: `lib/splats/cut.ts`.
 *
 * ⚠️ Every time here is the ORIGINAL video's (founder: "we mean 4:20 to 4:40
 * from original video"), and «where the video is now» is said in it.
 */

import { useEffect, useRef, useState } from "react";
import { checkParts, keptSeconds, mapTime, readTime, sayTime, unmapTime, type Part } from "@/lib/splats/cut";
import { isWalkKey } from "@/lib/splats/walks";
import { readAdminToken } from "@/lib/admin/useAdminMode";

type Job = {
  kind: "cut" | "restore"; state: "working" | "done" | "failed"; step: string; percent: number;
  error: string | null; dropped: string[]; seconds: number | null;
};
type Step = "list" | "confirm" | "undo" | "working";
type Row = { from: string; to: string };
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

/** Seconds as typed in a row: «260», «260.5». */
const secs = (t: number) => String(Math.round(t * 10) / 10);
const draftKey = (key: string) => `walk-cut:${key}`;

function readDraft(key: string): Row[] | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(draftKey(key)) ?? "null");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.from === "string" && typeof r.to === "string") : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, rows: Row[] | null) {
  try {
    if (rows) window.localStorage.setItem(draftKey(key), JSON.stringify(rows));
    else window.localStorage.removeItem(draftKey(key));
  } catch {
    // private window: the list lasts this visit only
  }
}

/** One row as times, or why not. */
function rowProblem(r: Row, duration: number): string | null {
  if (!r.from.trim() && !r.to.trim()) return "type its start and end";
  const f = readTime(r.from), t = readTime(r.to);
  if (f === null) return "the start is not a time (e.g. 260 or 4:20)";
  if (t === null) return "the end is not a time (e.g. 280 or 4:40)";
  if (t <= f) return "it ends before it starts";
  if (t - f < 1) return "under 1 second";
  if (duration > 0 && t > duration + 0.5) return `past the end of the video (${secs(duration)} s)`;
  return null;
}

export function CutEditor({ video, viewKey }: { video: () => HTMLVideoElement | null; viewKey: string | null }) {
  const [step, setStep] = useState<Step>("list");
  const [rows, setRowsState] = useState<Row[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [original, setOriginal] = useState(false);
  /** The original's length, once a cut has kept it; and the parts the last cut kept (on the original's times). */
  const [originalSeconds, setOriginalSeconds] = useState<number | null>(null);
  const [lastParts, setLastParts] = useState<Part[]>([]);
  const [, tick] = useState(0);
  const poll = useRef<number | null>(null);

  const setRows = (next: Row[]) => {
    setRowsState(next);
    if (viewKey) writeDraft(viewKey, next);
  };

  // The original's timeline: as uploaded, or the one the last cut came from.
  const duration = original ? originalSeconds ?? 0 : video()?.duration ?? 0;
  /** Where the video is now, in the original's time; null when that cannot be known. */
  const nowOnOriginal = (): number | null => {
    const t = video()?.currentTime ?? 0;
    if (!original) return t;
    return lastParts.length ? unmapTime(t, lastParts) : null;
  };
  /** Show a moment of the original — in the video as it is now, when that moment is in it. */
  const seekOriginal = (t: number) => {
    const v = video();
    const at = !original ? t : lastParts.length ? mapTime(t, lastParts) : null;
    if (v && at !== null) v.currentTime = at;
    else setNote(`${secs(t)} s of the original is not in the video as it is now (an earlier cut left it out).`);
  };
  // «Where the video is now» follows the video while the list is open.
  useEffect(() => {
    if (step !== "list") return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [step]);

  // What this video has: a cut running, the original kept, the last cut's parts; and this device's draft.
  useEffect(() => {
    if (!viewKey) return;
    void ask({ action: "cutStatus", key: viewKey, info: true }).then(({ job: j, original: o, seconds, parts: last }) => {
      setOriginal(Boolean(o));
      setOriginalSeconds(seconds ?? null);
      setLastParts(last ?? []);
      const draft = readDraft(viewKey);
      setRowsState(draft?.length ? draft : (last ?? []).map((p) => ({ from: secs(p.from), to: secs(p.to) })));
      if (j?.state === "working") { setJob(j); setStep("working"); }
    }).catch((e) => setNote(`Could not read this video's cuts: ${(e as Error).message}`));
  }, [viewKey]);

  useEffect(() => {
    if (step !== "working" || !viewKey) return;
    poll.current = window.setInterval(() => {
      void ask({ action: "cutStatus", key: viewKey }).then(({ job: j }) => {
        setJob(j);
        // Done: the draft is the video now; the page reloads by itself onto it.
        if (j?.state === "done") {
          writeDraft(viewKey, null);
          window.setTimeout(() => window.location.reload(), j.dropped.length ? 8000 : 3000);
        }
      }).catch((e) => setNote(`Could not ask how the cut is going: ${(e as Error).message} (it carries on; reload to check)`));
    }, 2000);
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [step, viewKey]);

  if (!viewKey || !isWalkKey(viewKey)) {
    return <p className="text-white/70">Only a 360° walk video from the bucket (?v=scenes/…/….mp4) can be cut here.</p>;
  }

  const primary = "rounded-md bg-[#00B8C8] px-3 py-2 text-[14px] font-bold text-black disabled:opacity-40";
  const quiet = "rounded-md border border-white/25 px-3 py-2 text-[13px] text-white/85";
  const field = "w-[4.5rem] rounded-md border border-white/20 bg-black/50 px-1.5 py-1 text-right font-mono text-[14px] text-white";
  const small = "rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/75 hover:bg-white/10";
  const title = "text-[15px] font-bold";
  const back = (s: Step) => <button className={quiet} onClick={() => { setNote(null); setStep(s); }}>← Back</button>;
  const said = note && <p className="whitespace-pre-line text-[12px] text-amber-200">{note}</p>;

  // The list as parts, checked as a whole (order, overlaps, the video's length).
  const rowProblems = rows.map((r) => rowProblem(r, duration));
  const parsed = rows.map((r) => ({ from: readTime(r.from) ?? NaN, to: readTime(r.to) ?? NaN }));
  const whole = rows.length && rowProblems.every((p) => !p) ? checkParts(parsed, duration) : null;
  const ready = Boolean(whole && !whole.problems.length);

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
    const verb = job?.kind === "restore" ? "Putting the original back" : "Cutting and stitching";
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
          <p className="text-white/60">The video is as it was; your list is kept.</p>
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

  if (step === "confirm" && whole) {
    return (
      <div className="space-y-2">
        <div className={title}>Stitch these {whole.parts.length} part{whole.parts.length > 1 ? "s" : ""} ({sayTime(keptSeconds(whole.parts))}) and replace the video?</div>
        <ol className="list-decimal ps-5 font-mono text-[13px] text-white/85">
          {whole.parts.map((p, i) => <li key={i}>{secs(p.from)} s – {secs(p.to)} s</li>)}
        </ol>
        <p className="text-white/70">
          Each part is cut out of the original, then they are stitched in this order and saved under the same name, so
          every link still works. Doors and product dots move with the picture; those in parts left out are taken off.
          The original is kept: «Put the original back» undoes it.
        </p>
        {said}
        <div className="flex gap-2">
          {back("list")}
          <button className={`${primary} flex-1`} onClick={() => void start({ action: "cut", key: viewKey, parts: whole.parts })}>
            Stitch and replace
          </button>
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

  // THE LIST.
  const now = nowOnOriginal();
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <div className={title}>Parts to keep</div>
      <p className="text-[12px] text-white/55">
        Start and end in seconds of the {original ? "original " : ""}video (0 – {secs(duration)} s){now !== null ? ` · the video is at ${secs(now)} s now` : ""}.
        {lastParts.length > 0 && " The list starts from what the last cut kept."}
      </p>
      {rows.length === 0 && <p className="text-white/70">No parts yet. Add the first part worth walking.</p>}
      <ol className="space-y-1.5">
        {rows.map((r, i) => {
          const f = readTime(r.from), t = readTime(r.to);
          return (
            <li key={i} className="rounded-md bg-white/5 p-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-5 text-right font-mono text-[12px] text-white/50">{i + 1}.</span>
                <input className={field} value={r.from} inputMode="decimal" placeholder="start" aria-label={`Part ${i + 1} start (seconds)`}
                  onChange={(e) => update(i, { from: e.target.value })} />
                <span className="text-white/50">–</span>
                <input className={field} value={r.to} inputMode="decimal" placeholder="end" aria-label={`Part ${i + 1} end (seconds)`}
                  onChange={(e) => update(i, { to: e.target.value })} />
                <span className="text-[11px] text-white/45">s</span>
                <button className="ms-auto px-1 text-white/60 hover:text-white" aria-label={`Delete part ${i + 1}`}
                  onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 ps-6">
                {now !== null && <>
                  <button className={small} onClick={() => update(i, { from: secs(now) })}>start = now</button>
                  <button className={small} onClick={() => update(i, { to: secs(now) })}>end = now</button>
                </>}
                {f !== null && (
                  <button className={small} onClick={() => seekOriginal(f)}>go to start</button>
                )}
                <span className={`text-[11px] ${rowProblems[i] ? "text-amber-200" : "text-white/45"}`}>
                  {rowProblems[i] ?? (f !== null && t !== null ? `${sayTime(f)} – ${sayTime(t)} · ${secs(t - f)} s` : "")}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {whole && whole.problems.length > 0 && <p className="whitespace-pre-line text-[12px] text-amber-200">{whole.problems.join("\n")}</p>}
      {said}
      <button className={`${quiet} w-full`} onClick={() => setRows([...rows, { from: now !== null ? secs(now) : "", to: "" }])}>+ Add a part</button>
      <button className={`${primary} w-full`} disabled={!ready} onClick={() => { setNote(null); setStep("confirm"); }}>
        {ready && whole ? `Stitch ${whole.parts.length} part${whole.parts.length > 1 ? "s" : ""} (${sayTime(keptSeconds(whole.parts))}) and replace the video →` : "Stitch and replace the video →"}
      </button>
      {original && (
        <button className="text-[12px] text-white/60 underline" onClick={() => setStep("undo")}>Put the original back</button>
      )}
    </div>
  );
}
