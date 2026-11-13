"use client";

/**
 * «Refresh all agents» (owner, 2026-11-06: "going forward add ONE KEY for me to initiate all agent refreshment").
 * One key for the operator: the store's agents in order (`lib/stores/refreshAll.ts`), with what each one did.
 * It spends a little (the Shelf finder on Opus, the readers on Haiku), so it asks first and names the ceiling.
 *
 * A STEP CAN BE SKIPPED (owner, 2026-11-13: "allow operator to skip a step … even in the middle of execution or
 * before"). Before: every step has a tick, all on; unticked ones are left out of the run. During: every step not
 * finished has «Skip», the one being worked on too (the run goes on; what that agent had in hand finishes behind).
 */

import { useCallback, useEffect, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, KEY, Said } from "./ui";
import type { RefreshRun } from "@/lib/stores/refreshAll";
import { REFRESH_STEPS, stepStates } from "@/lib/stores/refreshSteps";

export default function RefreshAllCard({ api, spentCents, budgetCents, editUrl }: { api: string; spentCents: number; budgetCents: number; editUrl?: string | null }) {
  const [run, setRun] = useState<RefreshRun | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setRun((await postJson<{ run: RefreshRun | null }>(api, { action: "refreshState" })).run); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]);
  const room = Math.max(0, budgetCents - spentCents) / 100;
  /** The steps unticked for the next run. */
  const [off, setOff] = useState<string[]>([]);
  async function skip(step: string) {
    try { const j = await postJson<{ note: string }>(api, { action: "refreshSkip", step }); setSaid({ ok: true, text: j.note }); void load(); }
    catch (e) { setSaid({ ok: false, text: `Not skipped: ${(e as Error).message}` }); }
  }
  async function go() {
    if (off.length >= REFRESH_STEPS.length) { setSaid({ ok: false, text: "Every step is unticked: tick at least one." }); return; }
    if (!confirm(`${off.length ? `Without: ${off.join(", ")}. ` : ""}Refresh all agents, in order: find the shelves not pictured yet (up to ~$2) → rebuild the store map → film the Shelf Tour → read the titles not read yet (Haiku, cents) → read any new shelf photos (Haiku, a few cents each) → stitch any shelf zoom photos waiting (free). About $2–3 in all, from the store's AI budget ($${room.toFixed(2)} left); each step stops by itself at the budget. It takes 20–40 minutes.`)) return;
    try { const j = await postJson<{ note: string }>(api, { action: "refreshAll", skip: off }); setSaid({ ok: true, text: `${j.note} This card follows each step. · شروع شد` }); void load(); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={KEY} disabled={Boolean(run?.running)} onClick={() => void go()}>🔄 به‌روزرسانی همهٔ عامل‌ها · Refresh all agents</button>
        <Bi fa="همه به ترتیب" en="Every agent, in the right order: new shelves → map → Shelf Tour → titles → shelf photos → zoom photos" className="text-[12px] text-white/55" />
      </div>
      {!run?.running && (
        <div dir="ltr" className="mt-3 text-left text-[13px]">
          <p className="text-white/55">Steps of the next run (untick one to skip it):</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {REFRESH_STEPS.map((n) => (
              <label key={n} className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={!off.includes(n)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((x) => x !== n) : [...o, n]))} />
                <span className={off.includes(n) ? "text-white/40 line-through" : ""}>{n}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {run && (
        <ol dir="ltr" className="mt-3 space-y-1 text-left text-[13px]">
          {stepStates(run).filter((s) => s.state !== "off").map((s) => (
            <li key={s.name}>
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${s.state === "working" ? "animate-pulse bg-amber-300" : s.state === "failed" ? "bg-rose-400" : s.state === "skipped" ? "bg-white/30" : s.state === "waiting" ? "border border-white/40" : "bg-emerald-400"}`} />
              <b>{s.name}</b>{s.note || s.state === "waiting" ? ": " : ""}<span className="text-white/70">{s.note || (s.state === "waiting" ? "waiting its turn" : "")}</span>
              {run.running && (s.state === "working" || s.state === "waiting") && (
                <button type="button" className="ml-2 rounded border border-white/25 bg-white/10 px-2 py-0.5 text-[12px] hover:bg-white/20" onClick={() => void skip(s.name)}>Skip · رد کردن</button>
              )}
            </li>
          ))}
          <li className="text-white/45">{run.running ? `Running since ${new Date(run.started).toLocaleTimeString()}…` : `Finished ${run.finished ? new Date(run.finished).toLocaleString() : ""}`}</li>
        </ol>
      )}
      {/* What comes after it (owner, 2026-11-12: "after completion of Refresh all agents I need to be able as operator to draw rectangles on the shelf"). */}
      {run && !run.running && run.finished && editUrl && (
        <p dir="ltr" className="mt-3 rounded-md border border-emerald-300/30 bg-emerald-400/10 p-2 text-left text-[13px]">
          Next: <a className="font-bold text-emerald-200 underline" href={editUrl} target="_blank" rel="noreferrer">mark the shelves on the walk ↗</a> (editor → «Shelves»: a rectangle round each shelf, its number and name).
          Then «Shelf zoom photos» below: choose the shelf, add its photos (up to six). · مرحلهٔ بعد: علامت‌گذاری قفسه‌ها
        </p>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
