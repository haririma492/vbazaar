"use client";

/** `/stores` — the operator's list: every store, what the crew is doing with it, and the way to a new one and to the bazaar's areas. */

import { useEffect, useState } from "react";
import { STEPS } from "@/lib/stores/store";
import { getJson } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";

type Row = { slug: string; name: { en: string; fa: string }; status: { en: string; fa: string; tone: string }; live: boolean; spot: string | null; spent: number; steps: Record<string, { state: string }> };

const TONE: Record<string, string> = { work: "text-amber-200", you: "text-rose-200", ready: "text-emerald-200", live: "text-emerald-300" };

export default function StoresList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => getJson<{ stores: Row[] }>("/api/stores").then((o) => { setRows(o.stores); setErr(null); }).catch((e) => setErr((e as Error).message));
    void load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="sk-font text-2xl font-bold text-amber-200">فروشگاه‌های بازار</h1>
          <p dir="ltr" className="text-left text-[13px] text-white/50">The bazaar's stores — the Store Builder crew</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/stores/areas" className={`${QUIET} inline-flex items-center`}>بیرون، لابی، راهرو · Areas</a>
          <a href="/stores/new" className={`${KEY} inline-flex items-center`}>+ فروشگاه تازه · New store</a>
        </div>
      </header>
      <Said text={err} />
      {rows && rows.length === 0 && <Card><Bi fa="هنوز فروشگاهی نیست." en="No stores yet. «New store» asks its questions one at a time." /></Card>}
      {rows?.map((r) => {
        const done = STEPS.filter((n) => r.steps[n]?.state === "done").length;
        return (
          <a key={r.slug} href={`/stores/${r.slug}`} className="block">
            <Card className="transition hover:bg-white/[0.07]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="sk-font text-[17px] font-bold">{r.name.fa || r.name.en} <span dir="ltr" className="text-[13px] font-normal text-white/50">· {r.name.en}</span></span>
                <span className={`text-[13px] font-bold ${TONE[r.status.tone] ?? ""}`}>{r.status.fa} · {r.status.en}</span>
              </div>
              <p dir="ltr" className="mt-1 text-left text-[12px] text-white/45">
                {done}/{STEPS.length} steps · {r.spot ? `hallway ${r.spot}` : "no spot yet"} · AI ${(r.spent / 100).toFixed(2)}
              </p>
            </Card>
          </a>
        );
      })}
    </div>
  );
}
