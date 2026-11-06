"use client";

/**
 * «Refresh all agents» (owner, 2026-11-06: "going forward add ONE KEY for me to initiate all agent refreshment").
 * One key for the operator: the store's agents in order (`lib/stores/refreshAll.ts`), with what each one did.
 * It spends a little (the Shelf finder on Opus, the readers on Haiku), so it asks first and names the ceiling.
 */

import { useCallback, useEffect, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, KEY, Said } from "./ui";
import type { RefreshRun } from "@/lib/stores/refreshAll";

export default function RefreshAllCard({ api, spentCents, budgetCents }: { api: string; spentCents: number; budgetCents: number }) {
  const [run, setRun] = useState<RefreshRun | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setRun((await postJson<{ run: RefreshRun | null }>(api, { action: "refreshState" })).run); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]);
  const room = Math.max(0, budgetCents - spentCents) / 100;
  async function go() {
    if (!confirm(`Refresh all agents, in order: find the shelves not pictured yet (up to ~$2) → rebuild the store map → film the Shelf Tour → read the titles not read yet (Haiku, cents) → read any new shelf photos (Haiku, a few cents each). About $2–3 in all, from the store's AI budget ($${room.toFixed(2)} left); each step stops by itself at the budget. It takes 20–40 minutes.`)) return;
    try { const j = await postJson<{ note: string }>(api, { action: "refreshAll" }); setSaid({ ok: true, text: `${j.note} This card follows each step. · شروع شد` }); void load(); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={KEY} disabled={Boolean(run?.running)} onClick={() => void go()}>🔄 به‌روزرسانی همهٔ عامل‌ها · Refresh all agents</button>
        <Bi fa="همه به ترتیب" en="Every agent, in the right order: new shelves → map → Shelf Tour → titles → shelf photos" className="text-[12px] text-white/55" />
      </div>
      {run && (
        <ol dir="ltr" className="mt-3 space-y-1 text-left text-[13px]">
          {run.steps.map((s, i) => (
            <li key={i}>
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${s.note === "working…" ? "animate-pulse bg-amber-300" : /^Failed|Stopped|budget/i.test(s.note) ? "bg-rose-400" : "bg-emerald-400"}`} />
              <b>{s.name}</b>: <span className="text-white/70">{s.note}</span>
            </li>
          ))}
          <li className="text-white/45">{run.running ? `Running since ${new Date(run.started).toLocaleTimeString()}…` : `Finished ${run.finished ? new Date(run.finished).toLocaleString() : ""}`}</li>
        </ol>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
