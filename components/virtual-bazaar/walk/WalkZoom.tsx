"use client";

/**
 * «Zoom» on the walk's edit page: A SHELF'S ZOOM PHOTO PINNED ON ITS SHELF (owner, 2026-11-11: "take 3 Gigapan
 * style photo of a shelf and … stitch them together so user (once switch its focus on this shelf) to be able to
 * zoom in and out and read labels"). The photos are stitched on the store's page (`lib/stores/gigapan.ts`); here
 * the operator says WHERE each shelf is, starting from the thing itself: walk to the shelf, press «Pin on its
 * shelf», tap the middle of the shelf in the picture. The 🔍 then follows the shelf by itself, like a product's
 * light (`followProduct360`, or `followProduct` on a flat video), and the editor saves by itself.
 */

import { useEffect, useRef, useState } from "react";
import { dropZoom, setZoom, walkOf, type ItemPin, type Walks } from "@/lib/splats/walks";
import { followProduct, followProduct360 } from "./followProduct";
import type { ItemEngine } from "./WalkItems";

type Ready = { id: string; label: { en: string; fa: string }; manifest: string; thumb: string | null; w: number; h: number; mp: number };
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
/** The store a walk is of: `scenes/store-<slug>/…`. */
export const storeSlugOf = (key: string | null) => /^scenes\/store-([a-z0-9-]+)\//.exec(key ?? "")?.[1] ?? null;

export function ZoomEditor({ engine, walks, viewKey, change, setStatus }: {
  engine: React.MutableRefObject<ItemEngine | null>;
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
  setStatus: (s: { tone: "ok" | "warn" | "bad"; text: string } | null) => void;
  store?: string;
}) {
  const slug = storeSlugOf(viewKey);
  const [list, setList] = useState<Ready[] | null>(null);
  const [error, setError] = useState("");
  /** The photo being pinned: waiting for the tap, then following. */
  const [placing, setPlacing] = useState<{ id: string; follow?: { done: number; total: number } } | null>(null);
  const walksRef = useRef(walks);
  walksRef.current = walks;
  const run = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    if (!slug) { setList([]); return; }
    let gone = false;
    void (async () => {
      try {
        const j = await (await fetch(`/api/zoom/${slug}`, { cache: "no-store" })).json();
        if (!j.ok) throw new Error(j.error || "The list could not be read.");
        if (!gone) setList(j.zooms as Ready[]);
      } catch (e) { if (!gone) { setError((e as Error).message); setList([]); } }
    })();
    return () => { gone = true; };
  }, [slug]);

  // While a photo waits for its tap, the next tap on the picture is the shelf.
  useEffect(() => {
    const e = engine.current;
    if (!e || !placing || placing.follow || !viewKey) return;
    const z = list?.find((x) => x.id === placing.id);
    if (!z) return;
    e.setItemPick((pin: ItemPin) => {
      e.setItemPick(null);
      const src = e.video().currentSrc;
      if (!src) { setStatus({ tone: "bad", text: "The video is not loaded yet: wait a moment and tap again." }); setPlacing(null); return; }
      const here = e.here();
      const sig = { cancelled: false };
      run.current = sig;
      setPlacing({ id: z.id, follow: { done: 0, total: 1 } });
      const onProgress = (p: { done: number; total: number }) => { if (!sig.cancelled) setPlacing({ id: z.id, follow: p }); };
      (here.flat ? followProduct(src, pin, onProgress, sig) : followProduct360(src, pin, here.projection === "eac" ? "eac" : "equirect", onProgress, sig))
        .then((pins) => {
          if (sig.cancelled) return;
          // Lost at once (a blank wall, a blur): the 🔍 still shows round the tap, and says so.
          const kept = pins.length ? pins : [pin];
          change(setZoom(walksRef.current, viewKey, { id: z.id, label: z.label, manifest: z.manifest, ...(z.thumb ? { thumb: z.thumb } : {}), pins: kept }));
          setStatus(kept.length >= 3
            ? { tone: "ok", text: `🔍 «${z.label.en}» is on its shelf from ${mmss(kept[0].t)} to ${mmss(kept[kept.length - 1].t)} — saving…` }
            : { tone: "warn", text: `🔍 «${z.label.en}» is pinned at ${mmss(pin.t)} only (the shelf could not be followed from that tap): pin it again on a clearer spot of the shelf.` });
          setPlacing(null);
        })
        .catch((err: Error) => {
          if (sig.cancelled) return;
          setStatus({ tone: "bad", text: `Not pinned: ${err.message || "the shelf could not be followed"}. Tap a clearer spot of the shelf.` });
          setPlacing(null);
        });
    });
    return () => e.setItemPick(null);
  }, [placing, list, viewKey, engine, change, setStatus]);
  useEffect(() => () => { if (run.current) run.current.cancelled = true; }, []);

  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const on = new Map((walkOf(walks, viewKey)?.zooms ?? []).map((z) => [z.id, z]));

  if (!slug) return <p className="text-white/70">Zoom photos belong to a store&apos;s walk. This walk is not a store&apos;s.</p>;
  if (!list) return <p className="text-white/60">Reading the store&apos;s zoom photos…</p>;
  if (placing) {
    const z = list.find((x) => x.id === placing.id);
    return (
      <div className="space-y-2 rounded-lg border border-emerald-300/40 bg-emerald-400/10 p-2">
        <p className="font-semibold">{z?.label.en}: where is this shelf?</p>
        {placing.follow
          ? <p><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />Following the shelf through the walk… {placing.follow.total > 1 ? `${Math.round((placing.follow.done / placing.follow.total) * 100)}%` : ""}</p>
          : <p>Walk until the shelf is in front of you, then <b>tap the middle of the shelf</b> in the picture. One tap: the 🔍 follows it by itself.</p>}
        {z?.thumb && <img src={z.thumb} alt="" className="max-h-40 rounded" />}
        <button className={btn} onClick={() => { if (run.current) run.current.cancelled = true; engine.current?.setItemPick(null); setPlacing(null); }}>← Back</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-white/70">A shelf&apos;s zoom photo opens from a 🔍 on that shelf. Pin each photo on its shelf: one tap.</p>
      {error && <p className="text-rose-300">{error}</p>}
      {!list.length && <p className="text-amber-200">No zoom photo is ready for this store. On the store&apos;s page, «Shelf zoom photos»: add a shelf&apos;s three photos, then «Stitch now» (or «Refresh all agents»).</p>}
      <ul className="space-y-2">
        {list.map((z) => {
          const at = on.get(z.id);
          return (
            <li key={z.id} className="flex gap-2 rounded-lg bg-white/5 p-2">
              {z.thumb && <img src={z.thumb} alt="" className="h-20 w-14 shrink-0 rounded object-cover" />}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold">{z.label.en} <span className="font-normal text-white/50">· {z.mp} MP</span></p>
                <p className={at ? "text-emerald-300" : "text-amber-200"}>{at ? `🔍 on the walk ${mmss(at.pins[0].t)}–${mmss(at.pins[at.pins.length - 1].t)}` : "Not on the walk yet"}</p>
                <div className="flex flex-wrap gap-1">
                  <button className={btn} onClick={() => setPlacing({ id: z.id })}>{at ? "Pin it again" : "Pin on its shelf"}</button>
                  {at && <button className={btn} onClick={() => engine.current?.seek(at.pins[at.pins.length >> 1].t)}>Go to</button>}
                  {at && viewKey && <button className={btn} onClick={() => { change(dropZoom(walksRef.current, viewKey, z.id)); setStatus({ tone: "ok", text: `«${z.label.en}» is off the walk — saving…` }); }}>Take off the walk</button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
