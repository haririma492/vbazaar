"use client";

/**
 * `/operator/agents` — WHAT EVERY AGENT IS DOING, ON ONE SCREEN (owner,
 * 2026-11-04: "is there a dashboard that I can see what my agents are doing
 * at each point"). Refreshes itself every 5 s from `/api/operator/agents`:
 * what waits for a person (first, in red), the server's running change, each
 * store's crew step by step with its live note and AI spent, the background
 * jobs, and each walk's products. Only reads: nothing here starts or spends.
 */

import { useEffect, useState } from "react";
import { getJson } from "@/components/stores/upload";
import { Card } from "@/components/stores/ui";

type Step = { name: string; say: string; state: string; tries: number; note: string; at: string | null };
type Board = {
  server: { commit: string | null; message: string | null; startedAt: string; now: string };
  needsYou: Array<{ what: string; where: string; link?: string }>;
  stores: Array<{ slug: string; name: { en: string; fa: string }; status: { en: string; tone: string }; live: boolean; spentCents: number; budgetCents: number; updatedAt: string; walk: string | null; steps: Step[] }>;
  jobs: Array<{ id: string; name: string; what: string; busy: boolean; waiting: string[]; current?: string; note?: string }>;
  shadow: { key: string; phase: string; note: string; at: string; looked: number; spentCents: number } | null;
  walks: Array<{ key: string; title: string | null; products: number; outlines: number; fine: boolean | null; pace: number | null; doors: number }>;
};

const STATE: Record<string, { dot: string; say: string }> = {
  working: { dot: "bg-amber-300 animate-pulse", say: "working" },
  done: { dot: "bg-emerald-400", say: "done" },
  todo: { dot: "bg-white/25", say: "waiting its turn" },
  failed: { dot: "bg-rose-400", say: "failed" },
  "needs-you": { dot: "bg-rose-500", say: "needs you" },
};
const TONE: Record<string, string> = { work: "text-amber-200", you: "text-rose-200", ready: "text-emerald-200", live: "text-emerald-300" };

/** "3 min ago", from an ISO time and the server's now. */
function ago(at: string | null, now: string): string {
  if (!at) return "";
  const s = Math.max(0, (Date.parse(now) - Date.parse(at)) / 1000);
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const short = (key: string) => key.replace(/^scenes\//, "");
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function AgentsBoard() {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seen, setSeen] = useState<string>("");
  useEffect(() => {
    let gone = false;
    const load = () => getJson<Board>("/api/operator/agents")
      .then((o) => { if (!gone) { setB(o); setErr(null); setSeen(new Date().toLocaleTimeString()); } })
      .catch((e) => { if (!gone) setErr((e as Error).message); });
    void load();
    const id = setInterval(load, 5000);
    return () => { gone = true; clearInterval(id); };
  }, []);

  if (!b) return <p dir="ltr" className="p-6 text-center text-white/60">{err ? `Could not read the agents: ${err}` : "Reading the agents…"}</p>;
  const working = b.stores.flatMap((s) => s.steps.filter((st) => st.state === "working").map((st) => ({ s, st })));

  return (
    <div dir="ltr" className="space-y-4 text-left">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-amber-200">Your agents</h1>
          <p className="text-[13px] text-white/50">Every 5 s · last read {seen}{err ? ` · ⚠️ ${err}` : ""}</p>
        </div>
        <p className="text-[12px] text-white/50">
          Server running {b.server.commit ? <code className="text-white/80">{b.server.commit}</code> : "this change"}
          {b.server.message ? ` — ${b.server.message}` : ""} · started {ago(b.server.startedAt, b.server.now)}
        </p>
      </header>

      <Card className={b.needsYou.length ? "border-rose-400/60" : ""}>
        <h2 className={`text-[15px] font-bold ${b.needsYou.length ? "text-rose-200" : "text-emerald-200"}`}>
          {b.needsYou.length ? `Waiting for you — ${b.needsYou.length}` : "Nothing is waiting for you"}
        </h2>
        {b.needsYou.map((n, i) => (
          <p key={i} className="mt-1.5 text-[13px] text-rose-100/90">
            <b>{n.where}</b> · {n.what} {n.link && <a href={n.link} className="underline text-rose-200">open →</a>}
          </p>
        ))}
      </Card>

      <Card>
        <h2 className="text-[15px] font-bold text-amber-100">Working now — {working.length + b.jobs.filter((j) => j.busy).length + (b.shadow && (b.shadow.phase === "finding" || b.shadow.phase === "softening") ? 1 : 0)}</h2>
        {working.length === 0 && !b.jobs.some((j) => j.busy) && !(b.shadow && (b.shadow.phase === "finding" || b.shadow.phase === "softening")) && <p className="mt-1 text-[13px] text-white/50">No agent is working right now.</p>}
        {working.map(({ s, st }) => (
          <p key={`${s.slug}-${st.name}`} className="mt-1.5 text-[13px]">
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-amber-300 animate-pulse" />
            <b>{s.name.en}</b> · {st.say} — <span className="text-amber-100">{st.note || "starting…"}</span>
            <span className="text-white/40"> · {money(s.spentCents)} of {money(s.budgetCents)}</span>
          </p>
        ))}
        {b.jobs.filter((j) => j.busy).map((j) => (
          <p key={j.id} className="mt-1.5 text-[13px]"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-amber-300 animate-pulse" /><b>{j.name}</b> — on {j.current ? short(j.current) : j.waiting[0] ? short(j.waiting[0]) : "a walk"}{j.note ? `: ${j.note}` : ""}{j.waiting.length > 1 ? `, ${j.waiting.length - 1} more waiting` : ""}</p>
        ))}
        {b.shadow && (b.shadow.phase === "finding" || b.shadow.phase === "softening") && (
          <p className="mt-1.5 text-[13px]"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-amber-300 animate-pulse" /><b>Shadow agent</b> — {b.shadow.note} ({short(b.shadow.key)}, {money(b.shadow.spentCents)})</p>
        )}
      </Card>

      <h2 className="pt-2 text-[16px] font-bold text-amber-100">Stores — the Store Builder crew</h2>
      {b.stores.map((s) => (
        <Card key={s.slug}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <a href={`/stores/${s.slug}`} className="text-[15px] font-bold text-white underline-offset-2 hover:underline">{s.name.en || s.slug} <span dir="rtl" className="text-white/50">{s.name.fa}</span></a>
            <span className={`text-[13px] ${TONE[s.status.tone] ?? ""}`}>{s.status.en}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10" title="AI spent of this store's budget">
            <div className="h-full bg-amber-300/80" style={{ width: `${Math.min(100, (s.spentCents / s.budgetCents) * 100)}%` }} />
          </div>
          <p className="mt-0.5 text-[12px] text-white/45">AI {money(s.spentCents)} of {money(s.budgetCents)} · changed {ago(s.updatedAt, b.server.now)}</p>
          <ol className="mt-2 space-y-1">
            {s.steps.map((st) => (
              <li key={st.name} className="flex gap-2 text-[13px]">
                <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATE[st.state]?.dot ?? "bg-white/25"}`} />
                <span className="min-w-0">
                  <b className="text-white/90">{st.say}</b> <span className="text-white/45">· {STATE[st.state]?.say ?? st.state}{st.tries ? ` · try ${st.tries}` : ""}{st.at ? ` · ${ago(st.at, b.server.now)}` : ""}</span>
                  {st.note && <span className={`block ${st.state === "failed" || st.state === "needs-you" ? "text-rose-200" : "text-white/65"}`}>{st.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ))}

      <h2 className="pt-2 text-[16px] font-bold text-amber-100">Background jobs (free, no AI)</h2>
      <Card>
        {b.jobs.map((j) => (
          <p key={j.id} className="mt-1 text-[13px] first:mt-0">
            <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${j.busy ? "bg-amber-300 animate-pulse" : j.waiting.length ? "bg-white/40" : "bg-emerald-400"}`} />
            <b>{j.name}</b> — {j.busy ? "working" : j.waiting.length ? `${j.waiting.length} waiting` : "nothing waiting"} <span className="text-white/45">· {j.what}</span>
          </p>
        ))}
        <p className="mt-1 text-[13px]">
          <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${!b.shadow ? "bg-white/25" : b.shadow.phase === "failed" ? "bg-rose-400" : b.shadow.phase === "done" ? "bg-emerald-400" : "bg-amber-300 animate-pulse"}`} />
          <b>Shadow agent</b> (on a walk&apos;s ?edit=1; up to $0.30 a scene) — {b.shadow ? `${b.shadow.phase}: ${b.shadow.note} · ${short(b.shadow.key)} · ${ago(b.shadow.at, b.server.now)}` : "never run"}
        </p>
      </Card>

      <h2 className="pt-2 text-[16px] font-bold text-amber-100">Walks — products on each</h2>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-white/50"><tr><th className="py-1 pr-3 text-left font-normal">Walk</th><th className="pr-3 text-right font-normal">Products</th><th className="pr-3 text-right font-normal">Outlines</th><th className="pr-3 text-left font-normal">Pins</th><th className="pr-3 text-right font-normal">Pace</th><th className="text-right font-normal">Doors</th></tr></thead>
            <tbody>
              {b.walks.map((w) => (
                <tr key={w.key} className="border-t border-white/5">
                  <td className="py-1 pr-3"><a href={`/vca/walk?v=${encodeURIComponent(w.key)}`} className="hover:underline">{w.title ?? short(w.key)}</a></td>
                  <td className="pr-3 text-right">{w.products}</td>
                  <td className="pr-3 text-right">{w.outlines}</td>
                  <td className="pr-3">{w.fine === null ? "—" : w.fine ? "fine follow" : "old follow (waiting)"}</td>
                  <td className="pr-3 text-right">{w.pace ? `${w.pace} m/s` : "—"}</td>
                  <td className="text-right">{w.doors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
