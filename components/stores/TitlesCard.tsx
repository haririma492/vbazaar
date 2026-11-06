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
import { Bi, Card, FIELD, FilePick, QUIET, Said } from "./ui";
import { uploadInParts } from "./upload";
import { CENTS_A_TILE, mergeSpines, type SpineRow } from "@/lib/stores/shelfTitlesRules";
import type { TitleList } from "@/lib/stores/titles";

type Shelf = { rows: SpineRow[]; done: number; photos: number; updated: string | null; reading: boolean; note: string };
/** One line of the list: from the video (a product's number) or from a shelf photo. */
type Line = { key: string; title_fa: string; title_en: string; author: string; readable: string; confidence: number; n?: number; photo?: string };
/** A phone photo is usually read as 4 tiles. */
const TILES_A_PHOTO = 4;

/** About this much a book (3 close-ups, one request): what the confirm names. */
const CENTS_A_BOOK = 3;

const fold = (v: string) => v.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ").replace(/\s+/g, " ").trim();

export default function TitlesCard({ api, operator, products, spentCents, budgetCents }: { api: string; operator: boolean; products: number; spentCents: number; budgetCents: number }) {
  const [list, setList] = useState<TitleList | null>(null);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [q, setQ] = useState("");
  const [farsiOnly, setFarsiOnly] = useState(true);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { const j = await postJson<{ titles: TitleList | null; shelf?: Shelf }>(api, { action: "titles" }); setList(j.titles); setShelf(j.shelf ?? null); }
    catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  // Both readings merged: the video's (by product) and the shelf photos', one line per book.
  const merged = useMemo<Line[]>(() => mergeSpines<Line>([
    ...(list?.rows ?? []).filter((r) => r.readable !== "no").map((r) => ({ key: `v${r.n}`, title_fa: r.title_fa, title_en: r.title_en, author: r.author, readable: r.readable, confidence: r.confidence, n: r.n, photo: r.photo })),
    ...(shelf?.rows ?? []).map((r, i) => ({ key: `s${i}`, title_fa: r.title_fa, title_en: r.title_en, author: r.author, readable: r.readable, confidence: r.confidence })),
  ]), [list, shelf]);
  const rows = useMemo(() => {
    const all = merged.filter((r) => !farsiOnly || r.title_fa.trim());
    const f = fold(q);
    const hit = f ? all.filter((r) => fold(`${r.title_fa} ${r.title_en} ${r.author} ${r.n ? `#${r.n}` : ""}`).includes(f)) : all;
    return [...hit].sort((a, b) => (a.readable === b.readable ? 0 : a.readable === "full" ? -1 : 1) || a.title_fa.localeCompare(b.title_fa, "fa"));
  }, [merged, q, farsiOnly]);

  const read = list?.rows.length ?? 0;
  const full = list?.rows.filter((r) => r.readable === "full").length ?? 0;
  const partial = list?.rows.filter((r) => r.readable === "partial").length ?? 0;
  const left = Math.max(0, products - read);
  const room = Math.max(0, budgetCents - spentCents);

  function csv() {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ["product_number", "title_fa", "title_en", "author", "readable", "confidence", "read_from"];
    const body = rows.map((r) => [r.n ?? "", r.title_fa, r.title_en, r.author, r.readable, r.confidence, r.n ? "video" : "shelf photo"].map(cell).join(","));
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
        {(shelf?.rows.length ?? 0) > 0 && <p className="text-white/70">From the shelf photos: {shelf!.rows.length} titles ({shelf!.done} of {shelf!.photos} photos read). Together: {merged.length} different titles, {merged.filter((r) => r.title_fa.trim()).length} in Farsi.</p>}
        {shelf?.reading && <p><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />Reading the shelf photos: {shelf.note}</p>}
        {merged.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${FIELD} max-w-xs`} dir="auto" placeholder="Search a title or author · جست‌وجو" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="flex items-center gap-1.5 text-white/70"><input type="checkbox" checked={farsiOnly} onChange={(e) => setFarsiOnly(e.target.checked)} /> Farsi titles only · فقط فارسی</label>
              <button type="button" className={QUIET} onClick={csv} disabled={!rows.length}>Download CSV ({rows.length}) · دانلود</button>
            </div>
            <ul dir="rtl" className="max-h-96 divide-y divide-white/10 overflow-auto rounded-lg bg-black/30 text-right">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-3 px-3 py-2">
                  {r.photo && <img src={r.photo} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-white">{r.title_fa || r.title_en}{r.readable === "partial" && <span className="ms-2 text-[11px] text-amber-200/70">(in part)</span>}</p>
                    <p dir="auto" className="text-[12px] text-white/50">{[r.author, r.title_fa && r.title_en ? r.title_en : ""].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span dir="ltr" className="shrink-0 text-[11px] text-white/40">{r.n ? `#${r.n}` : "📷 shelf"}</span>
                </li>
              ))}
              {!rows.length && <li className="px-3 py-3 text-white/50">Nothing matches.</li>}
            </ul>
          </>
        )}
      </div>
      {operator && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <FilePick
            fa="عکس قفسه‌ها با گوشی — برای خواندن همهٔ عنوان‌ها" en="Shelf photos (phone) — to read every title"
            accept=".jpg,.jpeg,.png,.webp,image/*" multiple
            hint="One photo per shelf section, about 1 m away, square on, the whole section in the picture, no flash glare. Every spine must be in focus: tap the screen on the books before taking it. About 60–100 photos for 700 books. Each is read once; upload more any time."
            current={shelf?.photos ? `${shelf.photos} photos uploaded, ${shelf.done} read` : null}
            send={async (file, onProgress) => { await uploadInParts(api, { action: "upload", kind: "shelf" }, file, onProgress); await load(); }}
          />
          {shelf && shelf.photos > shelf.done && !shelf.reading && (
            <button type="button" className={QUIET} onClick={async () => {
              const n = shelf.photos - shelf.done, cost = (n * TILES_A_PHOTO * CENTS_A_TILE) / 100;
              if (!confirm(`Read every spine in the ${n} shelf photos not read yet? About $${cost.toFixed(2)} (about ${TILES_A_PHOTO * CENTS_A_TILE}¢ a photo), from the store's AI budget ($${(room / 100).toFixed(2)} left). It stops by itself if the budget runs out.`)) return;
              try { await postJson(api, { action: "shelfTitlesRead" }); setSaid({ ok: true, text: "Reading the spines… about a minute a photo; the list fills in as it goes. · در حال خواندن عطف کتاب‌ها…" }); void load(); }
              catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
            }}>Read the spines in {shelf.photos - shelf.done} photos (about ${(((shelf.photos - shelf.done) * TILES_A_PHOTO * CENTS_A_TILE) / 100).toFixed(2)}) · خواندن عطف‌ها</button>
          )}
        </div>
      )}
      {operator && left > 0 && (
        <button type="button" className={`${QUIET} mt-2`} onClick={() => void readMore()}>
          Read the titles not read yet ({left}, about ${((left * CENTS_A_BOOK) / 100).toFixed(2)}) · خواندن عنوان‌ها
        </button>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
