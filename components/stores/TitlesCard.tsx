"use client";

/**
 * THE BOOK TITLES, ON THE STORE'S PAGE (owner, 2026-11-05: "what happened to the
 * OCR can we assemble a list of farsi titles"). The title reader (`lib/stores/
 * titles.ts`, built 2026-11-04) had no screen: nobody could start it, see what
 * it read or take the list away. Here: the list (Farsi title first), a search,
 * a CSV download (opens in Excel with the Farsi intact), and, for the operator,
 * «Read the titles not read yet» — it spends from the store's AI budget, so it
 * asks first and names the ceiling.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, FIELD, QUIET, Said } from "./ui";
import type { TitleList, TitleRow } from "@/lib/stores/titles";

/** About this much a book (3 close-ups, one request): what the confirm names. */
const CENTS_A_BOOK = 3;

const fold = (v: string) => v.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ").replace(/\s+/g, " ").trim();

export default function TitlesCard({ api, operator, products, spentCents, budgetCents }: { api: string; operator: boolean; products: number; spentCents: number; budgetCents: number }) {
  const [list, setList] = useState<TitleList | null>(null);
  const [q, setQ] = useState("");
  const [farsiOnly, setFarsiOnly] = useState(true);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setList((await postJson<{ titles: TitleList | null }>(api, { action: "titles" })).titles); }
    catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const rows = useMemo(() => {
    const all = (list?.rows ?? []).filter((r) => r.readable !== "no" && (!farsiOnly || r.title_fa.trim()));
    const f = fold(q);
    const hit = f ? all.filter((r) => fold(`${r.title_fa} ${r.title_en} ${r.author} #${r.n}`).includes(f)) : all;
    return [...hit].sort((a, b) => (a.readable === b.readable ? 0 : a.readable === "full" ? -1 : 1) || a.title_fa.localeCompare(b.title_fa, "fa"));
  }, [list, q, farsiOnly]);

  const read = list?.rows.length ?? 0;
  const full = list?.rows.filter((r) => r.readable === "full").length ?? 0;
  const partial = list?.rows.filter((r) => r.readable === "partial").length ?? 0;
  const left = Math.max(0, products - read);
  const room = Math.max(0, budgetCents - spentCents);

  function csv() {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ["number", "title_fa", "title_en", "author", "readable", "confidence"];
    const body = rows.map((r: TitleRow) => [r.n, r.title_fa, r.title_en, r.author, r.readable, r.confidence].map(cell).join(","));
    // A BOM so Excel reads the Farsi as UTF-8.
    const blob = new Blob(["﻿" + [head.join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `book-titles${farsiOnly ? "-farsi" : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function readMore() {
    const cost = (left * CENTS_A_BOOK) / 100;
    if (!confirm(`Read the titles of the ${left} books not read yet? About $${cost.toFixed(2)} (${CENTS_A_BOOK}¢ a book), from the store's AI budget ($${(room / 100).toFixed(2)} left). It stops by itself if the budget runs out.`)) return;
    try { await postJson(api, { action: "titlesRead" }); setSaid({ ok: true, text: "Reading the titles… about 20 s a book; this list fills in as it goes. · در حال خواندن عنوان‌ها…" }); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  }

  return (
    <Card>
      <Bi fa="فهرست عنوان کتاب‌ها" en="Book titles — read off the video by the title reader (OCR); a list beside the products, never over their names" className="text-[15px] font-bold text-amber-100" />
      <div dir="ltr" className="mt-2 space-y-2 text-left text-[13px]">
        <p className="text-white/70">
          {read ? `${read} of ${products} books read: ${full} in full, ${partial} in part, ${read - full - partial} not readable.` : `Not run on this store yet (${products} books).`}
          {list?.updated ? ` · last saved ${new Date(list.updated).toLocaleString()}` : ""}
        </p>
        {read > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${FIELD} max-w-xs`} dir="auto" placeholder="Search a title or author · جست‌وجو" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="flex items-center gap-1.5 text-white/70"><input type="checkbox" checked={farsiOnly} onChange={(e) => setFarsiOnly(e.target.checked)} /> Farsi titles only · فقط فارسی</label>
              <button type="button" className={QUIET} onClick={csv} disabled={!rows.length}>Download CSV ({rows.length}) · دانلود</button>
            </div>
            <ul dir="rtl" className="max-h-96 divide-y divide-white/10 overflow-auto rounded-lg bg-black/30 text-right">
              {rows.map((r) => (
                <li key={r.n} className="flex items-center gap-3 px-3 py-2">
                  {r.photo && <img src={r.photo} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-white">{r.title_fa || r.title_en}{r.readable === "partial" && <span className="ms-2 text-[11px] text-amber-200/70">(in part)</span>}</p>
                    <p dir="auto" className="text-[12px] text-white/50">{[r.author, r.title_fa && r.title_en ? r.title_en : ""].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span dir="ltr" className="shrink-0 text-[11px] text-white/40">#{r.n}</span>
                </li>
              ))}
              {!rows.length && <li className="px-3 py-3 text-white/50">Nothing matches.</li>}
            </ul>
          </>
        )}
      </div>
      {operator && left > 0 && (
        <button type="button" className={`${QUIET} mt-2`} onClick={() => void readMore()}>
          Read the titles not read yet ({left}, about ${((left * CENTS_A_BOOK) / 100).toFixed(2)}) · خواندن عنوان‌ها
        </button>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
