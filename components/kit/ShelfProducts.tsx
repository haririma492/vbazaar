"use client";

/**
 * ONE SHELF, WHOLE: ITS PHOTO (III), ITS SECTIONS (IV) AND EACH SECTION'S PRODUCTS (V). The same screen in the walk's
 * editor (after the shelf's border and name) and on the store's page, one under another per shelf (owner, 2026-11-16:
 * "all that we can do in a canvas fashion answering questions in the &edit=1 mode … ALSO need to be readily and
 * conveniently available in store page … so operator can change each type (III, IV & Vs) and connect them properly
 * (which section IV has which products Vs)"; before that, of the editor: "instead of letting me to upload product
 * photos for each section or / and choose from store web site scraped result it gives me this").
 *
 *   III  the shelf's photo: replace it;
 *   IV   a strip of every section with its product count; «＋ Add sections»; the open section's photo: replace it, draw
 *        where it is on the shelf's photo (when the finder could not), remove it;
 *   V    the open section's products: pick the store's website products (`SectionItems`), upload product photos from
 *        this computer, or give a picked website product the operator's own photo; and every photo from this
 *        computer listed with WHICH website product it is (a dropdown), «Move to section n», «Remove».
 * One section at a time («Section 2 of 4», «← Previous section», «Next section →»). Every change saves itself and
 * says so; nothing is sewn or joined (owner, 2026-11-16).
 */
import { useCallback, useEffect, useState } from "react";
import { postJson, uploadInParts } from "@/components/stores/upload";
import { formatCents } from "@/lib/splats/catalogue";
import { MAX_KIT_PRODUCTS, MAX_SECTIONS, emptySections, nextFree, sectionProductCount, type KitPhoto, type KitSection } from "@/lib/stores/kitRules";
import SectionItems, { type PhotoFrom, type SiteItem } from "./SectionItems";
import PhotoBrowser from "@/components/virtual-bazaar/walk/PhotoBrowser";
import PlaceScreen from "./PlaceScreen";

type Shelf = { id: string; n?: number | null; label: { en: string; fa: string }; photo: KitPhoto | null; sections: KitSection[] };
type State = { working: boolean; note: string; site: SiteItem[]; sitePhotos?: SiteItem[]; siteNote?: string; shelves: Shelf[] };
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const BTN = "rounded-full border border-white/20 px-3 py-1 text-[13px] disabled:opacity-40";

export default function ShelfProducts({ slug, shelfId, onEmpty, onChanged, inEditor = false }: {
  slug: string; shelfId: string;
  /** Told which sections still have no products (their numbers), so the editor can say so before «Done». */
  onEmpty?: (sections: number[]) => void;
  /** Told after every saved change (the store's page reloads its summary). */
  onChanged?: () => void;
  /** In the walk's editor: a link to the store's page; there, the shelf's photo is its own step before. */
  inEditor?: boolean;
}) {
  const api = `/api/stores/${slug}`;
  const [st, setSt] = useState<State | null>(null);
  const [k, setK] = useState(0);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [placing, setPlacing] = useState<KitSection | null>(null);
  // A product photo picked from the store's photos: for this section, or for one website product of it (owner, 2026-11-23).
  const [browse, setBrowse] = useState<{ sec: KitSection; web?: string } | null>(null);

  const load = useCallback(async () => {
    try { setSt(await postJson<State>(api, { action: "kit" })); } catch (e) { setSaid({ ok: false, text: `Could not read the store: ${(e as Error).message}` }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  // While the photos are being put up (their small copies come a little after the upload), the screen follows.
  const shelf = st?.shelves.find((s) => s.id === shelfId);
  const waiting = Boolean(st?.working || (shelf?.photo && !shelf.photo.thumb) || shelf?.sections.some((x) => !x.photo.thumb || x.products.some((p) => !p.photo.thumb))
    // …and while the Website Explorer is still putting the site's products on the list.
    || (st && !st.site.length && /still putting/.test(st.siteNote ?? "")));
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [waiting, load]);

  const done = async (text: string) => { setSaid({ ok: true, text }); await load(); onChanged?.(); };
  const act = async (body: Record<string, unknown>, text: string) => {
    try { await postJson(api, body); await done(text); } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
  };

  /** Choose files from this computer and upload each to the slot `slotFor(i)` gives, then `then` (if any). */
  const choose = (many: boolean, slotFor: (i: number, f: File) => Record<string, unknown> | null, then?: () => Promise<void>) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.multiple = many;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      let sent = 0;
      const failed: string[] = [];
      for (const [i, f] of files.entries()) {
        const slot = slotFor(i, f);
        if (!slot) { failed.push(`${f.name}: no room left`); continue; }
        setBusy(`${files.length > 1 ? `${i + 1} / ${files.length} · ` : ""}${f.name}`);
        try {
          await uploadInParts(api, { action: "upload", kind: "kit", shelf: shelfId, ...slot }, f, () => undefined);
          sent++;
        } catch (e) { failed.push(`${f.name}: ${(e as Error).message}`); }
      }
      if (then && sent && !failed.length) { try { await then(); } catch (e) { failed.push(`saved, but not tied to its website product: ${(e as Error).message}`); } }
      setBusy(null);
      if (failed.length) setSaid({ ok: false, text: `Not saved: ${failed.join("; ")}` });
      else await done(`✓ ${sent} photo${sent > 1 ? "s" : ""} saved. · ذخیره شد`);
    };
    input.click();
  };
  /** A product photo from the store's photos into this section (`web`: it is that website product's own photo, and is tied to it). */
  const fromStore = async (sec: KitSection, url: string, web?: string) => {
    setBusy("the store's photo…");
    try {
      if (web) {
        const j = sec.products.find((p) => p.match?.web === web)?.i ?? nextFree(sec.products.map((p) => p.i), MAX_KIT_PRODUCTS);
        if (j === null) throw new Error(`This section has its ${MAX_KIT_PRODUCTS} product photos: remove one first.`);
        await postJson(api, { action: "kitShelfFromLibrary", shelf: shelfId, url, section: sec.i, product: j });
        await postJson(api, { action: "kitMatch", product: `${sec.id}-p${j}`, web });
      } else {
        await postJson(api, { action: "kitShelfFromLibrary", shelf: shelfId, url, section: sec.i, product: "next" });
      }
      await done(`✓ ${web ? "Your own photo saved" : "1 photo saved"}. · ذخیره شد`);
    } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    setBusy(null);
  };
  /** The i-th free number among `taken` (1…max). */
  const freeAt = (taken: number[], max: number) => (i: number) => {
    let n = 0;
    for (let j = 1; j <= max; j++) if (!taken.includes(j)) { if (n === i) return j; n++; }
    return null;
  };

  const empty = shelf ? emptySections(shelf.sections) : [];
  const emptyKey = empty.join(",");
  useEffect(() => { if (st && shelf) onEmpty?.(emptyKey ? emptyKey.split(",").map(Number) : []); }, [emptyKey, st, shelf, onEmpty]);
  if (!st) return <p className="text-white/60">Reading the store&apos;s products…</p>;
  if (!shelf) return <p className="text-amber-200">This shelf has no photos yet.</p>;
  const sections = shelf.sections;
  const x: KitSection | undefined = sections[Math.min(k, Math.max(0, sections.length - 1))];
  const siteOf = (web: string | null | undefined) => st.site.find((w) => w.web === web);
  const sectionFree = nextFree(sections.map((s) => s.i), MAX_SECTIONS);
  const addSections = () => choose(true, (i) => { const j = freeAt(sections.map((s) => s.i), MAX_SECTIONS)(i); return j ? { section: j } : null; });

  return (
    <div className="space-y-2 text-[13px]">
      {/* III · the shelf's photo (in the editor it has its own step before this one). */}
      {!inEditor && (
        <div className="flex flex-wrap items-center gap-2">
          {shelf.photo?.thumb
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={shelf.photo.thumb} alt="" className="h-20 w-auto max-w-[10rem] rounded object-contain ring-1 ring-white/15" />
            : <div className="flex h-20 w-24 items-center justify-center rounded bg-white/5">{shelf.photo ? "⏳" : "🟩"}</div>}
          <div className="space-y-1">
            <p className="font-bold">The shelf&apos;s photo (Type III) · عکس قفسه</p>
            <button type="button" className={BTN} disabled={Boolean(busy)} onClick={() => choose(false, (i) => (i === 0 ? {} : null))}>{shelf.photo ? "Replace" : "＋ Upload"} the shelf&apos;s photo</button>
          </div>
        </div>
      )}

      {/* IV · every section, with how many products it has (owner, 2026-11-16: "make it clear that these are for which
          section … and ensure all sections do have products"). */}
      <p className="font-bold">Its sections (Type IV) · بخش‌ها — {sections.length} of up to {MAX_SECTIONS}</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {sections.map((s, j) => {
          const n = sectionProductCount(s);
          return (
            <button key={s.id} type="button" onClick={() => { setK(j); setSaid(null); }}
              className={`flex shrink-0 flex-col items-center gap-0.5 rounded-lg p-1 ${j === k ? "bg-emerald-400/25 ring-2 ring-emerald-300" : "bg-white/5 ring-1 ring-white/15"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s.photo.thumb ? <img src={s.photo.thumb} alt="" className="h-10 w-14 rounded object-cover" /> : <span className="flex h-10 w-14 items-center justify-center">⏳</span>}
              <span className="text-[11px] font-bold">Section {s.i}</span>
              <span className={`text-[11px] ${n ? "text-emerald-300" : "text-amber-300"}`}>{n ? `✓ ${n} product${n > 1 ? "s" : ""}` : "⚠ none yet"}</span>
            </button>
          );
        })}
        {sectionFree !== null && (
          <button type="button" disabled={Boolean(busy)} onClick={addSections}
            className="flex w-20 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/30 p-1 text-[11px] text-white/70 disabled:opacity-40">
            <span className="text-[18px]">＋</span>Add sections
          </button>
        )}
      </div>

      {x && (<>
        <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/[0.05] p-2">
          <p className="text-[15px] font-bold text-emerald-100">SECTION {x.i} of {sections.length} · بخش {x.i}</p>
          <div className="mt-1 flex flex-wrap items-start gap-2">
            {x.photo.thumb
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={x.photo.thumb} alt="" className="max-h-36 rounded border-2 border-emerald-300/70 object-contain" />
              : <p className="text-white/60"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />The photo is being put up…</p>}
            <div className="space-y-1">
              <p className={x.place?.quad ? "text-emerald-200" : x.place ? "text-amber-200" : "text-white/55"}>
                {x.place?.quad ? `✓ Found on the shelf's photo${x.place.by === "hand" ? " (drawn by hand)" : ""}` : x.place ? `Not found on the shelf's photo: ${x.place.note}` : "Being found on the shelf's photo…"}
              </p>
              <div className="flex flex-wrap gap-1">
                <button type="button" className={BTN} disabled={Boolean(busy)} onClick={() => choose(false, (i) => (i === 0 ? { section: x.i } : null))}>Replace its photo</button>
                {shelf.photo?.url && <button type="button" className={BTN} onClick={() => setPlacing(x)}>{x.place?.quad ? "Draw its place again" : "Draw its place"}</button>}
                {x.place?.by === "hand" && <button type="button" className={BTN} onClick={() => void act({ action: "kitPlace", section: x.id, quad: null }, "Looking for it again…")}>Find it by itself</button>}
                <button type="button" className={`${BTN} text-rose-200`} onClick={() => { if (confirm(`Remove section ${x.i} and its products?`)) { setK(0); void act({ action: "kitRemove", shelf: shelfId, section: x.i }, "✓ Section removed"); } }}>Remove section</button>
              </div>
            </div>
          </div>
        </div>

        {/* V · the section's products: the website's, and photos from this computer. */}
        <SectionItems section={x} site={st.site} photos={st.sitePhotos ?? []} siteNote={st.siteNote} uploading={Boolean(busy)}
          onSave={async (webs) => {
            try { await postJson(api, { action: "kitItems", section: x.id, webs }); await done("✓ Saved · ذخیره شد"); return true; }
            catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); return false; }
          }}
          onUploadLocal={nextFree(x.products.map((p) => p.i), MAX_KIT_PRODUCTS) === null ? null : (from: PhotoFrom) => {
            if (from === "store") { setBrowse({ sec: x }); return; }
            choose(true, (i) => { const j = freeAt(x.products.map((p) => p.i), MAX_KIT_PRODUCTS)(i); return j ? { section: x.i, product: j } : null; });
          }}
          onOwnPhoto={(web, from) => {
            const j = x.products.find((p) => p.match?.web === web)?.i ?? nextFree(x.products.map((p) => p.i), MAX_KIT_PRODUCTS);
            if (j === null) { setSaid({ ok: false, text: `This section has its ${MAX_KIT_PRODUCTS} product photos: remove one first.` }); return; }
            if (from === "store") { setBrowse({ sec: x, web }); return; }
            choose(false, (i) => (i === 0 ? { section: x.i, product: j } : null), async () => { await postJson(api, { action: "kitMatch", product: `${x.id}-p${j}`, web }); });
          }} />

        {x.products.length > 0 && (
          <div className="space-y-1">
            <p className="font-bold">Product photos from this computer on section {x.i} ({x.products.length}): which website product each is</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {x.products.map((p) => {
                const m = siteOf(p.match?.web);
                return (
                  <li key={p.id} className="flex gap-2 rounded bg-white/[0.04] p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.photo.thumb ? <img src={p.photo.thumb} alt="" className="h-14 w-14 shrink-0 rounded bg-white object-contain" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-white/5">⏳</div>}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className={`truncate ${m ? "text-emerald-200" : p.match ? "text-amber-200" : "text-white/55"}`}>
                        {m ? `✓ ${m.en || m.fa}${m.priceCents !== null ? ` · ${formatCents(m.priceCents)}` : ""}` : p.match ? "Not on the website: no name or price yet" : "Matching to the website…"}
                      </p>
                      <select value={p.match?.web ?? ""} aria-label="Which website product" onChange={(e) => void act({ action: "kitMatch", product: p.id, web: e.target.value || null }, "✓ Saved · ذخیره شد")}
                        className="w-full rounded border border-white/20 bg-black/60 px-1 py-1 text-[12px] text-white">
                        <option value="">— Not on the website —</option>
                        {st.site.map((w) => <option key={w.web} value={w.web}>{w.en || w.fa}{w.priceCents !== null ? ` · ${formatCents(w.priceCents)}` : ""}</option>)}
                      </select>
                      <div className="flex flex-wrap items-center gap-1">
                        {sections.length > 1 && (
                          <select value="" aria-label="Move to another section" onChange={(e) => { const to = Number(e.target.value); if (to) void act({ action: "kitMove", product: p.id, section: to }, `✓ Moved to section ${to}`); }}
                            className="rounded border border-white/20 bg-black/60 px-1 py-0.5 text-[12px] text-white">
                            <option value="">Move to section…</option>
                            {sections.filter((s) => s.i !== x.i).map((s) => <option key={s.id} value={s.i}>Section {s.i}</option>)}
                          </select>
                        )}
                        <button type="button" className="text-[12px] text-rose-200 underline" onClick={() => { if (confirm("Remove this product photo?")) void act({ action: "kitRemove", shelf: shelfId, section: x.i, product: p.i }, "✓ Removed"); }}>Remove</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </>)}
      {!sections.length && <p className="text-amber-200">No sections yet: «＋ Add sections» (3 to {MAX_SECTIONS} photos, top to bottom then left to right).</p>}

      {busy && <p className="text-white/70"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" />Uploading {busy}</p>}
      {said && <p className={said.ok ? "text-emerald-300" : "text-rose-300"}>{said.text}</p>}
      {sections.length > 0 && (empty.length > 0
        ? <p className="text-amber-200">⚠ Section{empty.length > 1 ? "s" : ""} {empty.join(", ")} {empty.length > 1 ? "have" : "has"} no products yet: shoppers tapping {empty.length > 1 ? "them" : "it"} would find an empty list.</p>
        : <p className="text-emerald-300">✓ Every section of this shelf has products.</p>)}
      {sections.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {k > 0 && <button type="button" className={BTN} onClick={() => { setK(k - 1); setSaid(null); }}>← Previous section</button>}
          {k < sections.length - 1 && <button type="button" className="rounded-full bg-emerald-400 px-3 py-1 font-semibold text-black" onClick={() => { setK(k + 1); setSaid(null); }}>Next section →</button>}
          {inEditor && <a className={`${BTN} text-white/70`} href={`/stores/${slug}#kit`} target="_blank" rel="noreferrer">The store&apos;s page ↗</a>}
        </div>
      )}
      {browse && slug && <PhotoBrowser slug={slug} onClose={() => setBrowse(null)} onPick={(src) => { const b = browse; setBrowse(null); void fromStore(b.sec, src, b.web); }} />}
      {placing && shelf.photo?.url && <PlaceScreen shelf={shelf.photo.url} section={placing} onClose={() => setPlacing(null)} onSave={(q) => {
        const id = placing.id;
        setPlacing(null);
        void act({ action: "kitPlace", section: id, quad: q }, "✓ Its place is saved · ذخیره شد");
      }} />}
    </div>
  );
}
