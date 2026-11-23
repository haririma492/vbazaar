"use client";

// THE PHOTO LIBRARY on the store's page (owner, 2026-11-23: "see them all in their types … and attach them to each
// shelf so they show up in both tours"; "all photos, with or without price … made available to add to the basket").
// Four kinds, each listed in full: the shelf and uploaded product photos (already placed in a section), the website's
// photos, and the Google listing photos. A website or Google photo is added to a shelf section with «＋», and then the
// shoppers see it in that section in both tours and can put it in their basket. No prices needed for this.
import { useCallback, useEffect, useState } from "react";
import { shotKey } from "@/lib/stores/kitRules";
import { getJson, postJson } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";

type SitePage = { run: { products: { url: string; name: { en: string; fa: string }; images: string[] }[] } | null; google?: { store: string[] } };
type KitSection = { id: string; i: number; products: { photo: { url?: string; thumb?: string } }[]; items?: string[] };
type KitShelf = { id: string; label: { en: string; fa?: string }; sections: KitSection[] };
type Item = { key: string; src: string; label: string };

export default function PhotoLibrary({ slug }: { slug: string }) {
  const api = `/api/stores/${slug}`;
  const [site, setSite] = useState<SitePage | null>(null);
  const [shelves, setShelves] = useState<KitShelf[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, k] = await Promise.all([getJson<SitePage>(`${api}/website`), postJson<{ shelves: KitShelf[] }>(api, { action: "kit" })]);
      setSite(w); setShelves(k.shelves);
    } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const sections = (shelves ?? []).flatMap((sh) => sh.sections.map((sec) => ({ id: sec.id, label: `${sh.label.en} · Section ${sec.i}`, items: sec.items ?? [] })));
  const placed = (shelves ?? []).flatMap((sh) => sh.sections.flatMap((sec) => sec.products.filter((p) => p.photo.url).map((p) => ({
    key: p.photo.url!, src: p.photo.url!, label: `${sh.label.en} · Section ${sec.i}`,
  }))));
  const websitePhotos: Item[] = (site?.run?.products ?? []).flatMap((p) => p.images.map((src, i) => ({
    key: shotKey(p.url, i), src, label: p.name.en || p.name.fa || "Website product",
  })));
  const googlePhotos: Item[] = (site?.google?.store ?? []).map((src) => ({ key: src, src, label: "Google listing" }));

  const add = async (key: string) => {
    const sec = sections.find((s) => s.id === pick);
    if (!sec) { setSaid({ ok: false, text: "Choose a shelf section first." }); return; }
    if (sec.items.includes(key)) { setSaid({ ok: false, text: `Already in ${sec.label}.` }); return; }
    setBusy(true); setSaid(null);
    try {
      await postJson(api, { action: "kitItems", section: sec.id, webs: [...sec.items, key] });
      setSaid({ ok: true, text: `✓ Added to ${sec.label}. Shoppers see it there in both tours.` });
      await load();
    } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const grid = (items: Item[], addable: boolean) => (
    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((it, k) => (
        <div key={`${it.src}#${k}`} className="rounded-lg border border-white/10 bg-black/25 p-1">
          <a href={it.src} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.src} alt={it.label} loading="lazy" className="aspect-square w-full rounded bg-white object-contain" />
          </a>
          <p className="truncate px-1 pt-1 text-[11px] text-white/70">{it.label}</p>
          {addable && (
            <button type="button" disabled={busy || !pick} onClick={() => void add(it.key)}
              className="mt-1 w-full rounded-full border border-emerald-300/50 px-2 py-0.5 text-[12px] text-emerald-100 disabled:opacity-30">＋ Add to section</button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <Card>
      <Bi fa="کتابخانهٔ عکس‌ها" en="Photo library" className="text-[16px] font-bold" />
      <p className="mt-1 text-[13px] text-white/60">Every photo of this store, by where it came from. Choose a shelf section, then «＋» on a website or Google photo: shoppers see it in that section in both tours and can put it in their basket. No prices needed now.</p>
      <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-3 w-full rounded border border-white/20 bg-black/60 px-2 py-1.5 text-[13px] text-white">
        <option value="">Choose a shelf section… · بخش قفسه</option>
        {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Said ok={said?.ok} text={said?.text ?? null} />

      <p className="mt-4 font-bold text-white/85">1 · Shelf and uploaded product photos ({placed.length}) — already in their sections</p>
      {placed.length ? grid(placed, false) : <p className="mt-1 text-[12px] text-white/45">None yet.</p>}

      <p className="mt-4 font-bold text-white/85">2 · Website photos ({websitePhotos.length})</p>
      {websitePhotos.length ? grid(websitePhotos, true) : <p className="mt-1 text-[12px] text-white/45">None yet. Read the website first.</p>}

      <p className="mt-4 font-bold text-white/85">3 · Google listing photos ({googlePhotos.length})</p>
      {googlePhotos.length ? grid(googlePhotos, true) : <p className="mt-1 text-[12px] text-white/45">None yet. Press «Search Google for the store&apos;s photos» above.</p>}

      <div className="mt-4">
        <button type="button" className={QUIET} disabled={busy} onClick={() => void load()}>Refresh the library</button>
      </div>
    </Card>
  );
}
