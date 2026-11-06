// THE WEBSITE EXPLORER'S RULES (owner, 2026-11-06: "create an agent … in charge of extracting all information
// needed for virtual store from a store's website such as product photos with good quality, product names,
// product prices, product descriptions … lets start with our new store ShirazGalery").
//
// Pure: imports nothing, so `node --test` runs it. The server half (fetching, the queue, the bucket) is
// `website.ts`; the result is shown at `/stores/<slug>/website`.
//
// How a store's site is read, cheapest and most complete first:
//   1. a shop platform's own public product list (Shopify `/products.json`, WooCommerce's Store API);
//   2. the site's sitemap → its product pages; for each, the JSON the page's OWN scripts ask for
//      (`fetch(\`/api/products/${handle}…\`)`, found in its scripts, `findJsonEndpoints`), else the page's
//      structured data (JSON-LD Product), else its share tags (og:…).
// robots.txt is read first and every path is checked against it (`isDisallowed`). A path it asks robots not to
// read is read only when the operator says the store has agreed (it is the store's own site, joining the bazaar).

export type Money = number | null; // cents

export type SiteVariant = { title: string; priceCents: Money; compareAtCents: Money; available: boolean | null; sku?: string };

export type SiteProduct = {
  /** The product's page on the store's site. */
  url: string;
  handle: string;
  name: { en: string; fa: string };
  description: { en: string; fa: string };
  priceCents: Money;
  /** The price before a sale, when the site shows one. */
  compareAtCents: Money;
  currency: string;
  /** Largest copies the site serves, first the main photo. */
  images: string[];
  variants: SiteVariant[];
  /** The site's own shelf, broadest first (e.g. Serveware › Chafing Dishes). */
  category: string[];
  available: boolean | null;
  sku?: string;
  vendor?: string;
  /** Where the details came from: the site's own JSON, a shop platform's list, structured data, or share tags. */
  source: "json" | "shopify" | "woo" | "jsonld" | "meta";
  /** Its page is in the sitemap but the site does not sell it (its own data says "not found": a draft). Shown with
   *  its photos, never put on the store's list. */
  unlisted?: boolean;
};

// ── robots.txt ────────────────────────────────────────────────────────────────

export type Robots = { disallow: string[]; allow: string[]; sitemaps: string[] };

/** The rules for every robot (`User-agent: *`), plus the sitemaps it names. */
export function parseRobots(text: string): Robots {
  const out: Robots = { disallow: [], allow: [], sitemaps: [] };
  let mine = false, inGroup = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), v = m[2].trim();
    if (key === "sitemap") { if (v) out.sitemaps.push(v); continue; }
    if (key === "user-agent") {
      if (inGroup) { mine = false; inGroup = false; }
      if (v === "*") mine = true;
      continue;
    }
    inGroup = true;
    if (!mine || !v) continue;
    if (key === "disallow") out.disallow.push(v);
    else if (key === "allow") out.allow.push(v);
  }
  return out;
}

const ruleRe = (rule: string) => new RegExp("^" + rule.replace(/[.+?^(){}|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\?\$$/, "$"));

/** Does robots.txt ask robots not to read this path? The longest matching rule wins, Allow on a tie (RFC 9309). */
export function isDisallowed(path: string, robots: Robots): boolean {
  let best = -1, allowed = true;
  for (const [rules, ok] of [[robots.disallow, false], [robots.allow, true]] as const) {
    for (const r of rules) {
      if (!ruleRe(r).test(path)) continue;
      if (r.length > best || (r.length === best && ok)) { best = r.length; allowed = ok; }
    }
  }
  return !allowed;
}

// ── Sitemaps ──────────────────────────────────────────────────────────────────

export type SitemapEntry = { loc: string; images: string[] };

const unXml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

/** A sitemap's pages (with their images), or, for a sitemap index, the sitemaps it lists. */
export function parseSitemap(xml: string): { urls: SitemapEntry[]; sitemaps: string[] } {
  const s = String(xml || "");
  const sitemaps = [...s.matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/g)].map((m) => unXml(m[1]));
  const urls = [...s.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(m[1]);
    return { loc: loc ? unXml(loc[1]) : "", images: [...m[1].matchAll(/<image:loc>([\s\S]*?)<\/image:loc>/g)].map((i) => unXml(i[1])) };
  }).filter((u) => /^https?:\/\//.test(u.loc));
  return { urls, sitemaps };
}

const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return ""; } };

/**
 * Which of the sitemap's pages are products. A `/product/<x>` segment is the clearest sign (and then
 * `/products/<x>` on that site is a SHELF, as on shirazgallery.ca); else Shopify's `/products/<x>`; else
 * any page the sitemap gives a picture for, apart from the home page.
 */
export function productPages(urls: SitemapEntry[]): SitemapEntry[] {
  const one = urls.filter((u) => /\/product\/[^/]+\/?$/.test(pathOf(u.loc)));
  if (one.length) return one;
  const shop = urls.filter((u) => /\/products\/[^/]+\/?$/.test(pathOf(u.loc)));
  if (shop.length) return shop;
  return urls.filter((u) => u.images.length && pathOf(u.loc).replace(/\/$/, "") !== "");
}

export const handleOf = (url: string) => decodeURIComponent(pathOf(url).replace(/\/$/, "").split("/").pop() || "");

// ── The page's own JSON ───────────────────────────────────────────────────────

/**
 * The product JSON a page's own scripts ask for, as templates with `{handle}` where the product goes, e.g.
 * `/api/products/{handle}?locale=en`. A call that POSTs (a review, the cart) is not reading a product, and is
 * left out; any other `${…}` in the address is a setting (the language) and becomes `en`.
 */
export function findJsonEndpoints(js: string): string[] {
  const out = new Set<string>();
  for (const m of String(js || "").matchAll(/fetch\(\s*`(\/[^`$]*product[^`$]*)\$\{[^}]+\}([^`]*)`([^)]{0,160})/gi)) {
    const tail = m[2], after = m[3];
    if (/method\s*:\s*["'](POST|PUT|DELETE|PATCH)/i.test(after)) continue;
    if (/^\/(reviews?|cart|wishlist|questions?)\b/i.test(tail)) continue;
    out.add(`${m[1]}{handle}${tail.replace(/\$\{[^}]+\}/g, "en")}`);
  }
  return [...out];
}

export const fillEndpoint = (template: string, handle: string) => template.replace("{handle}", encodeURIComponent(handle));

// ── Reading a product from what the site gave ─────────────────────────────────

/** A price as cents: 95 → 9500, "95.00" → 9500, "$1,299.50" → 129950, { amount: "9.99" } → 999. */
export function toCents(v: unknown, minorUnits = false): Money {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return toCents(o.amount ?? o.value ?? o.price, minorUnits);
  }
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(minorUnits ? v : v * 100) : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  if (!t || !/\d/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(minorUnits ? n : n * 100) : null;
}

const FA_LETTER = /[\u0600-\u06FF]/;
const EN_LABEL = /^\s*(english\s+description|description\s*\(?english\)?|توضیحات\s+انگلیسی)\s*[:\-–]?\s*/i;
const FA_LABEL = /(توضیحات\s+فارسی|persian\s+description|farsi\s+description|description\s*\(?(persian|farsi)\)?)\s*[:\-–]?\s*/i;

/**
 * One text written in both languages, English then Persian (shirazgallery.ca writes its descriptions so), split
 * in two. The site's own labels («English Description … توضیحات فارسی …») win; otherwise the Persian starts at the
 * first Persian letter after which most of the letters are Persian (so "24 cm قابلمه" stays with the Persian half,
 * and a Persian word inside an English sentence does not split it).
 */
export function splitLanguages(text: string): { en: string; fa: string } {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const labelled = FA_LABEL.exec(t);
  if (labelled) return { en: t.slice(0, labelled.index).replace(EN_LABEL, "").trim(), fa: t.slice(labelled.index + labelled[0].length).trim() };
  const body = t.replace(EN_LABEL, "");
  for (let i = 0; i < body.length; i++) {
    if (!FA_LETTER.test(body[i])) continue;
    const rest = body.slice(i).replace(/[^\p{L}]/gu, "");
    const fa = rest.replace(/[^\u0600-\u06FF]/g, "").length;
    if (fa >= 20 && fa / rest.length >= 0.6) {
      // Numbers and units just before it ("24 cm") belong to the Persian sentence they start.
      const lead = /[\d.,]+\s*[a-zA-Z]{0,3}\s*$/.exec(body.slice(0, i));
      const at = lead && /[.!?]\s*$|^$/.test(body.slice(0, lead.index)) ? lead.index : i;
      return { en: body.slice(0, at).trim(), fa: body.slice(at).trim() };
    }
  }
  return { en: body, fa: "" };
}

const hasFa = (s: string) => /[؀-ۿ]/.test(s);

export function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/**
 * The largest copy of a photo the site serves: Shopify's size suffixes (`_300x300`, `_grande`) and width/height
 * settings removed, WordPress's `-300x300` before the extension removed. Only https; a data: or blob: picture is
 * not kept.
 */
export function bestImageUrl(raw: string, base?: string): string | null {
  let u: URL;
  try { u = new URL(String(raw || "").trim().replace(/^\/\//, "https://"), base); } catch { return null; }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:") return null;
  for (const p of ["width", "height", "w", "h", "crop", "quality", "q", "resize", "fit"]) u.searchParams.delete(p);
  if (/(^|\.)shopify\.com$/.test(u.hostname) || u.pathname.startsWith("/cdn/shop/")) {
    u.pathname = u.pathname.replace(/_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(@\dx)?(?=\.[a-z]{3,4}$)/i, "");
  }
  u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp|gif)$)/i, "");
  return u.toString();
}

function uniqImages(list: unknown[], base?: string): string[] {
  const out: string[] = [];
  for (const it of list) {
    const raw = typeof it === "string" ? it : it && typeof it === "object" ? (it as Record<string, unknown>).url ?? (it as Record<string, unknown>).src ?? (it as Record<string, unknown>).contentUrl : null;
    const u = typeof raw === "string" ? bestImageUrl(raw, base) : null;
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * A product from a JSON object, in any of the shapes we have met: the site's own API (shirazgallery.ca:
 * name, price 95, images [{url}], variants, categoryPath), Shopify's `/products.json` (title, body_html,
 * variants [{price "95.00"}], images [{src}]), WooCommerce's Store API (prices in minor units). Null when it has
 * no name: half a product is worse than none.
 */
export function productFromJson(raw: unknown, url: string, source: SiteProduct["source"] = "json"): SiteProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const p = (o.product && typeof o.product === "object" ? o.product : o) as Record<string, unknown>;
  const nameRaw = str(p.name ?? p.title);
  if (!nameRaw) return null;
  const nameFa = str(p.nameFa ?? p.name_fa ?? p.titleFa);
  const name = hasFa(nameRaw) && !nameFa ? { en: "", fa: nameRaw } : { en: nameRaw, fa: nameFa };

  const descText = stripHtml(str(p.descriptionHtml ?? p.body_html ?? p.description ?? p.short_description));
  const split = splitLanguages(descText);
  const description = { en: split.en, fa: stripHtml(str(p.descriptionFa ?? p.description_fa)) || split.fa };

  const woo = source === "woo" || (p.prices && typeof p.prices === "object");
  const prices = (p.prices ?? {}) as Record<string, unknown>;
  const rawVariants = Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]) : [];
  const variants: SiteVariant[] = rawVariants.map((v) => ({
    title: str(v.title ?? v.name) === "Default Title" ? "" : str(v.title ?? v.name),
    priceCents: toCents(v.price),
    compareAtCents: toCents(v.compareAtPrice ?? v.compare_at_price),
    available: bool(v.availableForSale ?? v.available),
    ...(str(v.sku) ? { sku: str(v.sku) } : {}),
  }));
  const minorUnit = Number(prices.currency_minor_unit ?? 2);
  const wooCents = (v: unknown) => { const c = toCents(v, true); return c === null ? null : Math.round(c * Math.pow(10, 2 - minorUnit)); };
  const priceCents = woo ? wooCents(prices.price) : toCents(p.price) ?? variants.find((v) => v.priceCents !== null)?.priceCents ?? null;
  const compareRaw = woo ? wooCents(prices.regular_price) : toCents(p.compareAtPrice ?? p.compare_at_price) ?? variants.find((v) => v.compareAtCents !== null)?.compareAtCents ?? null;
  const compareAtCents = compareRaw !== null && priceCents !== null && compareRaw > priceCents ? compareRaw : null;

  const catPath = Array.isArray(p.categoryPath) ? (p.categoryPath as unknown[]).map(str).filter(Boolean) : [];
  const cats = Array.isArray(p.categories) ? (p.categories as unknown[]).map((c) => str(c && typeof c === "object" ? (c as Record<string, unknown>).name : c)).filter(Boolean) : [];
  const category = catPath.length ? catPath : cats.length ? cats : [str(p.category), str(p.subcategory)].filter(Boolean).length ? [str(p.category), str(p.subcategory)].filter(Boolean) : str(p.product_type ?? p.productType) ? [str(p.product_type ?? p.productType)] : [];

  const avail = bool(p.availableForSale ?? p.available ?? p.is_in_stock) ?? (variants.length ? variants.some((v) => v.available !== false) : null);
  const sku = str(p.sku) || variants.find((v) => v.sku)?.sku;
  return {
    url,
    handle: str(p.handle ?? p.slug) || handleOf(url),
    name,
    description,
    priceCents,
    compareAtCents,
    currency: str(p.currencyCode ?? p.currency ?? prices.currency_code) || "CAD",
    images: uniqImages(Array.isArray(p.images) ? p.images : p.image ? [p.image] : [], url),
    variants: variants.length > 1 || variants.some((v) => v.title) ? variants : [],
    category,
    available: avail,
    ...(sku ? { sku } : {}),
    ...(str(p.vendor) ? { vendor: str(p.vendor) } : {}),
    source,
  };
}

const metaOf = (html: string, prop: string): string => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0] ?? "";
  return stripHtml(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
};

/** A product from its page: structured data (JSON-LD Product) when the page has it, else its share tags. */
export function productFromHtml(html: string, url: string): SiteProduct | null {
  for (const m of String(html || "").matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const all = ([] as unknown[]).concat(data, ...(Array.isArray((data as Record<string, unknown>)?.["@graph"]) ? [(data as Record<string, unknown>)["@graph"]] : []));
    for (const node of all.flat()) {
      const n = node as Record<string, unknown>;
      const type = ([] as unknown[]).concat(n?.["@type"]);
      if (!type.includes("Product")) continue;
      const offers = ([] as unknown[]).concat(n.offers ?? []).flatMap((x) => ([] as unknown[]).concat((x as Record<string, unknown>)?.offers ?? x)) as Record<string, unknown>[];
      const price = offers.map((x) => toCents(x.price ?? x.lowPrice)).find((c) => c !== null) ?? null;
      const p = productFromJson({
        name: n.name, description: n.description, sku: n.sku, images: ([] as unknown[]).concat(n.image ?? []),
        price, currency: offers[0]?.priceCurrency,
        available: offers.length ? offers.some((x) => !/OutOfStock|Discontinued/i.test(str(x.availability))) : null,
      }, url, "jsonld");
      if (p) return { ...p, priceCents: price };
    }
  }
  const site = metaOf(html, "og:site_name");
  const raw = metaOf(html, "og:title") || stripHtml(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const title = genericTitle(raw, site) ? "" : raw;
  const image = metaOf(html, "og:image");
  if (!title) {
    // No name of its own (a draft: the site's page shows its generic title). Kept for its photo, marked unlisted.
    if (!image) return null;
    const img = bestImageUrl(image, url);
    return { url, handle: handleOf(url), name: { en: "", fa: "" }, description: { en: "", fa: "" }, priceCents: null, compareAtCents: null, currency: "CAD", images: img ? [img] : [], variants: [], category: [], available: null, source: "meta", unlisted: true };
  }
  const priceTag = metaOf(html, "product:price:amount") || metaOf(html, "og:price:amount");
  return productFromJson({
    name: title,
    description: metaOf(html, "og:description") || metaOf(html, "description"),
    images: image ? [image] : [],
    price: priceTag ? toCents(priceTag) : null,
    currency: metaOf(html, "product:price:currency") || metaOf(html, "og:price:currency"),
  }, url, "meta");
}

/**
 * A page title that names no product: the site's own name, or a word like "Product" with it
 * («Product | محصول | Shiraz Gallery Canada», what shirazgallery.ca shows for a draft).
 */
export function genericTitle(title: string, siteName = ""): boolean {
  const parts = String(title || "").split(/\s*[|·•—–-]\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const site = siteName.trim().toLowerCase();
  const generic = new Set(["product", "products", "shop", "store", "home", "untitled", "محصول", "محصولات", "فروشگاه", "خانه"]);
  if (!parts.length) return true;
  // The last part of a page title is usually the site's own name («… | Shiraz Gallery Canada»), tag or not.
  const named = parts.length > 1 ? parts.slice(0, -1) : parts;
  return named.every((x) => generic.has(x) || (site && x === site));
}

/** A product with its photos widened by the ones the sitemap lists for its page, main photo first. */
export function withSitemapImages(p: SiteProduct, images: string[]): SiteProduct {
  return { ...p, images: uniqImages([...p.images, ...images], p.url) };
}

// ── The result ────────────────────────────────────────────────────────────────

export type WebsiteFailure = { url: string; why: string };
export type WebsiteRun = {
  store: string;
  site: string;
  started: string;
  finished: string | null;
  running: boolean;
  /** What it is doing or did, in one sentence. */
  note: string;
  /** How the site was read (the strategy that answered). */
  method: string;
  robots: { disallow: string[]; sitemaps: string[] };
  /** A path robots.txt disallows that holds what is needed: the run stops and asks before reading it. */
  ask?: { path: string; why: string } | null;
  /** The operator's answer, kept with the result. */
  permission?: { readDisallowed: boolean; by: string; at: string } | null;
  endpoint?: string | null;
  found: number;
  done: string[];
  failures: WebsiteFailure[];
  products: SiteProduct[];
  /** The last time the products were put on the store's page (`website.ts` → `integrate`). */
  integrated?: { at: string; note: string; added: number; updated: number; gone: number } | null;
  /** The site's main photos and the address of our copy of each. */
  photos?: Record<string, string>;
  /** What the site gave at the last merge: tells the site's old words from the owner's (`websiteMerge.ts`). */
  merged?: SiteProduct[];
};

/** What the result is worth, for the page and the report: how many have a price, photos, a description. */
export function summarize(products: SiteProduct[]) {
  return {
    products: products.length,
    unlisted: products.filter((p) => p.unlisted).length,
    priced: products.filter((p) => p.priceCents !== null).length,
    onSale: products.filter((p) => p.compareAtCents !== null).length,
    photos: products.reduce((n, p) => n + p.images.length, 0),
    withoutPhoto: products.filter((p) => !p.images.length).length,
    described: products.filter((p) => p.description.en || p.description.fa).length,
    farsi: products.filter((p) => p.name.fa || p.description.fa).length,
    categories: [...new Set(products.map((p) => p.category[0]).filter(Boolean))].sort(),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // never read as a formula in Excel
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const money = (c: Money) => (c === null ? "" : (c / 100).toFixed(2));

/** The list as a spreadsheet (UTF-8 with a BOM, so Excel keeps the Farsi): the columns the bazaar's sheet reads, and more. */
export function toCsv(products: SiteProduct[]): string {
  const head = ["title_en", "title_fa", "unit price", "compare at price", "currency", "category", "photo", "more photos", "description_en", "description_fa", "variants", "available", "product no", "url"];
  const rows = products.map((p) => [
    p.name.en, p.name.fa, money(p.priceCents), money(p.compareAtCents), p.currency, p.category.join(" › "), p.images[0] ?? "", p.images.slice(1).join(" "),
    p.description.en, p.description.fa, p.variants.map((v) => `${v.title || "—"} ${money(v.priceCents)}`).join(" | "),
    p.available === null ? "" : p.available ? "yes" : "no", p.sku ?? "", p.url,
  ]);
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
