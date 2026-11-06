"use client";

/**
 * THE TIDY AGENT on the store's page (owner, 2026-11-06: "an agent that identify ugly unfitted junk or object and
 * replace them with some products … at the end of store page there has to be a list of photos of those removed
 * objects"). The operator starts it (it spends from the store's budget, at most $2, asked first); the list under it
 * is every object hidden, as it was filmed, beside what stands in its place now. Each one, for the operator:
 * «Bring it back» or «Another product», one question each (`lib/stores/tidy.ts`). The owner sees the card and its
 * list, read only (owner, 2026-11-06: "let the owner see the result of this feature but not able to run it").
 */

import { useCallback, useEffect, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, FIELD, KEY, QUIET, Said } from "./ui";

type Cover = { id: string; what: string; photo: string; image: string; n: number; t: number; base: "table" | "floor" | "wall" };
type Run = { phase: string; note: string; at: string; working: boolean; looked: number; moments: number } | null;
type State = { run: Run; covers: Cover[]; ceiling: number };

const BASE = { table: "on a stand on its table · روی همان میز", floor: "on a plinth on the floor · روی سکو", wall: "on a card on the wall · روی دیوار" };
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function TidyCard({ api, operator, products, spentCents, budgetCents }: {
  api: string; operator: boolean; products: Array<{ n: number; en?: string; fa?: string; photo?: string }>; spentCents: number; budgetCents: number;
}) {
  const [st, setSt] = useState<State | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<{ id: string; kind: "back" | "all" | "product"; n: string } | null>(null);
  const load = useCallback(async () => {
    try { setSt(await postJson<State>(api, { action: "tidyState" })); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 8000); return () => clearInterval(id); }, [load]);

  const room = Math.max(0, budgetCents - spentCents) / 100;
  const ceiling = (st?.ceiling ?? 200) / 100;
  const working = Boolean(st?.run?.working);
  const nameOf = (n: number) => { const p = products.find((x) => x.n === n); return p ? p.en || p.fa || `#${n}` : `#${n}`; };

  async function start() {
    if (!confirm(`Run the Tidy agent? Claude looks through the store's walk for clutter (a sweater on a desk, papers, an old chair, boxes…) and hides each piece behind one of the store's products on a stand. At most $${ceiling.toFixed(2)} from the store's AI budget ($${room.toFixed(2)} left). It takes 10–30 minutes; the video itself is not changed.`)) return;
    try { await postJson(api, { action: "tidy" }); setSaid({ ok: true, text: "Started. This card follows it. · شروع شد" }); void load(); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  }
  async function answer() {
    if (!ask) return;
    try {
      const j = ask.kind !== "product"
        ? await postJson<{ note: string }>(api, { action: "tidyDrop", id: ask.kind === "all" ? "all" : ask.id })
        : await postJson<{ note: string }>(api, { action: "tidyProduct", id: ask.id, n: Number(ask.n) });
      setSaid({ ok: true, text: `✓ ${j.note}` });
      setAsk(null);
      void load();
    } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-[17px] font-bold">🧹 عامل مرتب‌سازی · The Tidy agent</div>
        {operator && <button type="button" className={KEY} disabled={working} onClick={() => void start()}>{st?.covers.length ? "Run it again" : "Find and hide clutter"}</button>}
      </div>
      <Bi className="mt-1 text-[13px] text-white/60"
        fa="وسایل نامرتب (لباس روی میز، کاغذ، صندلی کهنه، کارتن) با یکی از محصولات فروشگاه روی پایه پوشانده می‌شوند. ویدیو تغییر نمی‌کند."
        en="Clutter in the walk (a sweater on a desk, papers, an old chair, boxes) is hidden behind one of the store's products on a stand. The video is not changed." />
      {st?.run && (
        <p className={`mt-2 rounded-md p-2 text-[13px] ${working ? "bg-white/10" : st.run.phase === "failed" ? "bg-red-500/15 text-red-100" : "bg-emerald-500/15 text-emerald-100"}`}>
          {working ? "⏳ " : st.run.phase === "failed" ? "Not done: " : "✓ "}{st.run.note}
        </p>
      )}

      {st && st.covers.length > 0 && (
        <>
          <div className="mt-4 text-[15px] font-bold">اشیای برداشته‌شده · Objects removed ({st.covers.length})</div>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {st.covers.map((c) => (
              <li key={c.id} className="rounded-lg border border-white/10 bg-black/25 p-2">
                <div className="flex items-center gap-2">
                  <img src={c.photo} alt={c.what} className="h-28 w-28 flex-none rounded object-cover" loading="lazy" />
                  <span className="text-white/40">→</span>
                  <img src={c.image} alt={nameOf(c.n)} className="h-28 w-24 flex-none rounded bg-[#103048] object-contain p-1" loading="lazy" />
                </div>
                <div className="mt-1 text-[13px]"><b>{c.what}</b> <span className="text-white/45">at {clock(c.t)}</span></div>
                <div className="text-[12px] text-white/60">Now: #{c.n} {nameOf(c.n)}, {BASE[c.base]}</div>
                {!operator ? null : ask?.id === c.id ? (
                  <div className="mt-2 space-y-2">
                    {ask.kind === "all" ? (
                      <p className="text-[13px]">No tidying at all: bring all {st.covers.length} objects back into the walk, as it was filmed? Later runs will leave them. · همه برگردانده شوند؟</p>
                    ) : ask.kind === "back" ? (
                      <p className="text-[13px]">Bring «{c.what}» back into the walk, as it was filmed? Later runs will leave it.</p>
                    ) : (
                      <label className="block text-[13px]">Which product stands there instead? Its number:
                        <input className={`${FIELD} mt-1`} inputMode="numeric" value={ask.n} autoFocus onChange={(e) => setAsk({ ...ask, n: e.target.value.replace(/\D/g, "") })} />
                        {ask.n && <span className="mt-1 block text-white/60">{products.some((p) => p.n === Number(ask.n) && p.photo) ? nameOf(Number(ask.n)) : "No product with a photo has that number."}</span>}
                      </label>
                    )}
                    <div className="flex gap-2">
                      <button type="button" className={KEY} disabled={ask.kind === "product" && !products.some((p) => p.n === Number(ask.n) && p.photo)} onClick={() => void answer()}>{ask.kind === "all" ? "Yes, bring them all back" : ask.kind === "back" ? "Yes, bring it back" : "Save"}</button>
                      <button type="button" className={QUIET} onClick={() => setAsk(null)}>← Back</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={QUIET} onClick={() => setAsk({ id: c.id, kind: "back", n: "" })}>Bring it back · برگرداندن</button>
                    <button type="button" className={QUIET} onClick={() => setAsk({ id: c.id, kind: "product", n: String(c.n) })}>Another product · محصول دیگر</button>
                    <button type="button" className={QUIET} onClick={() => setAsk({ id: c.id, kind: "all", n: "" })}>No tidying at all · بدون مرتب‌سازی</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {st && !st.run && !st.covers.length && (
        <p className="mt-2 text-[13px] text-white/55">Not run on this store yet. · هنوز اجرا نشده است.</p>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
