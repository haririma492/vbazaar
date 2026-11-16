"use client";

/**
 * «SHELF PHOTOS FOR SHOPPING» ON THE STORE'S PAGE (owner, 2026-11-15, the pastry redesign: the store page loads
 * the five kinds of media; "after uploading Type IV system will list all photos scrapped from web site with price
 * and everything to assign to e-commerce panel that will be opened for this particular section"). For each shelf
 * bordered on the walk, in order, one thing at a time:
 *   1  its quality photo (Type III): the whole shelf, square-on (or straight down for a pallet);
 *   2  its sections (Type IV): 3–5 close photos, top to bottom then left to right;
 *   3  each section's products: one photo of each (cut by the operator);
 *   4  each product's website product (Type V): matched by itself, changed here from the store's website list.
 * «Drop all the photos» takes a whole store's photos at once, by their names (`kitRules.ts`: shelf-03.jpg,
 * shelf-03-2.jpg, shelf-03-2-p1.jpg). Photos are shown to shoppers exactly as uploaded. Operator only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson, uploadInParts, type Progress } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";
import { MAX_KIT_PRODUCTS, MAX_SECTIONS, kitFileName, nextFree, parseKitName, type KitPhoto, type KitSection, type KitSlot } from "@/lib/stores/kitRules";
import { formatCents } from "@/lib/splats/catalogue";
import SectionItems, { type SiteItem } from "@/components/kit/SectionItems";

type Shelf = { id: string; n: number | null; label: { en: string; fa: string }; onWalk: boolean; photo: KitPhoto | null; sections: KitSection[] };
type State = { working: boolean; note: string; site: SiteItem[]; shelves: Shelf[] };

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

/** Four taps on the shelf's photo: a section's place, drawn by hand when the finder could not see it. */
function PlaceScreen({ shelf, section, onSave, onClose }: { shelf: string; section: KitSection; onSave: (q: number[]) => void; onClose: () => void }) {
  const [taps, setTaps] = useState<Array<[number, number]>>([]);
  return (
    <div dir="ltr" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-left text-white">
      <p className="text-[15px] font-bold">Where is section {section.i}? · جای بخش {section.i}</p>
      <p className="text-[13px] text-white/70">Tap its 4 corners on the shelf&apos;s photo: top-left, top-right, bottom-right, bottom-left. ({taps.length} of 4)</p>
      <div className="flex max-h-[70vh] max-w-full items-start gap-3">
        <div className="relative max-h-[70vh] select-none" onClick={(e) => {
          if (taps.length >= 4) return;
          const r = e.currentTarget.getBoundingClientRect();
          setTaps((t) => [...t, [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]]);
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shelf} alt="" draggable={false} className="block max-h-[70vh] max-w-[70vw]" />
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
            {taps.length > 1 && <polyline points={taps.map((p) => p.join(",")).join(" ") + (taps.length === 4 ? ` ${taps[0].join(",")}` : "")} fill="none" stroke="#6ee7b7" strokeWidth={0.004} />}
            {taps.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={0.008} fill="#6ee7b7" />)}
          </svg>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {section.photo.thumb && <img src={section.photo.thumb} alt="" className="w-40 rounded border border-white/20" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={QUIET} onClick={() => (taps.length ? setTaps((t) => t.slice(0, -1)) : onClose())}>← Back</button>
        <button type="button" className={KEY} disabled={taps.length !== 4} onClick={() => onSave(taps.flat())}>✓ Save its place · ذخیره</button>
      </div>
    </div>
  );
}

export default function KitCard({ api, operator, editUrl }: { api: string; operator: boolean; editUrl: string | null }) {
  const [st, setSt] = useState<State | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<{ name: string; p: Progress; i: number; of: number } | null>(null);
  const [placing, setPlacing] = useState<{ shelf: string; section: KitSection } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Where the next chosen files go: a slot builder (by order), or "names" (by their names). */
  const into = useRef<"names" | ((i: number) => KitSlot | null)>("names");
  /** What to do once the chosen files are up (an own photo: say which website product it is). */
  const after = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    try { setSt(await postJson<State>(api, { action: "kit" })); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!st?.working) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [st?.working, load]);

  const byN = useMemo(() => new Map((st?.shelves ?? []).filter((s) => s.n !== null).map((s) => [s.n!, s])), [st]);

  async function send(files: File[]) {
    setSaid(null);
    const plan: Array<{ f: File; slot: KitSlot }> = [];
    const skipped: string[] = [];
    // Shelves first, then sections, then products: a product's section is there before it.
    const rank = (s: KitSlot) => (s.section === undefined ? 0 : s.product === undefined ? 1 : 2);
    files.forEach((f, i) => {
      if (into.current === "names") {
        const r = parseKitName(f.name);
        const shelf = r ? byN.get(r.n) : undefined;
        if (!r) skipped.push(`${f.name} (its name does not say where)`);
        else if (!shelf) skipped.push(`${f.name} (no shelf ${r.n} is marked on the walk)`);
        else plan.push({ f, slot: { shelf: shelf.id, ...(r.section ? { section: r.section } : {}), ...(r.product ? { product: r.product } : {}) } });
      } else {
        const slot = into.current(i);
        if (slot) plan.push({ f, slot }); else skipped.push(`${f.name} (no room left)`);
      }
    });
    plan.sort((a, b) => rank(a.slot) - rank(b.slot));
    let sent = 0;
    const failed: string[] = [];
    for (const [i, { f, slot }] of plan.entries()) {
      setBusy({ name: f.name, p: { sent: 0, total: f.size }, i, of: plan.length });
      try {
        await uploadInParts(api, { action: "upload", kind: "kit", ...slot }, f, (p) => setBusy({ name: f.name, p, i, of: plan.length }));
        sent++;
      } catch (e) { failed.push(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy(null);
    const then = after.current;
    after.current = null;
    if (then && sent && !failed.length) { try { await then(); } catch (e) { failed.push(`saved, but not tied to its website product: ${(e as Error).message}`); } }
    const parts = [
      sent ? `✓ ${sent} photo${sent > 1 ? "s" : ""} uploaded; putting them up, finding the sections and matching the products now. · بارگذاری شد` : "",
      skipped.length ? `Not uploaded: ${skipped.join(", ")}.` : "",
      failed.length ? `Failed: ${failed.join("; ")}` : "",
    ].filter(Boolean);
    setSaid({ ok: !failed.length && !skipped.length, text: parts.join(" ") || "Nothing chosen." });
    setSt((x) => (x && sent ? { ...x, working: true } : x));
    await load();
  }

  const pick = (dest: "names" | ((i: number) => KitSlot | null), then: (() => Promise<void>) | null = null) => { into.current = dest; after.current = then; input.current?.click(); };
  const act = async (body: Record<string, unknown>, okText: string) => {
    try { await postJson(api, body); setSaid({ ok: true, text: okText }); await load(); }
    catch (e) { setSaid({ ok: false, text: `Not done: ${(e as Error).message}` }); }
  };

  if (!operator) return null;
  const shelves = st?.shelves ?? [];
  const site = st?.site ?? [];
  const siteOf = (web: string | null | undefined) => site.find((x) => x.web === web);

  return (
    <Card>
      <div id="kit" />
      <Bi fa="عکس‌های قفسه برای خرید (نوع ۳، ۴ و محصولات)" en="Shelf photos for shopping — Type III (the whole shelf), Type IV (its sections) and each section's products: the tray under the walk, the 3× photo and the shopping panel" className="text-[15px] font-bold text-amber-100" />
      <p dir="ltr" className="mt-1 text-left text-[12px] text-white/50">
        For each shelf marked on the walk (editor → «Shelves», its 4 corners): 1) its quality photo, the whole shelf square-on (straight down for a pallet or a table);
        2) its sections, 3 to {MAX_SECTIONS} close photos, top to bottom then left to right; 3) under each section, search the store&apos;s website products and add the ones on it: those are what shoppers get in the panel when they tap the section. Optional: one photo of each product, matched to the website by itself.
        Shown to shoppers exactly as uploaded. Names that place themselves: <b>{kitFileName(3)}</b> (shelf 3), <b>{kitFileName(3, 2)}</b> (its section 2), <b>{kitFileName(3, 2, 1)}</b> (product 1 of that section).
      </p>
      {st?.working && <p dir="ltr" className="mt-2 rounded-md bg-white/10 p-2 text-left text-[13px]"><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />{st.note || "Working…"}</p>}
      {!st?.working && st?.note && <p dir="ltr" className="mt-2 text-left text-[13px] text-white/70">Last run: {st.note}</p>}
      {!site.length && st && <p dir="ltr" className="mt-2 text-left text-[13px] text-amber-200">No website products yet: run the Website Explorer on this page first, so products get their names and prices.</p>}

      <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) void send(fs); }} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={KEY} disabled={Boolean(busy) || !byN.size} onClick={() => pick("names")}>＋ Drop all the photos (by their names) · همهٔ عکس‌ها</button>
        {st && !st.working && <button type="button" className={QUIET} onClick={() => void act({ action: "kitRun" }, "Running again… · دوباره")}>Run again</button>}
        {editUrl && <a className={`${QUIET} inline-flex items-center`} href={editUrl} target="_blank" rel="noreferrer">Mark shelves on the walk ↗</a>}
      </div>
      {st && !shelves.length && <p dir="ltr" className="mt-2 text-left text-[13px] text-amber-200">No shelf is marked on the walk yet: open the editor, «Shelves», «＋ Mark a shelf», and tap its 4 corners.</p>}

      <ol dir="ltr" className="mt-3 space-y-3 text-left">
        {shelves.map((sh) => {
          const free = nextFree(sh.sections.map((x) => x.i), MAX_SECTIONS);
          return (
            <li key={sh.id} className="rounded-lg border border-white/10 bg-black/25 p-3 text-[13px]">
              <div className="flex flex-wrap items-start gap-3">
                {sh.photo?.thumb
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <a href={sh.photo.url} target="_blank" rel="noreferrer"><img src={sh.photo.thumb} alt="" className="h-28 w-auto max-w-[12rem] rounded object-contain" /></a>
                  : <div className="flex h-28 w-24 items-center justify-center rounded bg-white/5 text-[22px]">{sh.photo ? "⏳" : "🟩"}</div>}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-bold">{sh.label.fa} · {sh.label.en}{sh.n !== null ? ` (shelf ${sh.n})` : ""}</p>
                  {!sh.onWalk && <p className="text-amber-200">Not bordered on the walk: the tray cannot follow it.</p>}
                  <p className={sh.photo ? "text-emerald-200" : "text-amber-200"}>{sh.photo ? `✓ Quality photo: ${sh.photo.name} (${mb(sh.photo.size)})${sh.photo.w ? `, ${sh.photo.w}×${sh.photo.h}` : ""}` : "1) Its quality photo (Type III) is next."}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" className={QUIET} disabled={Boolean(busy)} onClick={() => pick((i) => (i === 0 ? { shelf: sh.id } : null))}>{sh.photo ? "Replace the quality photo" : "＋ Quality photo (Type III)"}</button>
                    {sh.photo && free !== null && <button type="button" className={QUIET} disabled={Boolean(busy)} onClick={() => pick((i) => {
                      const used = sh.sections.map((x) => x.i);
                      let k = 0, slot: number | null = null;
                      for (let j = 1; j <= MAX_SECTIONS; j++) if (!used.includes(j)) { if (k === i) { slot = j; break; } k++; }
                      return slot ? { shelf: sh.id, section: slot } : null;
                    })}>＋ Sections (Type IV), {MAX_SECTIONS - sh.sections.length} more</button>}
                    {(sh.photo || sh.sections.length > 0) && <button type="button" className={QUIET} onClick={() => { if (confirm(`Take away every photo of «${sh.label.en}»? The border stays on the walk.`)) void act({ action: "kitRemove", shelf: sh.id }, "✓ Taken away"); }}>Remove all</button>}
                  </div>
                </div>
              </div>

              {sh.sections.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {sh.sections.map((x) => {
                    const pfree = nextFree(x.products.map((p) => p.i), MAX_KIT_PRODUCTS);
                    return (
                      <li key={x.id} className="rounded-md border border-white/10 bg-black/30 p-2">
                        <div className="flex flex-wrap items-start gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {x.photo.thumb ? <a href={x.photo.url} target="_blank" rel="noreferrer"><img src={x.photo.thumb} alt="" className="h-20 w-auto max-w-[9rem] rounded object-contain" /></a> : <div className="flex h-20 w-20 items-center justify-center rounded bg-white/5">⏳</div>}
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-bold">Section {x.i} · بخش {x.i} <span className="font-normal text-white/50">({x.photo.name})</span></p>
                            <p className={x.place?.quad ? "text-emerald-200" : x.place ? "text-amber-200" : "text-white/55"}>
                              {x.place?.quad ? `✓ Placed in the shelf's photo (${x.place.by === "hand" ? "drawn by hand" : x.place.note})` : x.place ? `Not found in the shelf's photo: ${x.place.note}. Draw its place.` : "Being placed in the shelf's photo…"}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {sh.photo?.url && <button type="button" className={QUIET} onClick={() => setPlacing({ shelf: sh.photo!.url!, section: x })}>{x.place?.quad ? "Draw its place again" : "Draw its place"}</button>}
                              {x.place?.by === "hand" && <button type="button" className={QUIET} onClick={() => void act({ action: "kitPlace", section: x.id, quad: null }, "Looking for it again…")}>Find it by itself</button>}
                              <button type="button" className={QUIET} disabled={Boolean(busy)} onClick={() => pick(() => ({ shelf: sh.id, section: x.i }))}>Replace photo</button>

                              <button type="button" className={QUIET} onClick={() => { if (confirm(`Take section ${x.i} and its products away?`)) void act({ action: "kitRemove", shelf: sh.id, section: x.i }, "✓ Taken away"); }}>Remove</button>
                            </div>
                          </div>
                        </div>
                        <SectionItems section={x} site={site} uploading={Boolean(busy)}
                          onUploadLocal={pfree === null ? null : () => pick((i) => {
                            const used = x.products.map((p) => p.i);
                            let k = 0;
                            for (let j = 1; j <= MAX_KIT_PRODUCTS; j++) if (!used.includes(j)) { if (k === i) return { shelf: sh.id, section: x.i, product: j }; k++; }
                            return null;
                          })}
                          onOwnPhoto={pfree === null && !x.products.length ? null : (web) => {
                            // Its own photo goes in the slot it had, else the next free one; then it is tied to the website product.
                            const j = x.products.find((p) => p.match?.web === web)?.i ?? pfree;
                            if (j === null) { setSaid({ ok: false, text: `This section has its ${MAX_KIT_PRODUCTS} product photos: remove one first.` }); return; }
                            pick((i) => (i === 0 ? { shelf: sh.id, section: x.i, product: j } : null),
                              async () => { await postJson(api, { action: "kitMatch", product: `${x.id}-p${j}`, web }); });
                          }}
                          onSave={async (webs) => {
                          try { await postJson(api, { action: "kitItems", section: x.id, webs }); setSaid({ ok: true, text: "✓ Saved · ذخیره شد" }); await load(); return true; }
                          catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); return false; }
                        }} />
                        {x.products.length > 0 && (
                          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                            {x.products.map((p) => {
                              const m = siteOf(p.match?.web);
                              return (
                                <li key={p.id} className="flex gap-2 rounded bg-white/[0.04] p-2">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  {p.photo.thumb ? <img src={p.photo.thumb} alt="" className="h-16 w-16 rounded bg-white object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded bg-white/5">⏳</div>}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  {m?.photo && <img src={m.photo} alt="" className="h-16 w-16 rounded bg-white object-contain" />}
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <p className={m ? "text-emerald-200" : p.match ? "text-amber-200" : "text-white/55"}>
                                      {m ? `✓ ${m.en || m.fa}${m.priceCents !== null ? ` · ${formatCents(m.priceCents)} / ${m.unit}` : ""}${p.match?.by === "auto" ? ` (matched, ${Math.round((p.match.confidence ?? 0) * 100)}%)` : " (chosen)"}`
                                        : p.match ? `Not on the website${p.match.by === "auto" ? `: ${p.match.why}` : ""}. Shoppers see the photo, no price yet.` : "Matching…"}
                                    </p>
                                    <select value={p.match?.web ?? ""} onChange={(e) => void act({ action: "kitMatch", product: p.id, web: e.target.value || null }, "✓ Saved · ذخیره شد")}
                                      className="w-full rounded border border-white/20 bg-black/60 px-1 py-1 text-[12px] text-white">
                                      <option value="">— Not on the website (no price yet) —</option>
                                      {site.map((w) => <option key={w.web} value={w.web}>{w.en || w.fa}{w.priceCents !== null ? ` · ${formatCents(w.priceCents)}` : ""}</option>)}
                                    </select>
                                    <button type="button" className="text-[12px] text-white/45 underline" onClick={() => void act({ action: "kitRemove", shelf: sh.id, section: x.i, product: p.i }, "✓ Taken away")}>Remove</button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {busy && (
        <div className="mt-3" dir="ltr">
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-300/80 transition-all" style={{ width: `${busy.p.total ? (busy.p.sent / busy.p.total) * 100 : 0}%` }} /></div>
          <p className="mt-1 text-left text-[12px] text-white/55">{busy.of > 1 ? `${busy.i + 1} / ${busy.of} · ` : ""}{busy.name} — {mb(busy.p.sent)} of {mb(busy.p.total)}</p>
        </div>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
      {placing && <PlaceScreen shelf={placing.shelf} section={placing.section} onClose={() => setPlacing(null)} onSave={(q) => {
        const id = placing.section.id;
        setPlacing(null);
        void act({ action: "kitPlace", section: id, quad: q }, "✓ Its place is saved · ذخیره شد");
      }} />}
    </Card>
  );
}
