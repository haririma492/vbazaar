"use client";

/**
 * «Shelves» on the walk's edit page: THE OPERATOR MARKS EACH SHELF (owner, 2026-11-12: "I need to be able as
 * operator to draw rectangles on the shelf and identify 'Shelves' and assign number or name or both to them … ON
 * shopper's free tour, the borders of each shelf and their name will be visible to them so shoppers can decide to
 * approach or pass"). Starting from the thing itself, one question a card, each with «← Back»:
 *
 *   1  walk until the whole shelf is in view, then tap its FOUR CORNERS, in any order (owner, 2026-11-13: "let
 *      operator choose 4 corners for a shelf": a shelf seen at an angle is not a rectangle in the picture; it was
 *      two opposite corners). After the fourth the green border is on the shelf at once, saved by itself, and is
 *      followed through the walk in the background (`followShelf`), so it stays on the shelf as the shopper walks;
 *   3  its number (the next free one is offered) · 4  its name · 5  its name in Farsi (either may be skipped).
 *
 * A marked shelf is then in the dropdown of «Shelf zoom photos» on the store's page: its photos are uploaded to
 * it there, stitched, and open from this border (`lib/stores/gigapan.ts`). A stitched photo with no shelf yet (the
 * finder did not see it in the walk) is listed here too: «Draw its border».
 */

import { useEffect, useRef, useState } from "react";
import { dropZoom, quadBox, setZoom, walkOf, type ItemPin, type Walks, type WalkZoom } from "@/lib/splats/walks";
import { nextShelfNumber, quadFromTaps, shelfLabel } from "@/lib/splats/shelves";
import { thin } from "@/lib/stores/gigapanRules";
import { followShelf } from "./followProduct";
import type { ItemEngine } from "./WalkItems";

type Ready = { id: string; label: { en: string; fa: string }; manifest: string; thumb: string | null; mp: number };
type Step =
  | { step: "tap"; id?: string; taps: ItemPin[] }
  | { step: "n" | "en" | "fa"; id: string };
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
/** The store a walk is of: `scenes/store-<slug>/…`. */
export const storeSlugOf = (key: string | null) => /^scenes\/store-([a-z0-9-]+)\//.exec(key ?? "")?.[1] ?? null;
/** A new shelf's id: also the id its photos are uploaded under (`ZOOM_SET_RE`). */
const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 16);

export function ShelfEditor({ engine, walks, viewKey, change, setStatus }: {
  engine: React.MutableRefObject<ItemEngine | null>;
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
  setStatus: (s: { tone: "ok" | "warn" | "bad"; text: string } | null) => void;
}) {
  const slug = storeSlugOf(viewKey);
  const [ready, setReady] = useState<Ready[]>([]);
  const [at, setAt] = useState<Step | null>(null);
  const [text, setText] = useState("");
  const [following, setFollowing] = useState<{ id: string; done: number; total: number } | null>(null);
  const walksRef = useRef(walks);
  walksRef.current = walks;
  const run = useRef<{ cancelled: boolean } | null>(null);

  // The store's stitched photos: one with no shelf on the walk yet is offered for its border.
  useEffect(() => {
    if (!slug) return;
    let gone = false;
    void (async () => {
      try {
        const j = await (await fetch(`/api/zoom/${slug}`, { cache: "no-store" })).json();
        if (j.ok && !gone) setReady(j.zooms as Ready[]);
      } catch { /* the list of shelves on the walk is still right */ }
    })();
    return () => { gone = true; };
  }, [slug]);
  useEffect(() => () => { if (run.current) run.current.cancelled = true; }, []);

  const shelves = walkOf(walks, viewKey)?.zooms ?? [];
  const shelfNow = (id: string) => walkOf(walksRef.current, viewKey)?.zooms?.find((z) => z.id === id);
  const save = (z: WalkZoom) => { if (viewKey) change(setZoom(walksRef.current, viewKey, z)); };

  /** The border drawn: on the walk at once, then followed through the video in the background. */
  function drawn(taps: ItemPin[], id0?: string) {
    const e = engine.current;
    if (!e || !viewKey) return;
    const here = e.here();
    const round = !here.flat;
    const a = taps[0];
    if (taps.some((p) => Math.abs(p.t - a.t) > 0.15)) {
      setStatus({ tone: "bad", text: "The video moved between the taps. Stand still (do not walk) and tap the four corners again." });
      setAt({ step: "tap", id: id0, taps: [] });
      return;
    }
    const quad = quadFromTaps(taps, round);
    if (!quad) {
      setStatus({ tone: "bad", text: "Those four taps do not make a shelf's outline (two on one spot, or one inside the other three). Tap the shelf's four corners again." });
      setAt({ step: "tap", id: id0, taps: [] });
      return;
    }
    const had = id0 ? shelfNow(id0) : undefined;
    const photo = id0 ? ready.find((r) => r.id === id0) : undefined;
    const id = id0 ?? newId();
    const n = had ? had.n : photo ? undefined : nextShelfNumber(walkOf(walksRef.current, viewKey)?.zooms ?? []);
    const mid = quadBox(quad, round);
    const { auto: _auto, ...keep } = had ?? ({} as Partial<WalkZoom>);
    const shelf: WalkZoom = {
      ...keep, id,
      label: had?.label ?? (photo && n === undefined ? photo.label : shelfLabel(n, undefined)),
      ...(n !== undefined ? { n } : {}),
      ...(had?.manifest ?? photo?.manifest ? { manifest: had?.manifest ?? photo!.manifest } : {}),
      ...(had?.thumb ?? photo?.thumb ? { thumb: (had?.thumb ?? photo!.thumb)! } : {}),
      pins: [{ t: a.t, x: mid.x, y: mid.y }],
      outline: [{ t: Math.round(a.t * 100) / 100, c: quad }],
    };
    save(shelf);
    setStatus({ tone: "ok", text: `✓ The border is on «${shelf.label.en}» — saving. Following it through the walk now…` });
    setText(shelf.n !== undefined ? String(shelf.n) : "");
    setAt(had ? null : { step: "n", id });

    const src = e.video().currentSrc;
    if (!src) return;
    if (run.current) run.current.cancelled = true;
    const sig = { cancelled: false };
    run.current = sig;
    setFollowing({ id, done: 0, total: 1 });
    followShelf(src, a.t, quad, Boolean(here.flat), here.projection === "eac" ? "eac" : "equirect", (p) => { if (!sig.cancelled) setFollowing({ id, ...p }); }, sig)
      .then((frames) => {
        if (sig.cancelled) return;
        setFollowing(null);
        const cur = shelfNow(id);
        if (!cur) return; // removed meanwhile
        const outline = thin(frames, 400);
        const pins = thin(outline, 200).map((f) => { const m = quadBox(f.c, round); return { t: f.t, x: m.x, y: m.y }; });
        save({ ...cur, outline, pins });
        setStatus(outline.length >= 5
          ? { tone: "ok", text: `✓ «${cur.label.en}» is bordered from ${mmss(outline[0].t)} to ${mmss(outline[outline.length - 1].t)} — saved.` }
          : { tone: "warn", text: `«${cur.label.en}» is bordered at ${mmss(a.t)} only: the shelf could not be followed from there. «Draw again» from a spot where the shelf is sharp and square on.` });
      })
      .catch((err: Error) => {
        if (sig.cancelled) return;
        setFollowing(null);
        setStatus({ tone: "warn", text: `The border is saved at ${mmss(a.t)} only; it could not be followed (${err.message || "the video could not be read"}).` });
      });
  }

  // While a corner is asked for, the next tap on the picture is it.
  useEffect(() => {
    const e = engine.current;
    if (!e || !at || at.step !== "tap") return;
    e.video().pause();
    e.setItemPick((pin: ItemPin) => {
      const taps = [...at.taps, pin];
      if (taps.length < 4) setAt({ step: "tap", id: at.id, taps });
      else { e.setItemPick(null); drawn(taps, at.id); }
    });
    return () => e.setItemPick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, engine]);

  /** A question answered (or skipped): the shelf is saved with it, and the next one asked. */
  function answer(skip = false) {
    if (!at || at.step === "tap") return;
    const cur = shelfNow(at.id);
    if (!cur) { setAt(null); return; }
    const v = skip ? "" : text.trim();
    let n = cur.n, name = cur.name;
    if (at.step === "n") {
      if (v && !/^\d{1,3}$/.test(v)) { setStatus({ tone: "bad", text: "A shelf's number is 1 to 999 (or «Skip» for a name only)." }); return; }
      n = v && Number(v) >= 1 ? Number(v) : undefined;
      const twin = n !== undefined && shelves.find((z) => z.id !== cur.id && z.n === n);
      if (twin) { setStatus({ tone: "bad", text: `Number ${n} is «${twin.label.en}» already. Give another number.` }); return; }
    } else if (at.step === "en") name = v || name?.fa ? { en: v, ...(name?.fa ? { fa: name.fa } : {}) } : undefined;
    else name = v || name?.en ? { en: name?.en ?? "", ...(v ? { fa: v } : {}) } : undefined;
    const { n: _n, name: _nm, ...rest } = cur;
    const next: WalkZoom = { ...rest, ...(n !== undefined ? { n } : {}), ...(name ? { name } : {}), label: n === undefined && !name ? cur.label : shelfLabel(n, name) };
    save(next);
    if (at.step === "n") { setText(next.name?.en ?? ""); setAt({ ...at, step: "en" }); }
    else if (at.step === "en") { setText(next.name?.fa ?? ""); setAt({ ...at, step: "fa" }); }
    else { setAt(null); setStatus({ tone: "ok", text: `✓ «${next.label.en}» — saved. Shoppers see its border and its name. Its photos: the store's page → «Shelf zoom photos».` }); }
  }
  function back() {
    if (!at) return;
    const cur = "id" in at && at.id ? shelfNow(at.id) : undefined;
    if (at.step === "tap" && at.taps.length) setAt({ ...at, taps: at.taps.slice(0, -1) });
    else if (at.step === "en") { setText(cur?.n !== undefined ? String(cur.n) : ""); setAt({ ...at, step: "n" }); }
    else if (at.step === "fa") { setText(cur?.name?.en ?? ""); setAt({ ...at, step: "en" }); }
    else setAt(null);
  }

  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const key = "rounded-md bg-emerald-400 px-3 py-1 text-[12px] font-bold text-black hover:bg-emerald-300";
  const field = "w-full rounded-md border border-white/20 bg-black/50 px-2 py-1 text-[13px] text-white";
  const progress = following && (
    <p className="text-white/70"><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />
      Following «{shelfNow(following.id)?.label.en ?? "the shelf"}» through the walk… {following.total > 1 ? `${Math.round((following.done / following.total) * 100)}%` : ""} (keep this page open)</p>
  );

  if (!slug) return <p className="text-white/70">Shelves belong to a store&apos;s walk. This walk is not a store&apos;s.</p>;
  if (at) {
    const cur = "id" in at && at.id ? shelfNow(at.id) : undefined;
    return (
      <div className="space-y-2 rounded-lg border border-emerald-300/40 bg-emerald-400/10 p-2">
        {at.step === "tap" && (<>
          <p className="font-semibold">{cur ? `«${cur.label.en}»: draw its border again` : "Mark a shelf"} · corner {at.taps.length + 1} of 4</p>
          {at.taps.length === 0
            ? <p>Walk until the <b>whole shelf</b> is in view, then stand still and <b>tap one of its four corners</b> in the picture.</p>
            : <p><b>Tap the next corner</b> ({4 - at.taps.length} to go), in any order. Do not walk in between; you may look round. «← Back» takes the last tap away.</p>}
          <p className="text-[18px] tracking-widest text-emerald-300" aria-hidden>{"●".repeat(at.taps.length)}<span className="text-white/25">{"○".repeat(4 - at.taps.length)}</span></p>
        </>)}
        {at.step === "n" && (<>
          <p className="font-semibold">What is this shelf&apos;s number?</p>
          <input className={field} inputMode="numeric" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") answer(); }} placeholder="1 to 999" />
        </>)}
        {at.step === "en" && (<>
          <p className="font-semibold">Its name? <span className="font-normal text-white/60">(what is on it: «Spices», «Tea and coffee»)</span></p>
          <input className={field} autoFocus maxLength={60} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") answer(); }} placeholder="Name in English" />
        </>)}
        {at.step === "fa" && (<>
          <p className="font-semibold">Its name in Farsi?</p>
          <input className={field} dir="rtl" autoFocus maxLength={60} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") answer(); }} placeholder="نام قفسه" />
        </>)}
        {cur && at.step !== "tap" && <p className="text-white/60">Shoppers will read: <b className="text-emerald-200">{cur.label.en}{cur.label.fa && cur.label.fa !== cur.label.en ? ` · ${cur.label.fa}` : ""}</b></p>}
        <div className="flex flex-wrap gap-1">
          <button className={btn} onClick={back}>← Back</button>
          {at.step !== "tap" && <button className={key} onClick={() => answer()}>{at.step === "fa" ? "Done" : "Next →"}</button>}
          {at.step !== "tap" && <button className={btn} onClick={() => answer(true)}>Skip</button>}
        </div>
        {progress}
      </div>
    );
  }
  const orphans = ready.filter((r) => !shelves.some((z) => z.id === r.id));
  const sorted = [...shelves].sort((a, b) => (a.n ?? 1000) - (b.n ?? 1000) || a.pins[0].t - b.pins[0].t);
  return (
    <div className="space-y-2">
      <p className="text-white/70">Mark each shelf: a rectangle round it, its number and its name. Shoppers see the border and the name as they walk; its zoom photos are added on the store&apos;s page.</p>
      <button className={key} disabled={Boolean(following)} onClick={() => { setStatus(null); setAt({ step: "tap", taps: [] }); }}>＋ Mark a shelf</button>
      {progress}
      <ul className="max-h-[45vh] space-y-2 overflow-y-auto">
        {sorted.map((z) => {
          const o = z.outline;
          return (
            <li key={z.id} className="space-y-1 rounded-lg bg-white/5 p-2">
              <p className="font-semibold">{z.label.en}{z.label.fa && z.label.fa !== z.label.en ? <span className="font-normal text-white/60"> · {z.label.fa}</span> : null}</p>
              <p className={o?.length ? "text-emerald-300" : "text-amber-200"}>
                {o?.length ? `🟩 Border ${mmss(o[0].t)}–${mmss(o[o.length - 1].t)}${z.auto ? " (found by the finder)" : ""}` : `🔍 only, ${mmss(z.pins[0].t)}–${mmss(z.pins[z.pins.length - 1].t)}: no border yet`}
                {o?.length === 1 ? " — one moment only: «Draw again»" : ""}
              </p>
              <p className="text-white/60">{z.manifest ? "📷 Its zoom photo opens from the border." : "📷 No photos yet: store's page → «Shelf zoom photos» → choose this shelf."}</p>
              <div className="flex flex-wrap gap-1">
                <button className={btn} onClick={() => engine.current?.seek((o?.length ? o[o.length >> 1] : z.pins[z.pins.length >> 1]).t)}>Go to</button>
                <button className={btn} onClick={() => { setText(z.n !== undefined ? String(z.n) : ""); setAt({ step: "n", id: z.id }); }}>Number and name</button>
                <button className={btn} disabled={Boolean(following)} onClick={() => setAt({ step: "tap", id: z.id, taps: [] })}>Draw again</button>
                {viewKey && <button className={btn} onClick={() => {
                  if (!confirm(`Take «${z.label.en}» off the walk?${z.manifest ? " Its photos stay on the store's page." : ""}`)) return;
                  if (following?.id === z.id && run.current) { run.current.cancelled = true; setFollowing(null); }
                  change(dropZoom(walksRef.current, viewKey, z.id));
                  setStatus({ tone: "ok", text: `«${z.label.en}» is off the walk — saving…` });
                }}>Remove</button>}
              </div>
            </li>
          );
        })}
        {orphans.map((r) => (
          <li key={r.id} className="flex gap-2 rounded-lg bg-white/5 p-2">
            {r.thumb && <img src={r.thumb} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold">{r.label.en} <span className="font-normal text-white/50">· stitched photo, {r.mp} MP</span></p>
              <p className="text-amber-200">Not on the walk: its shelf was not found by itself.</p>
              <button className={btn} disabled={Boolean(following)} onClick={() => setAt({ step: "tap", id: r.id, taps: [] })}>Draw its border</button>
            </div>
          </li>
        ))}
      </ul>
      {!shelves.length && !orphans.length && <p className="text-amber-200">No shelf is marked yet.</p>}
    </div>
  );
}
