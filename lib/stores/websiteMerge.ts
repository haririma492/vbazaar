// THE WEBSITE'S PRODUCTS ON THE STORE'S PAGE (owner, 2026-11-06: "the same agent is responsible to integrate the
// result of website scraping to its vbazaar page … so all information & operation particularly 1) free tour
// 2) shelf tour benefit from all that is on the web site").
//
// The store's product list (`scenes/catalogues/store-<slug>.json`) is what both tours' product card reads (name,
// price, photo, description) and what the Tagger looks for in the walk. The explorer's products are merged into
// it, never over the owner:
//   - a product the site has and the list does not → added, with the next free number, `by: "website"`;
//   - one the list already has (same page on the site, or the same English name) → each field is refreshed only
//     where it is empty or still what the site gave last time; a field the owner changed is theirs;
//   - nothing is taken off the list: a product gone from the site is counted, and the owner decides.
// One price a product (the shop's basket has no size choice yet): the lowest of its sizes, and the sizes with
// their prices go in its description.
//
// Pure: imports only types, so `node --test` runs it.
import type { Product } from "@/lib/splats/catalogue";
import type { SiteProduct } from "./websiteRules";

export const MAX_NOTE = 600;
const MAX_NAME = 120;
const MAX_MORE = 8;

const fold = (s: string | undefined) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);
const money = (c: number | null) => (c === null ? "" : `$${(c / 100).toFixed(2)}`);

/** What the site says about a product, in the list's own words: names, one price, the description. */
export function fieldsOf(p: SiteProduct): { en: string; fa: string; priceCents: number | null; note: string } {
  const priced = p.variants.map((v) => v.priceCents).filter((c): c is number => c !== null);
  const priceCents = priced.length ? Math.min(...priced) : p.priceCents;
  const sizes = p.variants.length > 1 ? `Sizes: ${p.variants.map((v) => `${v.title || "—"} ${money(v.priceCents)}`.trim()).join(" · ")}` : "";
  const sale = p.compareAtCents !== null ? `Was ${money(p.compareAtCents)}` : "";
  const head = [sizes, sale].filter(Boolean).join(" · ");
  const room = MAX_NOTE - head.length - 4;
  const en = p.description.en, fa = p.description.fa;
  const each = en && fa ? Math.floor(room / 2) : room;
  const note = [head, en ? cut(en, each) : "", fa ? cut(fa, each) : ""].filter(Boolean).join("\n\n");
  return { en: cut(p.name.en, MAX_NAME), fa: cut(p.name.fa, MAX_NAME), priceCents, note: cut(note, MAX_NOTE) };
}

export type MergeResult = { products: Product[]; added: number; updated: number; unchanged: number; gone: number; full: boolean };

/**
 * The list with the site's products in it.
 * `prev` is what the site gave last time (to tell the site's old words from the owner's), `photo` the address of
 * our copy of a site photo (main photo), `maxNumber` the list's highest number (999).
 */
export function mergeIntoCatalogue(existing: Product[], site: SiteProduct[], prev: SiteProduct[], photo: (url: string) => string | undefined, maxNumber = 999): MergeResult {
  const products = existing.map((p) => ({ ...p }));
  const prevByUrl = new Map(prev.map((p) => [p.url, p]));
  const used = new Set(products.map((p) => p.n));
  let next = 1, added = 0, updated = 0, unchanged = 0, full = false;
  const free = () => { while (used.has(next)) next++; return next <= maxNumber ? next : null; };

  for (const s of site) {
    const now = fieldsOf(s);
    const was = prevByUrl.get(s.url);
    const old = was ? fieldsOf(was) : null;
    const mainPhoto = s.images[0] ? photo(s.images[0]) : undefined;
    const oldPhoto = was?.images[0] ? photo(was.images[0]) : undefined;
    const more = s.images.slice(1, 1 + MAX_MORE);
    const e = products.find((p) => p.web === s.url) ?? (fold(now.en) ? products.find((p) => !p.web && p.by !== "video" && fold(p.en) === fold(now.en)) : undefined);
    if (!e) {
      if (!now.en && !now.fa) continue;
      const n = free();
      if (n === null) { full = true; continue; }
      used.add(n);
      products.push({
        n, unit: "piece", priceCents: now.priceCents, by: "website", web: s.url,
        ...(now.en ? { en: now.en } : {}), ...(now.fa ? { fa: now.fa } : {}), ...(now.note ? { note: now.note } : {}),
        ...(s.sku ? { sku: s.sku.slice(0, 40) } : {}), ...(mainPhoto ? { photo: mainPhoto } : {}), ...(more.length ? { more } : {}),
      });
      added++;
      continue;
    }
    // The site's word replaces a field only while it is empty, or still the site's word from last time.
    let changed = false;
    const take = <K extends "en" | "fa" | "note">(k: K) => {
      const mine = e[k] ?? "";
      if (now[k] && mine !== now[k] && (!mine || (old && mine === old[k]))) { e[k] = now[k]; changed = true; }
    };
    take("en"); take("fa"); take("note");
    if (now.priceCents !== null && e.priceCents !== now.priceCents && (e.priceCents === null || (old && e.priceCents === old.priceCents))) { e.priceCents = now.priceCents; changed = true; }
    if (mainPhoto && e.photo !== mainPhoto && (!e.photo || (oldPhoto && e.photo === oldPhoto))) { e.photo = mainPhoto; changed = true; }
    if (!e.web) { e.web = s.url; changed = true; }
    if (more.length && JSON.stringify(e.more ?? []) !== JSON.stringify(more)) { e.more = more; changed = true; }
    if (changed) updated++; else unchanged++;
  }
  const onSite = new Set(site.map((s) => s.url));
  const gone = products.filter((p) => p.web && !onSite.has(p.web)).length;
  products.sort((a, b) => a.n - b.n);
  return { products, added, updated, unchanged, gone, full };
}
