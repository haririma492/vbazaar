"use client";

// The website photos shown under the Website Explorer card on the store's page (owner, 2026-11-23: "on this section
// show all photos found underneath it"): every photo the explorer read from the store's site, each product's photos in
// order, and the Google photos the product has. Read from the same API as the Website page.
import { useEffect, useState } from "react";
import { getJson } from "./upload";

type Product = { url: string; name: { en: string; fa: string }; images: string[] };
type Page = { run: { products: Product[] } | null; google?: { byWeb: Record<string, string[]> } };

export default function WebsitePhotosStrip({ slug }: { slug: string }) {
  const [items, setItems] = useState<{ src: string; label: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJson<Page>(`/api/stores/${slug}/website`)
      .then((p) => {
        const out: { src: string; label: string }[] = [];
        for (const prod of p.run?.products ?? []) {
          const label = prod.name.en || prod.name.fa || "Product";
          for (const src of [...prod.images, ...(p.google?.byWeb[prod.url] ?? [])]) out.push({ src, label });
        }
        setItems(out);
      })
      .catch((e) => setErr((e as Error).message));
  }, [slug]);

  if (err) return <p className="mt-3 text-[13px] text-rose-200">{err}</p>;
  if (!items) return <p className="mt-3 text-[13px] text-white/50">Loading the website photos…</p>;
  if (!items.length) return <p className="mt-3 text-[13px] text-white/50">No website photos yet. Read the website first.</p>;
  return (
    <div className="mt-3">
      <p className="text-[13px] text-white/60">{items.length} website photos, {new Set(items.map((i) => i.label)).size} products. Open one to see it full size.</p>
      <div className="mt-2 grid max-h-[480px] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
        {items.map((it, k) => (
          <a key={`${it.src}#${k}`} href={it.src} target="_blank" rel="noopener noreferrer" title={it.label}
            className="block overflow-hidden rounded-md border border-white/10 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.src} alt={it.label} loading="lazy" className="aspect-square w-full object-contain" />
          </a>
        ))}
      </div>
    </div>
  );
}
