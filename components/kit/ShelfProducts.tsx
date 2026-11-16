"use client";

/**
 * EACH SECTION'S PRODUCTS, RIGHT AFTER ITS PHOTOS, IN THE WALK'S EDITOR (owner, 2026-11-16, of the editor's last card
 * sending them to the store's page: "after uploading 4 section photos, instead of letting me to upload product photos
 * for each section or / and choose from store web site scraped result it gives me this"). One section at a time
 * («Section 2 of 4», «← Previous section», «Next section →»), its photo, and the same box as on the store's page
 * (`SectionItems`): pick the store's website products, upload product photos from this computer (Type V), or give a
 * picked website product the operator's own photo. Every change saves itself and says so.
 */
import { useCallback, useEffect, useState } from "react";
import { postJson, uploadInParts } from "@/components/stores/upload";
import { MAX_KIT_PRODUCTS, nextFree, type KitPhoto, type KitSection } from "@/lib/stores/kitRules";
import SectionItems, { type SiteItem } from "./SectionItems";

type Shelf = { id: string; label: { en: string; fa: string }; photo: KitPhoto | null; sections: KitSection[] };
type State = { working: boolean; note: string; site: SiteItem[]; siteNote?: string; shelves: Shelf[] };

export default function ShelfProducts({ slug, shelfId }: { slug: string; shelfId: string }) {
  const api = `/api/stores/${slug}`;
  const [st, setSt] = useState<State | null>(null);
  const [k, setK] = useState(0);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setSt(await postJson<State>(api, { action: "kit" })); } catch (e) { setSaid({ ok: false, text: `Could not read the store: ${(e as Error).message}` }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  // While the photos are being put up (their small copies come a little after the upload), the box follows.
  const shelf = st?.shelves.find((s) => s.id === shelfId);
  const waiting = Boolean(st?.working || shelf?.sections.some((x) => !x.photo.thumb || x.products.some((p) => !p.photo.thumb))
    // …and while the Website Explorer is still putting the site's products on the list.
    || (st && !st.site.length && /still putting/.test(st.siteNote ?? "")));
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [waiting, load]);

  /** Choose files from this computer, upload each into the section's next free product slots, then `then` (if any). */
  const choose = (x: KitSection, many: boolean, slotFor: (i: number) => number | null, then?: () => Promise<void>) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
    input.multiple = many;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      let sent = 0;
      const failed: string[] = [];
      for (const [i, f] of files.entries()) {
        const j = slotFor(i);
        if (j === null) { failed.push(`${f.name}: no room left (${MAX_KIT_PRODUCTS} a section)`); continue; }
        setBusy(`${files.length > 1 ? `${i + 1} / ${files.length} · ` : ""}${f.name}`);
        try {
          await uploadInParts(api, { action: "upload", kind: "kit", shelf: shelfId, section: x.i, product: j }, f, () => undefined);
          sent++;
        } catch (e) { failed.push(`${f.name}: ${(e as Error).message}`); }
      }
      if (then && sent && !failed.length) { try { await then(); } catch (e) { failed.push(`saved, but not tied to its website product: ${(e as Error).message}`); } }
      setBusy(null);
      setSaid(failed.length ? { ok: false, text: `Not saved: ${failed.join("; ")}` }
        : { ok: true, text: `✓ ${sent} photo${sent > 1 ? "s" : ""} saved${then ? "" : "; each is matched to the website by itself (check it on the store's page)"}. · ذخیره شد` });
      await load();
    };
    input.click();
  };

  if (!st) return <p className="text-white/60">Reading the store&apos;s products…</p>;
  if (!shelf?.sections.length) return <p className="text-amber-200">This shelf has no section photos yet: «← Back» and add them first.</p>;
  const sections = shelf.sections;
  const x = sections[Math.min(k, sections.length - 1)];
  const free = (taken: number[]) => (i: number) => {
    let n = 0;
    for (let j = 1; j <= MAX_KIT_PRODUCTS; j++) if (!taken.includes(j)) { if (n === i) return j; n++; }
    return null;
  };

  return (
    <div className="space-y-2">
      <p className="font-semibold">Section {x.i} of {sections.length}: its products · محصولات بخش {x.i}</p>
      {x.photo.thumb
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={x.photo.thumb} alt="" className="max-h-40 rounded border border-white/15 object-contain" />
        : <p className="text-white/60"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />The photo is being put up…</p>}
      <SectionItems section={x} site={st.site} siteNote={st.siteNote} uploading={Boolean(busy)}
        onSave={async (webs) => {
          try { await postJson(api, { action: "kitItems", section: x.id, webs }); setSaid({ ok: true, text: "✓ Saved · ذخیره شد" }); await load(); return true; }
          catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); return false; }
        }}
        onUploadLocal={nextFree(x.products.map((p) => p.i), MAX_KIT_PRODUCTS) === null ? null : () => choose(x, true, free(x.products.map((p) => p.i)))}
        onOwnPhoto={(web) => {
          const j = x.products.find((p) => p.match?.web === web)?.i ?? nextFree(x.products.map((p) => p.i), MAX_KIT_PRODUCTS);
          if (j === null) { setSaid({ ok: false, text: `This section has its ${MAX_KIT_PRODUCTS} product photos: remove one on the store's page first.` }); return; }
          choose(x, false, (i) => (i === 0 ? j : null), async () => { await postJson(api, { action: "kitMatch", product: `${x.id}-p${j}`, web }); });
        }} />
      {x.products.length > 0 && <p className="text-[12px] text-white/50">{x.products.length} product photo{x.products.length > 1 ? "s" : ""} from this computer on this section (their website match can be changed on the store&apos;s page).</p>}
      {busy && <p className="text-white/70"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" />Uploading {busy}</p>}
      {said && <p className={said.ok ? "text-emerald-300" : "text-rose-300"}>{said.text}</p>}
      <div className="flex flex-wrap gap-1">
        {k > 0 && <button type="button" className="rounded-full border border-white/20 px-3 py-1" onClick={() => { setK(k - 1); setSaid(null); }}>← Previous section</button>}
        {k < sections.length - 1 && <button type="button" className="rounded-full bg-emerald-400 px-3 py-1 font-semibold text-black" onClick={() => { setK(k + 1); setSaid(null); }}>Next section →</button>}
        <a className="rounded-full border border-white/20 px-3 py-1 text-white/70" href={`/stores/${slug}#kit`} target="_blank" rel="noreferrer">The store&apos;s page ↗</a>
      </div>
    </div>
  );
}
