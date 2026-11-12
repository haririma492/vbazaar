"use client";

/** A store's shelf zoom photos on one page (`/zoom/<slug>`): each shelf's small picture, a tap opens it full screen. */

import { useEffect, useState } from "react";
import DeepZoom from "./DeepZoom";

type Shelf = { id: string; label: { en: string; fa: string }; manifest: string; thumb: string | null; w: number; h: number; mp: number };

export default function ZoomPage({ slug, shelf }: { slug: string; shelf: number | null }) {
  const [list, setList] = useState<Shelf[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Shelf | null>(null);
  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const j = await (await fetch(`/api/zoom/${encodeURIComponent(slug)}`, { cache: "no-store" })).json();
        if (!j.ok) throw new Error(j.error || "The photos could not be read.");
        if (gone) return;
        const zs = j.zooms as Shelf[];
        setList(zs);
        // Asked for by number, or the only one: opened at once.
        const first = shelf ? zs[shelf - 1] : zs.length === 1 ? zs[0] : null;
        if (first) setOpen(first);
      } catch (e) { if (!gone) { setError((e as Error).message); setList([]); } }
    })();
    return () => { gone = true; };
  }, [slug, shelf]);

  return (
    <main dir="ltr" className="min-h-screen bg-[#0b0d0f] p-4 text-white sm:p-8">
      <h1 className="text-[20px] font-bold">عکس بزرگ‌نمایی قفسه‌ها · Shelf zoom photos</h1>
      <p className="mt-1 text-[13px] text-white/55">{slug} — tap a shelf to open it; pinch or scroll to zoom in until the labels can be read.</p>
      {!list && <p className="mt-6 text-white/60">Opening… · در حال باز کردن</p>}
      {error && <p className="mt-6 text-rose-300">{error}</p>}
      {list && !list.length && !error && <p className="mt-6 text-amber-200">No shelf of this store has a stitched zoom photo yet. · هنوز عکسی آماده نیست.</p>}
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {(list ?? []).map((z) => (
          <li key={z.id}>
            <button type="button" onClick={() => setOpen(z)} className="block w-full overflow-hidden rounded-xl border border-white/15 bg-white/[0.04] text-left hover:border-emerald-300/70">
              {z.thumb && <img src={z.thumb} alt={z.label.en} className="aspect-[4/3] w-full bg-black object-contain" />}
              <span className="block p-3 text-[14px] font-bold">🔍 {z.label.fa} · {z.label.en}<span className="block text-[12px] font-normal text-white/50">{z.w}×{z.h} px · {z.mp} megapixels</span></span>
            </button>
          </li>
        ))}
      </ul>
      {open && <DeepZoom manifest={open.manifest} title={open.label} onClose={() => setOpen(null)} />}
    </main>
  );
}
