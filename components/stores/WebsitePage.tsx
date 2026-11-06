"use client";

/**
 * `/stores/<slug>/website` — THE WEBSITE EXPLORER'S RESULT (owner, 2026-11-06). Everything read off the store's
 * own website: each product's photos (the largest the site serves), names in English and Farsi, price and sale
 * price, sizes, the site's shelf and the description. A search, a shelf filter and a spreadsheet to take away.
 *
 * The operator starts the run and answers its one question when there is one: robots.txt asks robots not to read
 * a path that holds the prices («Is this the store's own website, and has the store agreed?»). The page then
 * carries on by itself, showing each product as it is read.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { readAdminToken } from "@/lib/admin/useAdminMode";
import type { SiteProduct, WebsiteRun } from "@/lib/stores/websiteRules";
import { getJson, postJson } from "./upload";
import { Bi, Card, FIELD, KEY, QUIET, Said } from "./ui";

type Summary = { products: number; unlisted?: number; priced: number; onSale: number; photos: number; withoutPhoto: number; described: number; farsi: number; categories: string[] };
type Match = { n: number; seen: string; photo: string | null; matched: boolean; name: string; confidence: number; why: string; unsure?: boolean; opus?: boolean };
type Page = { who: "owner" | "operator"; website: string | null; name: { en: string; fa: string }; run: WebsiteRun | null; summary: Summary; matching?: Match[] | null };

const money = (c: number | null, cur = "CAD") => (c === null ? "—" : `$${(c / 100).toFixed(2)}${cur && cur !== "CAD" ? ` ${cur}` : ""}`);
const fold = (v: string) => v.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ").replace(/\s+/g, " ").trim();

function ProductCard({ p }: { p: SiteProduct }) {
  const [img, setImg] = useState(0);
  const [more, setMore] = useState(false);
  const photo = p.images[img];
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-black/25">
      <button type="button" className="relative aspect-square bg-white" onClick={() => p.images.length > 1 && setImg((img + 1) % p.images.length)} title={p.images.length > 1 ? "Next photo" : undefined}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={p.name.en || p.name.fa} loading="lazy" className="h-full w-full object-contain" />
        ) : <span className="text-[13px] text-black/40">No photo</span>}
        {p.images.length > 1 && <span dir="ltr" className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[11px] text-white">{img + 1}/{p.images.length}</span>}
        {p.compareAtCents !== null && <span className="absolute right-1 top-1 rounded bg-rose-600 px-1.5 text-[11px] font-bold text-white">SALE</span>}
      </button>
      {p.images.length > 1 && (
        <div className="flex flex-wrap gap-1 bg-black/30 p-1.5">
          {p.images.map((u, k) => (
            <button key={u} type="button" onClick={() => setImg(k)} aria-label={`Photo ${k + 1}`}
              className={`h-10 w-10 overflow-hidden rounded bg-white ${k === img ? "ring-2 ring-amber-300" : "opacity-75"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" loading="lazy" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-3 text-[13px]">
        {p.unlisted && <p className="text-[12px] text-amber-200">Draft on the store&apos;s site (not for sale there): shown for its photo, not put on the store&apos;s list.</p>}
        {p.name.fa && <p className="sk-font font-bold">{p.name.fa}</p>}
        {p.name.en && <p dir="ltr" className="text-left font-bold text-white/90">{p.name.en}</p>}
        <p dir="ltr" className="text-left">
          <span className="text-[15px] font-bold text-amber-200">{money(p.priceCents, p.currency)}</span>
          {p.compareAtCents !== null && <span className="ms-2 text-white/45 line-through">{money(p.compareAtCents, p.currency)}</span>}
          {p.available === false && <span className="ms-2 text-rose-300">out of stock</span>}
        </p>
        {p.category.length > 0 && <p dir="ltr" className="text-left text-[12px] text-white/50">{p.category.join(" › ")}</p>}
        {p.variants.length > 0 && (
          <p dir="ltr" className="text-left text-[12px] text-white/65">{p.variants.map((v) => `${v.title || "—"} ${money(v.priceCents, p.currency)}`).join(" · ")}</p>
        )}
        {(p.description.en || p.description.fa) && (
          <button type="button" className="text-start text-[12px] text-sky-300" onClick={() => setMore(!more)}>{more ? "Hide the description" : "Description · توضیحات"}</button>
        )}
        {more && (
          <div className="space-y-2 text-[12px] leading-relaxed text-white/75">
            {p.description.fa && <p className="sk-font">{p.description.fa}</p>}
            {p.description.en && <p dir="ltr" className="text-left">{p.description.en}</p>}
          </div>
        )}
        <a href={p.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="mt-auto pt-1 text-left text-[12px] text-sky-300 underline">On the store&apos;s site ↗</a>
      </div>
    </article>
  );
}

export default function WebsitePage({ slug }: { slug: string }) {
  const api = `/api/stores/${slug}/website`;
  const [page, setPage] = useState<Page | null>(null);
  const [err, setErr] = useState<{ status?: number; text: string } | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [shelf, setShelf] = useState("");
  const [view, setView] = useState<"products" | "photos">("photos");

  const load = useCallback(async () => {
    try { setPage(await getJson<Page>(api)); setErr(null); }
    catch (e) { setErr({ status: (e as { status?: number }).status, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const running = page?.run?.running === true;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [running, load]);

  const start = async (body: { fresh?: boolean; readDisallowed?: boolean }) => {
    setBusy(true); setSaid(null);
    try { const r = await postJson<{ note: string }>(api, { action: "run", ...body }); setSaid({ ok: true, text: r.note }); setTimeout(load, 1500); }
    catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const csv = async () => {
    const token = readAdminToken();
    const res = await fetch(`${api}?csv=1`, { headers: token ? { "x-admin-token": token } : {}, credentials: "same-origin" });
    if (!res.ok) { setSaid({ ok: false, text: `The spreadsheet could not be made (${res.status}).` }); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${slug}-website-products.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const products = page?.run?.products ?? [];
  const shown = useMemo(() => {
    const f = fold(q);
    return products.filter((p) => (!shelf || p.category[0] === shelf) && (!f || fold(`${p.name.en} ${p.name.fa} ${p.category.join(" ")} ${p.sku ?? ""}`).includes(f)));
  }, [products, q, shelf]);

  if (err) {
    return (
      <Card>
        <Bi fa="این صفحه باز نشد" en="This page could not open" className="text-[17px] font-bold" />
        <Said text={err.text} />
        {err.status === 401 && <a href={`/stores/${slug}`} className={`${KEY} mt-3 inline-flex items-center`}>Sign in on the store&apos;s page · ورود</a>}
      </Card>
    );
  }
  if (!page) return <p className="text-white/50">Loading… · در حال بارگذاری…</p>;

  const run = page.run;
  const op = page.who === "operator";
  const s = page.summary;
  return (
    <div className="space-y-4">
      <header>
        <a href={`/stores/${slug}`} className="text-[13px] text-sky-300">← {page.name.fa || page.name.en}</a>
        <h1 className="mt-1"><Bi fa="محصولات از وبسایت فروشگاه" en="Products from the store's website" className="text-[22px] font-bold" /></h1>
        {page.website && <a href={page.website} target="_blank" rel="noopener noreferrer" dir="ltr" className="block text-left text-[13px] text-white/55 underline">{page.website}</a>}
      </header>

      <Card>
        <Bi fa="کاوشگر وبسایت" en="Website Explorer" className="text-[16px] font-bold" />
        <p className="mt-1 text-[13px] text-white/60">
          Reads the store&apos;s own site: every product&apos;s name, price, sizes, description and largest photos. Free (no AI), one page at a time.
          Then puts them on the store&apos;s product list — the list the Free Tour and the Shelf Tour show — without overwriting what the owner changed, and finds them in the walk.
        </p>
        {run ? (
          <div className="mt-3 space-y-1 text-[13px]" dir="ltr">
            <p className={`text-left ${running ? "text-amber-200" : run.ask ? "text-rose-200" : "text-emerald-200"}`}>{run.note}</p>
            {run.method && <p className="text-left text-white/45">How: {run.method}</p>}
            {run.found > 0 && <p className="text-left text-white/45">Pages: {run.done.length} of {run.found} read · started {new Date(run.started).toLocaleString()}{run.finished ? ` · finished ${new Date(run.finished).toLocaleString()}` : ""}</p>}
            {run.integrated && <p className="text-left text-emerald-200/80">On the store&apos;s page ({new Date(run.integrated.at).toLocaleString()}): {run.integrated.note}</p>}
            {run.permission && <p className="text-left text-white/45">Disallowed paths: {run.permission.readDisallowed ? "read, the store agreed" : "not read"} ({run.permission.by}, {new Date(run.permission.at).toLocaleDateString()})</p>}
          </div>
        ) : <p className="mt-3 text-[13px] text-white/60">Not read yet. · هنوز خوانده نشده.</p>}

        {op && run?.ask && (
          <div className="mt-4 rounded-xl border border-rose-300/30 bg-rose-300/10 p-3">
            <Bi fa="آیا این وبسایتِ خودِ فروشگاه است و فروشگاه اجازه داده است؟" en="Is this the store's own website, and has the store agreed?" className="font-bold" />
            <p dir="ltr" className="mt-2 text-left text-[13px] text-white/70">{run.ask.why}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={KEY} disabled={busy} onClick={() => start({ readDisallowed: true })}>Yes, read it · بله</button>
              <button type="button" className={QUIET} disabled={busy} onClick={() => start({ readDisallowed: false })}>No: read only the pages it allows (no prices)</button>
            </div>
          </div>
        )}

        {op && !run?.ask && (
          <div className="mt-4 flex flex-wrap gap-2">
            {!run && <button type="button" className={KEY} disabled={busy || !page.website} onClick={() => start({})}>Read the website · خواندن وبسایت</button>}
            {run && !running && run.found > run.done.length && <button type="button" className={KEY} disabled={busy} onClick={() => start({})}>Carry on · ادامه</button>}
            {run && !running && <button type="button" className={QUIET} disabled={busy} onClick={() => start({ fresh: true })}>Read it all again</button>}
            {run && !running && run.products.length > 0 && (
              <button type="button" className={QUIET} disabled={busy} onClick={async () => {
                setBusy(true); setSaid(null);
                try { const r = await postJson<{ note: string }>(api, { action: "integrate" }); setSaid({ ok: true, text: r.note }); await load(); }
                catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
                finally { setBusy(false); }
              }}>Put on the store&apos;s page again · قرار دادن در صفحهٔ فروشگاه</button>
            )}
          </div>
        )}
        {!page.website && <Said text="The store has no website on its details. Add it on the store's page (مشخصات فروشگاه)." />}
        <Said ok={said?.ok} text={said?.text ?? null} />
      </Card>

      {products.length > 0 && (
        <Card>
          <div dir="ltr" className="flex flex-wrap gap-x-4 gap-y-1 text-left text-[13px] text-white/70">
            <span><b className="text-white">{s.products}</b> products</span>
            <span><b className="text-white">{s.priced}</b> with a price</span>
            <span><b className="text-white">{s.onSale}</b> on sale</span>
            <span><b className="text-white">{s.photos}</b> photos{s.withoutPhoto ? ` (${s.withoutPhoto} without)` : ""}</span>
            <span><b className="text-white">{s.described}</b> described</span>
            <span><b className="text-white">{s.farsi}</b> with Farsi</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className={`${FIELD} max-w-xs`} placeholder="Search · جستجو" value={q} onChange={(e) => setQ(e.target.value)} />
            {s.categories.length > 1 && (
              <select className={`${FIELD} max-w-xs`} value={shelf} onChange={(e) => setShelf(e.target.value)}>
                <option value="">All shelves · همه</option>
                {s.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button type="button" className={QUIET} onClick={csv}>Download the spreadsheet (.csv)</button>
          </div>
          <p className="mt-2 text-[12px] text-white/45">{shown.length} products shown{s.unlisted ? `, ${s.unlisted} of them drafts on the site` : ""}. A photo opens full size.</p>
        </Card>
      )}

      {products.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className={view === "photos" ? KEY : QUIET} onClick={() => setView("photos")}>All photos ({shown.reduce((n, p) => n + p.images.length, 0)}) · همهٔ عکس‌ها</button>
          <button type="button" className={view === "products" ? KEY : QUIET} onClick={() => setView("products")}>Products ({shown.length}) · محصولات</button>
        </div>
      )}

      {view === "photos" && shown.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {shown.flatMap((p) => p.images.map((u, k) => (
            <a key={`${p.url}#${k}`} href={u} target="_blank" rel="noopener noreferrer" title={p.name.en || p.name.fa || p.handle}
              className="group flex flex-col overflow-hidden rounded-lg border border-white/10 bg-black/25">
              <span className="relative block aspect-square bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={p.name.en || p.name.fa} loading="lazy" className="h-full w-full object-contain" />
                {p.images.length > 1 && <span dir="ltr" className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{k + 1}/{p.images.length}</span>}
              </span>
              <span dir="auto" className="line-clamp-2 px-1.5 py-1 text-[11px] leading-tight text-white/70">{p.name.en || p.name.fa || (p.unlisted ? "Draft (no name)" : p.handle)}</span>
            </a>
          )))}
        </div>
      )}

      {view === "products" && shown.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((p) => <ProductCard key={p.url} p={p} />)}
        </div>
      )}

      {op && page.matching && page.matching.length > 0 && (
        <Card>
          <Bi fa="محصولات ویدیو و همتای آنها در وبسایت" en="Products in the video, and their website product" className="text-[16px] font-bold" />
          <p dir="ltr" className="mt-1 text-left text-[13px] text-white/60">
            {page.matching.filter((m) => m.matched).length} of {page.matching.length} matched: those now carry the website&apos;s name, price, description and photos, and keep their lights in the walk.
          </p>
          <button type="button" className={`${QUIET} mt-2`} disabled={busy} onClick={async () => {
            setBusy(true); setSaid(null);
            try { const r = await postJson<{ note: string }>(api, { action: "rematch" }); setSaid({ ok: true, text: r.note }); setTimeout(load, 60000); }
            catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
            finally { setBusy(false); }
          }}>Compare the unmatched again (a cent or two of the store&apos;s AI budget)</button>
          {page.matching.some((m) => m.unsure && !m.opus) && (
            <button type="button" className={`${QUIET} ms-2 mt-2`} disabled={busy} onClick={async () => {
              const n = page.matching!.filter((m) => m.unsure && !m.opus).length;
              if (!window.confirm(`Opus looks again at the ${n} unsure ones: about $${(n * 0.02).toFixed(2)} of the store's AI budget.`)) return;
              setBusy(true); setSaid(null);
              try { const r = await postJson<{ note: string }>(api, { action: "rematch", opus: true }); setSaid({ ok: true, text: r.note }); setTimeout(load, 60000); }
              catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
              finally { setBusy(false); }
            }}>Look again with Opus at the {page.matching.filter((m) => m.unsure && !m.opus).length} unsure ones (~${(page.matching.filter((m) => m.unsure && !m.opus).length * 0.02).toFixed(2)})</button>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px]">Every verdict</summary>
            <ul dir="ltr" className="mt-2 space-y-1.5 text-left text-[12px]">
              {page.matching.map((m) => (
                <li key={m.n} className="flex gap-2">
                  {m.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.photo} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded bg-white object-contain" />
                  )}
                  <span className={m.matched ? "text-emerald-200" : "text-white/60"}>
                    #{m.n} {m.seen || "—"} → {m.matched ? m.name : "no match"} <span className="text-white/40">({Math.round(m.confidence * 100)}%{m.opus ? ", Opus" : ""}: {m.why})</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      {run && run.failures.length > 0 && (
        <Card>
          <details>
            <summary className="cursor-pointer text-[14px]">{run.failures.length} pages not read · صفحه‌هایی که خوانده نشد</summary>
            <ul dir="ltr" className="mt-2 space-y-1 text-left text-[12px] text-white/60">
              {run.failures.map((f) => <li key={f.url}><a href={f.url} target="_blank" rel="noopener noreferrer" className="underline">{f.url}</a> — {f.why}</li>)}
            </ul>
          </details>
        </Card>
      )}
    </div>
  );
}
