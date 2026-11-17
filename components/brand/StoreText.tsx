"use client";

/**
 * «SEND A TEXT TO STORE», RIGHT OF THE STORE'S LOGO IN BOTH TOURS (owner, 2026-11-17: "on the right hand side of the store
 * logo add a field "Send a text to store" a small modal will open and both answer and response will appear"). The key
 * shows only when texting is set up (`/api/text/<slug>` says `enabled`). The box: the conversation (the shopper's texts
 * on one side, the store's answers on the other), a field and «Send». The conversation is kept on this device
 * (`vb.text.<slug>`), asked for again every 5 s while the box is open, every 30 s while closed (a dot says an answer came).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

type Msg = { from: "shopper" | "store"; text: string; at: string };

function convId(slug: string): string {
  const key = `vb.text.${slug}`;
  try {
    const have = window.localStorage.getItem(key);
    if (have && /^[a-z0-9]{12}$/.test(have)) return have;
    const a = "abcdefghijklmnopqrstuvwxyz0123456789";
    const r = crypto.getRandomValues(new Uint8Array(12));
    const id = Array.from(r, (b) => a[b % a.length]).join("");
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 14).padEnd(12, "0");
  }
}

export default function StoreText({ slug, name, className = "" }: { slug: string; name?: { en: string; fa?: string } | null; className?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [seen, setSeen] = useState(0); // store answers seen
  const id = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // Where the window stands (its top-left, in pixels); placed below the key the first time it opens.
  const [pos, setPos] = useState({ x: 12, y: 80 });
  const placed = useRef(false);
  useEffect(() => {
    if (!open || placed.current) return;
    placed.current = true;
    const w = Math.min(384, window.innerWidth - 16);
    setPos({ x: Math.max(8, Math.min(window.innerWidth - w - 8, 140)), y: Math.min(90, Math.max(8, window.innerHeight - 520)) });
  }, [open]);
  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = pos.y;
    const move = (ev: PointerEvent) => {
      const w = Math.min(384, window.innerWidth - 16);
      setPos({ x: Math.max(0, Math.min(window.innerWidth - w, ox + ev.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 60, oy + ev.clientY - sy)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const load = useCallback(async () => {
    id.current ??= convId(slug);
    try {
      const j = await (await fetch(`/api/text/${encodeURIComponent(slug)}?conv=${id.current}`, { cache: "no-store" })).json() as { enabled?: boolean; messages?: Msg[] };
      setEnabled(j.enabled === true);
      if (j.messages) setMsgs(j.messages);
    } catch { /* offline: try again later */ }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => void load(), open ? 5000 : 30000);
    return () => window.clearInterval(t);
  }, [enabled, open, load]);
  const answers = msgs.filter((m) => m.from === "store").length;
  useEffect(() => { if (open) setSeen(answers); }, [open, answers]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs, open]);

  async function send() {
    if (!draft.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/text/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conv: id.current, text: draft }) });
      const j = await r.json() as { ok?: boolean; messages?: Msg[]; error?: string };
      if (!j.ok) throw new Error(j.error || "Not sent.");
      setMsgs(j.messages ?? []);
      setDraft("");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  if (!enabled) return null;
  const en = name?.en || "the store", fa = name?.fa || name?.en || "فروشگاه";
  return (
    <>
      <button type="button" data-track="store-text" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`relative flex items-center gap-1.5 rounded-full border border-white/30 bg-black/60 px-3 py-1.5 text-[13px] font-semibold text-white shadow hover:bg-black/75 ${className}`}>
        💬 <span className="hidden sm:inline">Send a text to store</span>
        {answers > seen && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-black" aria-label="New answer" />}
      </button>
      {open && (
        // A floating window, not a sheet over the tour (owner, 2026-11-17: "make modal a movable window"): dragged by its
        // title bar, the store still in view behind it; × closes it.
        <div role="dialog" aria-label={`Message ${en}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-[90] flex max-h-[80vh] w-[min(24rem,calc(100vw-1rem))] flex-col rounded-2xl bg-white text-neutral-900 shadow-2xl ring-1 ring-black/10"
          style={{ left: pos.x, top: pos.y }}>
            <div className="flex cursor-move touch-none select-none items-center justify-between border-b border-neutral-200 px-4 py-3"
              onPointerDown={startDrag} title="Drag to move">
              <div>
                <p className="text-[15px] font-bold">💬 {en} <span className="text-[11px] font-normal text-neutral-400">⠿ drag</span></p>
                <p dir="rtl" className="text-[12px] text-neutral-500">پیام به {fa}</p>
              </div>
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)} aria-label="Close" className="rounded-full px-2 text-[22px] leading-none text-neutral-500">×</button>
            </div>
            <div ref={list} className="min-h-[10rem] flex-1 space-y-2 overflow-y-auto bg-neutral-50 px-3 py-3">
              {!msgs.length && <p className="px-2 pt-6 text-center text-[13px] text-neutral-500">Ask the store anything: a product, a price, opening hours. Their answer appears here.<br /><span dir="rtl">هر سؤالی دارید از فروشگاه بپرسید؛ پاسخ همین‌جا می‌آید.</span></p>}
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.from === "shopper" ? "justify-end" : "justify-start"}`}>
                  <p dir="auto" className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[14px] leading-snug ${m.from === "shopper" ? "rounded-br-sm bg-emerald-600 text-white" : "rounded-bl-sm bg-white text-neutral-900 ring-1 ring-neutral-200"}`}>
                    {m.text}
                    <span className={`mt-0.5 block text-[10px] ${m.from === "shopper" ? "text-white/70" : "text-neutral-400"}`}>
                      {m.from === "store" ? `${en} · ` : ""}{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <form className="flex items-end gap-2 border-t border-neutral-200 p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <textarea dir="auto" rows={2} maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your message · پیام شما"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                className="min-w-0 flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2 text-[14px] outline-none focus:border-emerald-500" />
              <button type="submit" disabled={busy || !draft.trim()} className="rounded-xl bg-emerald-600 px-4 py-2 text-[14px] font-bold text-white disabled:opacity-40">{busy ? "…" : "Send"}</button>
            </form>
            {err && <p className="px-3 pb-3 text-[12px] text-rose-600">{err}</p>}
        </div>
      )}
    </>
  );
}
