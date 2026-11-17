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
import { MAX_KIT_PRODUCTS, MAX_SECTIONS, emptySections, kitFileName, nextFree, parseKitName, type KitPhoto, type KitSection, type KitSlot } from "@/lib/stores/kitRules";
import { formatCents } from "@/lib/splats/catalogue";
import { type SiteItem } from "@/components/kit/SectionItems";
import ShelfProducts from "@/components/kit/ShelfProducts";
import TrayTimeline from "@/components/kit/TrayTimeline";

type Shelf = { id: string; name: { en: string; fa: string } | null; trayAt: number | null; trayEnd: number | null; border: [number, number] | null; n: number | null; label: { en: string; fa: string }; onWalk: boolean; photo: KitPhoto | null; sections: KitSection[] };
type State = { working: boolean; note: string; site: SiteItem[]; siteNote?: string; walkVideo?: string | null; walkFlat?: boolean; shelves: Shelf[] };

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export default function KitCard({ api, operator, editUrl }: { api: string; operator: boolean; editUrl: string | null }) {
  const slug = api.split("/").pop() ?? "";
  const [st, setSt] = useState<State | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<{ name: string; p: Progress; i: number; of: number } | null>(null);
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

      {st?.walkVideo && shelves.some((x) => x.onWalk) && (
        <TrayTimeline api={api} video={st.walkVideo} flat={Boolean(st.walkFlat)} shelves={shelves.filter((x) => x.onWalk).map((x) => ({ id: x.id, label: x.label, trayAt: x.trayAt, trayEnd: x.trayEnd }))} onSaved={() => void load()} />
      )}
      {/* Each shelf, whole: the same screen as the walk's editor (owner, 2026-11-16: "all that we can do … in the &edit=1
          mode … ALSO need to be readily and conveniently available in store page"). */}
      <ol dir="ltr" className="mt-3 space-y-3 text-left">
        {shelves.map((sh) => (
          <li key={sh.id} className="rounded-lg border border-white/10 bg-black/25 p-3 text-[13px]">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-bold text-amber-100">{sh.label.fa} · {sh.label.en}{sh.n !== null ? ` (shelf ${sh.n})` : ""}</p>
              {!sh.onWalk && <span className="text-amber-200">Not bordered on the walk: the tray cannot follow it.</span>}
              {(sh.photo || sh.sections.length > 0) && <button type="button" className="ml-auto text-[12px] text-rose-200 underline" onClick={() => { if (confirm(`Take away every photo of «${sh.label.en}»? The border stays on the walk.`)) void act({ action: "kitRemove", shelf: sh.id }, "✓ Taken away"); }}>Remove all its photos</button>}
            </div>
            {sh.onWalk && <ShelfMeta api={api} shelf={sh} onSaved={load} />}
            <ShelfProducts slug={slug} shelfId={sh.id} onChanged={load} />
          </li>
        ))}
      </ol>
      {busy && (
        <div className="mt-3" dir="ltr">
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-300/80 transition-all" style={{ width: `${busy.p.total ? (busy.p.sent / busy.p.total) * 100 : 0}%` }} /></div>
          <p className="mt-1 text-left text-[12px] text-white/55">{busy.of > 1 ? `${busy.i + 1} / ${busy.of} · ` : ""}{busy.name} — {mb(busy.p.sent)} of {mb(busy.p.total)}</p>
        </div>
      )}
      {said && <Said ok={said.ok} text={said.text} />}

    </Card>
  );
}

/**
 * A SHELF'S NUMBER AND NAMES, AND ITS SECTIONS' NAMES (owner, 2026-11-17: "on store page … allow operator to change the
 * metadata for each shelf / section (name, number ..)"). Closed until «✎ Number and names»; each row saves on «Save»
 * and says so. A section keeps its number (share links and product ids hold it); its name is what shoppers read.
 */
function ShelfMeta({ api, shelf, onSaved }: { api: string; shelf: Shelf; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(shelf.n !== null ? String(shelf.n) : "");
  const [en, setEn] = useState(shelf.name?.en ?? "");
  const [fa, setFa] = useState(shelf.name?.fa ?? "");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const sections = [...shelf.sections].sort((a, b) => a.i - b.i);
  const save = async (body: Record<string, unknown>, what: string) => {
    try { await postJson(api, body); setSaid({ ok: true, text: `✓ ${what} saved. · ذخیره شد` }); onSaved(); }
    catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
  };
  const input = "rounded-md border border-white/20 bg-black/40 px-2 py-1 text-[13px] text-white";
  if (!open) return <button type="button" className="mb-2 text-[12px] text-sky-200 underline" onClick={() => setOpen(true)}>✎ Number and names · شماره و نام</button>;
  return (
    <div dir="ltr" className="mb-3 space-y-2 rounded-lg border border-sky-300/30 bg-sky-300/[0.05] p-2 text-left text-[13px]">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-white/60">Shelf number</span>
          <input className={`${input} w-20`} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} /></label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5"><span className="text-[11px] text-white/60">Name (English)</span>
          <input className={input} value={en} onChange={(e) => setEn(e.target.value)} placeholder="e.g. Honey and Jams" /></label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5"><span className="text-[11px] text-white/60">Name (Farsi)</span>
          <input dir="rtl" className={input} value={fa} onChange={(e) => setFa(e.target.value)} placeholder="مثلاً عسل و مربا" /></label>
        <button type="button" className="rounded-full bg-sky-400 px-3 py-1 text-[12px] font-semibold text-black"
          onClick={() => void save({ action: "kitShelfMeta", shelf: shelf.id, n: n ? Number(n) : null, en, fa }, "The shelf")}>Save the shelf</button>
      </div>
      {sections.map((x) => <SectionMeta key={x.id} section={x} save={save} input={input} />)}
      <div className="flex items-center gap-3">
        {said && <p className={said.ok ? "text-emerald-300" : "text-rose-300"}>{said.text}</p>}
        <button type="button" className="ml-auto text-[12px] text-white/60 underline" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}

function SectionMeta({ section, save, input }: { section: KitSection; save: (b: Record<string, unknown>, what: string) => Promise<void>; input: string }) {
  const [en, setEn] = useState(section.name?.en ?? "");
  const [fa, setFa] = useState(section.name?.fa ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-2">
      <span className="w-20 pb-1 text-[12px] text-white/70">Section {section.i}</span>
      <input className={`${input} min-w-[9rem] flex-1`} value={en} onChange={(e) => setEn(e.target.value)} placeholder="Name (English), e.g. Rock candy" />
      <input dir="rtl" className={`${input} min-w-[9rem] flex-1`} value={fa} onChange={(e) => setFa(e.target.value)} placeholder="نام (فارسی)" />
      <button type="button" className="rounded-full border border-sky-300/60 px-3 py-1 text-[12px]"
        onClick={() => void save({ action: "kitSectionMeta", section: section.id, en, fa }, `Section ${section.i}`)}>Save</button>
    </div>
  );
}
