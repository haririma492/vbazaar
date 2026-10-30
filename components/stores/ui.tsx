"use client";

/**
 * What the Store Builder's screens share (`/stores`, `/stores/new`,
 * `/stores/<slug>`, `/stores/areas`): Farsi first with the English beside it
 * (owner, 2026-10-30), one thing per card, and nothing that fails silently
 * (founder, 2026-10-12: "modal questions otherwise we never know if the issue
 * is in pipeline or the way we use the UI").
 */

import { useRef, useState } from "react";
import type { Progress } from "./upload";

export const FIELD = "sk-field w-full rounded-lg bg-black/30 px-3 py-2.5 text-[15px] text-[--sk-ink] placeholder:text-white/30 outline-none";
export const KEY = "min-h-[44px] rounded-full border border-amber-300/50 bg-amber-300/15 px-5 text-[15px] font-bold text-amber-100 disabled:opacity-40";
export const QUIET = "min-h-[40px] rounded-full border border-white/15 px-4 text-[14px] text-white/75 disabled:opacity-40";

/** A label in Farsi with its English under it. */
export function Bi({ fa, en, className = "" }: { fa: string; en: string; className?: string }) {
  return (
    <span className={`block ${className}`}>
      <span className="sk-font block">{fa}</span>
      <span dir="ltr" className="block text-left text-[12px] font-normal text-white/45">{en}</span>
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function Said({ ok, text }: { ok?: boolean; text: string | null }) {
  if (!text) return null;
  return <p className={`mt-2 text-[13px] ${ok ? "text-emerald-300" : "text-rose-300"}`}>{text}</p>;
}

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);

/**
 * ONE FILE (or several, `multiple`) chosen and sent, its progress shown, and
 * «✓ Uploaded» or what went wrong said on the card.
 */
export function FilePick({
  fa, en, hint, accept, multiple, current, send,
}: {
  fa: string; en: string; hint?: string; accept: string; multiple?: boolean;
  current?: string | null;
  send: (file: File, onProgress: (p: Progress) => void) => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ name: string; p: Progress; i: number; of: number } | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async (files: File[]) => {
    setSaid(null);
    let okCount = 0;
    for (const [i, f] of files.entries()) {
      setBusy({ name: f.name, p: { sent: 0, total: f.size }, i, of: files.length });
      try {
        await send(f, (p) => setBusy({ name: f.name, p, i, of: files.length }));
        okCount++;
      } catch (e) {
        setSaid({ ok: false, text: `«${f.name}»: ${(e as Error).message}` });
        setBusy(null);
        return;
      }
    }
    setBusy(null);
    setSaid({ ok: true, text: `✓ ${okCount === 1 ? "Uploaded" : `${okCount} files uploaded`} · بارگذاری شد` });
  };
  return (
    <div>
      <Bi fa={fa} en={en} className="text-[15px] font-bold text-amber-100" />
      {hint && <p dir="ltr" className="mt-1 text-left text-[12px] text-white/45">{hint}</p>}
      {current && <p dir="ltr" className="mt-2 truncate text-left text-[13px] text-white/65">Now: {current}</p>}
      <input ref={input} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) void go(fs); }} />
      <button type="button" disabled={Boolean(busy)} onClick={() => input.current?.click()} className={`${KEY} mt-3`}>
        {busy ? "…" : current ? "انتخاب فایل دیگر · Choose another" : "انتخاب فایل · Choose file"}
      </button>
      {busy && (
        <div className="mt-3" dir="ltr">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-amber-300/80 transition-all" style={{ width: `${busy.p.total ? (busy.p.sent / busy.p.total) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-left text-[12px] text-white/55">
            {busy.of > 1 ? `${busy.i + 1} / ${busy.of} · ` : ""}{busy.name} — {mb(busy.p.sent)} of {mb(busy.p.total)}. Closing the page is fine: choose the same file again to carry on.
          </p>
        </div>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </div>
  );
}

export type StepView = { state: string; tries: number; note: string; at: string | null };

const DOT: Record<string, string> = { todo: "bg-white/25", working: "bg-amber-300 animate-pulse", done: "bg-emerald-400", failed: "bg-rose-400", "needs-you": "bg-rose-400" };
const STATE_SAY: Record<string, string> = { todo: "waiting · در صف", working: "working · در حال کار", done: "done · انجام شد", failed: "failed — will try again · ناموفق", "needs-you": "needs you · منتظر شما" };

/** The crew's steps, each with what it is doing or did. */
export function Steps({ steps, say }: { steps: Array<[string, StepView]>; say: Record<string, { en: string; fa: string }> }) {
  return (
    <ol className="space-y-3">
      {steps.map(([name, st]) => (
        <li key={name} className="flex gap-3">
          <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${st.state === "failed" && st.tries >= 3 ? DOT["needs-you"] : DOT[st.state] ?? DOT.todo}`} />
          <div className="min-w-0">
            <Bi fa={say[name]?.fa ?? name} en={`${say[name]?.en ?? name} — ${STATE_SAY[st.state === "failed" && st.tries >= 3 ? "needs-you" : st.state] ?? st.state}`} className="text-[14px] font-bold" />
            {st.note && <p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-[13px] text-white/70">{st.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export type Entry = { at: string; from: "owner" | "operator" | "crew"; text: string; open?: boolean };
const FROM: Record<Entry["from"], string> = { owner: "صاحب فروشگاه · Owner", operator: "اپراتور · Operator", crew: "تیم ساخت · The crew" };

/**
 * THE MESSAGE BOX TO THE CREW (owner, 2026-10-30): what is typed here is done
 * by the Messages agent in its next round, and its answer appears below it.
 */
export function Thread({ entries, send, hint }: { entries: Entry[]; send: (text: string) => Promise<void>; hint: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <Bi fa="پیام به تیم ساخت" en="Message the crew — they do it and answer here" className="text-[15px] font-bold text-amber-100" />
      <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
        {entries.length === 0 && <li className="text-[13px] text-white/45">No messages yet. · هنوز پیامی نیست.</li>}
        {entries.map((e, i) => (
          <li key={i} className={`rounded-xl px-3 py-2 ${e.from === "crew" ? "bg-emerald-400/10" : "bg-white/[0.06]"}`}>
            <p className="text-[11px] text-white/45">{FROM[e.from]} · {new Date(e.at).toLocaleString()}{e.open ? " · ⏳ working on it" : ""}</p>
            <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-[14px]">{e.text}</p>
          </li>
        ))}
      </ul>
      <textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={hint} className={`${FIELD} mt-3`} />
      <button
        type="button"
        disabled={busy || !text.trim()}
        className={`${KEY} mt-2`}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await send(text.trim());
            setText("");
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : "ارسال · Send"}
      </button>
      <Said text={err} />
    </div>
  );
}
