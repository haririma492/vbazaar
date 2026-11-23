"use client";

// «Photos from Google» on the store's own page (owner, 2026-11-23): the state of the Google photo explorer and the key
// to run it. The full photo grid is on the Website Explorer's page (`/stores/<slug>/website`). The search itself is
// `lib/stores/googlePhotos.ts`; it needs GOOGLE_CSE_KEY and GOOGLE_CSE_CX on the server.
import { useCallback, useEffect, useState } from "react";
import { runStale, type GoogleRun } from "@/lib/stores/googlePhotosRules";
import { getJson, postJson } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";

type G = { configured: boolean; run: GoogleRun | null; byWeb: Record<string, string[]>; store: string[] };

export default function GooglePhotosCard({ slug }: { slug: string }) {
  const api = `/api/stores/${slug}/website`;
  const [g, setG] = useState<G | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { const r = await getJson<{ google?: G }>(api); setG(r.google ?? null); }
    catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const running = g?.run?.running === true && !runStale(g.run, Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [running, load]);

  const start = async (fresh: boolean) => {
    setBusy(true); setSaid(null);
    try { const r = await postJson<{ note: string }>(api, { action: "googlePhotos", fresh }); setSaid({ ok: true, text: r.note }); setTimeout(load, 1500); }
    catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const products = g?.run ? Object.values(g.run.products) : [];
  const withPhotos = products.filter((e) => e.photos.length).length;
  const photos = products.reduce((n, e) => n + e.photos.length, 0);
  return (
    <Card>
      <Bi fa="عکس‌ها از گوگل" en="Photos from Google" className="text-[16px] font-bold" />
      <p className="mt-1 text-[13px] text-white/60">Google&apos;s image search for the store&apos;s name and street: its photos. They are shown with the website&apos;s photos. Other people&apos;s pictures: check them first.</p>
      {g && !g.configured && <Said text="Not set up yet: the server needs GOOGLE_CSE_KEY and GOOGLE_CSE_CX (on Railway). Until then nothing is searched." />}
      {g?.run && (
        <div dir="ltr" className="mt-2 space-y-1 text-left text-[13px] text-white/60">
          <p>{g.run.note || (running ? "Searching…" : "")}</p>
          <p className="text-white/45">{g.store.length} photos of the store{products.length ? ` · ${withPhotos} of ${products.length} searched products have Google photos (${photos} in all)` : ""}</p>
        </div>
      )}
      {!g?.run && g?.configured && <p className="mt-2 text-[13px] text-white/50">Not searched yet.</p>}
      {g && g.store.length > 0 && (
        <>
          <p dir="ltr" className="mt-3 text-left text-[13px] text-white/70">{g.store.length} photos of the store, kept in our storage (bucket `scenes/catalogues/`):</p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {g.store.map((u, k) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-white/10 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Store photo ${k + 1}`} loading="lazy" className="aspect-square w-full object-contain" />
              </a>
            ))}
          </div>
          {g.run?.store_photos?.by && g.run.store_photos.by.length > 0 && (
            <p className="mt-2 text-[12px] text-white/45">Photo authors on Google: {g.run.store_photos.by.join(", ")}</p>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {g?.configured && !running && (
          <button type="button" className={KEY} disabled={busy} onClick={() => start(false)}>Search Google for the store&apos;s photos · عکس‌های فروشگاه</button>
        )}
        {g?.configured && !running && g.run && (
          <button type="button" className={QUIET} disabled={busy} onClick={() => start(true)}>Search again</button>
        )}
        <a href={`/stores/${slug}/website`} className={QUIET}>See the photos · دیدن عکس‌ها</a>
      </div>
      <Said ok={said?.ok} text={said?.text ?? null} />
    </Card>
  );
}
