"use client";

// THE PHOTO BROWSER in the walk editor (?edit=1; owner, 2026-11-23: "a large modal with at least 40 photos in each page so
// operator can quickly identify shelves, shelf-sections and products from all photos, in 4 groups so the operator understands
// which is which"). Four groups, 40 photos a page, each photo with its label; a click shows it large. Browsing only: the
// shelf, section and product are set with the editor's own questions and the store's page.
import { useEffect, useMemo, useState } from "react";
import { getJson, postJson } from "@/components/stores/upload";

const PAGE = 40;

type Site = { run: { products: { url: string; name: { en: string; fa: string }; images: string[] }[] } | null; google?: { store: string[] } };
type KitPhoto = { url?: string; thumb?: string };
type Kit = { shelves: { label: { en: string }; photo?: KitPhoto; sections: { i: number; photo: KitPhoto; products: { photo: KitPhoto }[] }[] }[] };
type Item = { src: string; label: string };

const GROUPS = [
  { id: "shelf", title: "1 · Shelf and section photos", hint: "Type III: a whole shelf · Type IV: one section of a shelf. Use these to find which shelf and section a product belongs to." },
  { id: "product", title: "2 · Product photos (Type V)", hint: "Photos of single products: cut from shelf photos, or uploaded from a computer. Each one sits in a shelf section." },
  { id: "web", title: "3 · Website photos", hint: "Every photo the store's website has, with the product's name. Not yet placed on a shelf unless you add them on the store's page." },
  { id: "google", title: "4 · Google listing photos", hint: "The photos on the store's Google listing («See photos»)." },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];

export default function PhotoBrowser({ slug, onClose }: { slug: string; onClose: () => void }) {
  const api = `/api/stores/${slug}`;
  const [groups, setGroups] = useState<Record<GroupId, Item[]> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<GroupId>("shelf");
  const [page, setPage] = useState(0);
  const [big, setBig] = useState<Item | null>(null);

  useEffect(() => {
    Promise.all([getJson<Site>(`${api}/website`), postJson<Kit>(api, { action: "kit" })])
      .then(([w, k]) => {
        const shelf: Item[] = [];
        const product: Item[] = [];
        for (const sh of k.shelves) {
          if (sh.photo?.url) shelf.push({ src: sh.photo.url, label: `${sh.label.en} · shelf photo` });
          for (const sec of sh.sections) {
            if (sec.photo?.url) shelf.push({ src: sec.photo.url, label: `${sh.label.en} · section ${sec.i}` });
            for (const p of sec.products) if (p.photo?.url) product.push({ src: p.photo.url, label: `${sh.label.en} · section ${sec.i}` });
          }
        }
        const web: Item[] = (w.run?.products ?? []).flatMap((p) => p.images.map((src) => ({ src, label: p.name.en || p.name.fa || "Website product" })));
        const google: Item[] = (w.google?.store ?? []).map((src) => ({ src, label: "Google listing" }));
        setGroups({ shelf, product, web, google });
      })
      .catch((e) => setErr((e as Error).message));
  }, [api]);

  const items = groups?.[tab] ?? [];
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const shown = useMemo(() => items.slice(page * PAGE, page * PAGE + PAGE), [items, page]);
  const current = GROUPS.find((g) => g.id === tab)!;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label="All photos">
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0d141a] text-white">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <div className="flex flex-wrap gap-1">
            {GROUPS.map((g) => (
              <button key={g.id} type="button" onClick={() => { setTab(g.id); setPage(0); }}
                className={`rounded-full px-3 py-1 text-[13px] ${tab === g.id ? "bg-emerald-400 font-bold text-black" : "border border-white/25 text-white/85"}`}>
                {g.title} ({groups?.[g.id].length ?? "…"})
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-white/25 px-3 py-1 text-[13px]">Close ×</button>
        </div>
        <p className="px-3 pt-2 text-[12px] text-white/60">{current.hint}</p>
        {err && <p className="p-3 text-rose-200">{err}</p>}
        {!groups && !err && <p className="p-3 text-white/60">Loading the photos…</p>}
        {groups && (
          <>
            <div className="flex items-center justify-between px-3 py-2 text-[12px] text-white/70">
              <span>{items.length} photos · page {page + 1} of {pages} · {PAGE} a page</span>
              <span className="space-x-2">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-white/25 px-2 py-0.5 disabled:opacity-30">‹ Previous</button>
                <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded border border-white/25 px-2 py-0.5 disabled:opacity-30">Next ›</button>
              </span>
            </div>
            <div className="grid flex-1 grid-cols-4 gap-2 overflow-y-auto px-3 pb-3 sm:grid-cols-6 md:grid-cols-8">
              {shown.length === 0 && <p className="col-span-full text-white/50">No photos in this group yet.</p>}
              {shown.map((it, k) => (
                <button key={`${it.src}#${k}`} type="button" onClick={() => setBig(it)} className="group text-left">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.src} alt={it.label} loading="lazy" className="aspect-square w-full rounded bg-white object-contain" />
                  <span className="line-clamp-2 block px-0.5 pt-0.5 text-[11px] text-white/75">{it.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {big && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-4" onClick={() => setBig(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={big.src} alt={big.label} className="max-h-[80vh] max-w-full rounded bg-white object-contain" />
            <p className="mt-2 text-[14px] text-white/85">{big.label}</p>
            <p className="text-[12px] text-white/50">Click to close</p>
          </div>
        )}
      </div>
    </div>
  );
}
