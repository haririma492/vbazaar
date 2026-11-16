"use client";

import { useState } from "react";
import { formatCents } from "@/lib/splats/catalogue";
import type { KitSection } from "@/lib/stores/kitRules";

/** A product of the store's website, as the operator's screens list it (`kitForPage`'s `site`). */
export type SiteItem = { web: string; en: string; fa: string; priceCents: number | null; unit: string; photo: string | null };

/** Every word typed is in the product's English or Farsi name (case and Persian / Arabic digits aside). */
const norm = (t: string) => t.toLowerCase().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/ي/g, "ی").replace(/ك/g, "ک");
const hit = (w: SiteItem, q: string) => { const hay = norm(`${w.en} ${w.fa}`); return norm(q).split(/\s+/).filter(Boolean).every((t) => hay.includes(t)); };

/**
 * WHICH OF THE WEBSITE'S PRODUCTS ARE ON THIS SECTION (owner, 2026-11-16: "after uploading type IV for a shelf, let the
 * operator search in all DB of items pulled from web site and assign one or few to that shelf level so as soon as user
 * click on that shelf level the e-commerce product list panel on the right will be populated"). Search the store's
 * website products by name (English or Farsi), «＋» to add, «✕» to take off, ↑ to move up. Each change saves itself;
 * the panel lists them in this order.
 */
export default function SectionItems({ section, site, onSave, onOwnPhoto, onUploadLocal, uploading }: {
  section: KitSection; site: SiteItem[]; onSave: (webs: string[]) => Promise<boolean>;
  /** Upload the operator's own photo of a website product (from this computer); null when the section is full. */
  onOwnPhoto: ((web: string) => void) | null;
  /** Upload product photos from this computer, not picked from the website (matched to it by itself, or chosen below). */
  onUploadLocal: (() => void) | null;
  uploading: boolean;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const items = section.items ?? [];
  const chosen = items.map((w) => site.find((x) => x.web === w)).filter((x): x is SiteItem => Boolean(x));
  const hits = site.filter((w) => !items.includes(w.web) && (!q.trim() || hit(w, q))).slice(0, 40);
  const save = async (webs: string[]) => { setBusy(true); await onSave(webs); setBusy(false); };
  const ownOf = (web: string) => section.products.find((p) => p.match?.web === web && p.photo.thumb);
  const Row = ({ w, children, mine }: { w: SiteItem; children: React.ReactNode; mine?: string }) => (
    <li className="flex items-center gap-2 rounded bg-white/[0.04] p-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {mine && <img src={mine} alt="" title="Your own photo" className="h-10 w-10 shrink-0 rounded bg-white object-contain ring-2 ring-emerald-300" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {w.photo ? <img src={w.photo} alt="" className="h-10 w-10 shrink-0 rounded bg-white object-contain" loading="lazy" /> : <div className="h-10 w-10 shrink-0 rounded bg-white/10" />}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate">{w.en || w.fa}</p>
        <p className="truncate text-[12px] text-white/50">{w.en && w.fa ? `${w.fa} · ` : ""}{w.priceCents !== null ? `${formatCents(w.priceCents)} / ${w.unit}` : "no price"}</p>
      </div>
      {children}
    </li>
  );
  return (
    <div className="mt-2 rounded-md border border-emerald-300/20 bg-emerald-300/[0.04] p-2">
      <p className="font-bold text-emerald-100">Products shoppers see for this section · محصولات این بخش ({chosen.length})</p>
      <p className="text-[12px] text-white/50">Two ways, both fine: pick them from the store&apos;s website below, or upload their photos (Type V) from this computer. A website product can also take your own photo («📷»): it is shown first, the website&apos;s after it.</p>
      {onUploadLocal && <button type="button" className="mt-1 rounded-full border border-emerald-300/50 px-3 py-1 text-[13px] text-emerald-100 disabled:opacity-30" disabled={uploading}
        onClick={onUploadLocal}>＋ Upload product photos from this computer (Type V) · از رایانه</button>}
      {!site.length && <p className="text-amber-200">No website products yet: run the Website Explorer first.</p>}
      {chosen.length > 0 && (
        <ol className="mt-1 space-y-1">
          {chosen.map((w, k) => (
            <Row key={w.web} w={w} mine={ownOf(w.web)?.photo.thumb}>
              {onOwnPhoto && <button type="button" className="whitespace-nowrap rounded-full border border-white/20 px-2 text-[12px] text-white/80 disabled:opacity-30" disabled={busy || uploading}
                title="Use your own photo of this product (from this computer); the website's photos follow it"
                onClick={() => onOwnPhoto(w.web)}>📷 {ownOf(w.web) ? "Replace my photo" : "My own photo"}</button>}
              <button type="button" className="px-1 text-white/60 disabled:opacity-30" disabled={busy || k === 0} aria-label="Move up"
                onClick={() => { const n = [...items]; [n[k - 1], n[k]] = [n[k], n[k - 1]]; void save(n); }}>↑</button>
              <button type="button" className="px-1 text-rose-200 disabled:opacity-30" disabled={busy} aria-label="Take off"
                onClick={() => void save(items.filter((x) => x !== w.web))}>✕</button>
            </Row>
          ))}
        </ol>
      )}
      {site.length > 0 && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the website's products (English or Farsi)… · جست‌وجو"
            className="mt-2 w-full rounded border border-white/20 bg-black/60 px-2 py-1.5 text-[13px] text-white" />
          <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto">
            {hits.map((w) => (
              <Row key={w.web} w={w}>
                <button type="button" className="rounded-full border border-emerald-300/50 px-2 text-emerald-100 disabled:opacity-30" disabled={busy}
                  onClick={() => void save([...items, w.web])}>＋ Add</button>
              </Row>
            ))}
            {!hits.length && <li className="p-1 text-white/50">{q ? "Nothing on the website matches that." : "Every website product is on this section."}</li>}
          </ul>
        </>
      )}
    </div>
  );
}

