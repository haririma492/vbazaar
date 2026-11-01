/**
 * A STORE'S PRODUCT LIST — merchant on-boarding (founder, 2026-10-12).
 *
 * The merchant sends a sheet (.xlsx) of their products; we add a short
 * Sarekooche number to each row (1–999) — their own product numbers can run to
 * many digits, and typing those on a phone made tagging tedious. On the walk,
 * the operator taps a product and types only that number; name, unit, price
 * and photo come from here, so a new sheet updates every tag at once.
 *
 *   number | product no | title_fa | title_en | unit | unit price | photo
 *
 * Headers may be in English or Farsi, in any order. A product added by hand
 * on the walk joins the same list with the next free number (`by: "hand"`).
 *
 * Weighed goods (kg, g, lb — founder: "weight for sure, and lb, Iranian dry
 * nut stores sell like that") are bought by weight: the shopper picks how much
 * (`weightChoices`) and the basket line is that weight at its price.
 *
 * Stored per store as `scenes/catalogues/<store>.json` (`catalogueKey`); a
 * store's shelf videos are `scenes/<store>-shelf-<n>/…` (`storeOfScene`).
 *
 * Pure: imports nothing, so `node --test` runs it.
 */

export type Unit = "kg" | "g" | "lb" | "piece" | "set" | "box" | "pack";
export const UNITS: Unit[] = ["kg", "g", "lb", "piece", "set", "box", "pack"];
export const UNIT_SAY: Record<Unit, { en: string; fa: string }> = {
  kg: { en: "kg", fa: "کیلو" },
  g: { en: "g", fa: "گرم" },
  lb: { en: "lb", fa: "پوند" },
  piece: { en: "piece", fa: "عدد" },
  set: { en: "set", fa: "سِت" },
  box: { en: "box", fa: "جعبه" },
  pack: { en: "pack", fa: "بسته" },
};

export type Product = {
  /** The Sarekooche number, 1–999: what the operator types when tagging. */
  n: number;
  /** The merchant's own product number, kept for the order sent to the store. */
  sku?: string;
  en?: string;
  fa?: string;
  unit: Unit;
  /** Price of one `unit`, in cents; null when the sheet gives none. */
  priceCents: number | null;
  /** https link to its photo. */
  photo?: string;
  /** Added on the walk by hand («hand»), or found in the store's video by the crew («video»), not from the merchant's sheet. */
  by?: "hand" | "video";
  /** The owner's description, shown on the product's card (owner, 2026-11-01). */
  note?: string;
  /**
   * What the crew saw, for finding it again in a new video — NEVER shown
   * (owner, 2026-11-01: "do not add title for each product, let owner do
   * that"). A product found in the video has no name until its owner gives one.
   */
  seen?: string;
};

export type Catalogue = { store: string; products: Product[]; updated?: string };

export const MAX_NUMBER = 999;
export const STORE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const catalogueKey = (store: string) => `scenes/catalogues/${store}.json`;

/** The store a shelf video belongs to: `scenes/alis-market-shelf-03a/x.mp4` → `alis-market`; any other scene is its own store. */
export function storeOfScene(key: string): string {
  const scene = key.split("/")[1] ?? "";
  return scene.replace(/-shelf-[a-z0-9-]*$/, "") || scene;
}

/** A product's name in a language, falling back to the other. */
export const productName = (p: Product, lang: "fa" | "en") => (lang === "fa" ? p.fa || p.en : p.en || p.fa) || `#${p.n}`;

export const byWeight = (u: Unit) => u === "kg" || u === "g" || u === "lb";

/** What a shopper may choose for a weighed product, in its own unit. */
export function weightChoices(u: Unit): number[] {
  if (u === "kg") return [0.25, 0.5, 1, 1.5, 2, 3, 5];
  if (u === "lb") return [0.5, 1, 1.5, 2, 3, 5, 10];
  if (u === "g") return [5, 10, 25, 50, 100, 250, 500];
  return [1];
}

export const formatCents = (c: number) => `$${(c / 100).toFixed(2)}`;

/** The price of `amount` of the product (cents), or null without a price. */
export const priceOf = (p: Product, amount: number) => (p.priceCents === null ? null : Math.round(p.priceCents * amount));

/** «$4.99 / kg», «$3.49 each». */
export function unitPriceSay(p: Product, lang: "fa" | "en"): string {
  if (p.priceCents === null) return lang === "fa" ? "قیمت در فروشگاه" : "Price in store";
  const unit = p.unit === "piece" ? (lang === "fa" ? "عدد" : "each") : UNIT_SAY[p.unit][lang];
  return `${formatCents(p.priceCents)} / ${unit}`;
}

/** A unit as merchants write it, or null. */
export function readUnit(raw: unknown): Unit | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return null;
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms|کیلو|کیلوگرم|کیلوگرم)$/.test(s)) return "kg";
  if (/^(g|gr|grs|gram|grams|gm|گرم)$/.test(s)) return "g";
  if (/^(lb|lbs|pound|pounds|پوند)$/.test(s)) return "lb";
  if (/^(piece|pieces|pc|pcs|each|ea|unit|item|عدد|دانه|تک)$/.test(s)) return "piece";
  if (/^(set|sets|ست|سِت|دست)$/.test(s)) return "set";
  if (/^(box|boxes|case|جعبه|کارتن)$/.test(s)) return "box";
  if (/^(pack|packs|package|pkg|packet|bag|bottle|jar|can|بسته|پاکت|شیشه|قوطی)$/.test(s)) return "pack";
  return null;
}

/** «$4.99», «4.99», «4,99», «۴.۹۹» → cents, or null. */
export function readPrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  let s = "";
  for (const ch of String(raw ?? "")) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x06f0 && c <= 0x06f9) s += String(c - 0x06f0);
    else if (c >= 0x0660 && c <= 0x0669) s += String(c - 0x0660);
    else s += ch;
  }
  s = s.replace(/[$\s]|cad|usd/gi, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

const isHttps = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && Boolean(u.hostname) && v.length <= 600;
  } catch {
    return false;
  }
};

type Col = "n" | "sku" | "fa" | "en" | "unit" | "price" | "photo";

/** Which column a header names, or null. */
function headerOf(raw: string): Col | null {
  const h = raw.trim().toLowerCase();
  if (!h) return null;
  if (/price|قیمت|بها/.test(h)) return "price";
  if (/unit|واحد/.test(h)) return "unit";
  if (/photo|image|picture|pic|img|url|link|عکس|تصویر/.test(h)) return "photo";
  if (/(title|name|نام|عنوان).*(fa|farsi|persian|فارسی)|(fa|farsi|persian|فارسی).*(title|name|نام|عنوان)|^fa$|^farsi$|^فارسی$/.test(h)) return "fa";
  if (/(title|name|نام|عنوان).*(en|english|انگلیسی)|(en|english|انگلیسی).*(title|name|نام|عنوان)|^en$|^english$|^انگلیسی$/.test(h)) return "en";
  if (/sarekooche|سرکوچه|temp|tag|^#$|^n$|^no\.?$|^number$|^شماره$/.test(h)) return "n";
  if (/product|sku|code|item|barcode|کد|کالا/.test(h)) return "sku";
  if (/title|name|نام|عنوان/.test(h)) return "en";
  return null;
}

/**
 * The sheet's rows (as read, every cell a string) → products, and every
 * problem found, row by row. The header is the first row that names at least
 * a number and a title column. A row with a problem is left out and said.
 */
export function parseSheet(rows: string[][]): { products: Product[]; problems: string[] } {
  const problems: string[] = [];
  let headerAt = -1;
  let cols: Partial<Record<Col, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const found: Partial<Record<Col, number>> = {};
    rows[r].forEach((cell, i) => {
      const c = headerOf(String(cell ?? ""));
      if (c && found[c] === undefined) found[c] = i;
    });
    if (found.n !== undefined && (found.en !== undefined || found.fa !== undefined)) {
      headerAt = r;
      cols = found;
      break;
    }
  }
  if (headerAt < 0) {
    return { products: [], problems: ["No header row found: the sheet needs a «number» column (the Sarekooche number, 1–999) and a «title_fa» or «title_en» column."] };
  }
  for (const c of ["unit", "price"] as Col[]) if (cols[c] === undefined) problems.push(`No «${c === "price" ? "unit price" : c}» column: ${c === "unit" ? "every product is taken as sold by the piece" : "products will show «Price in store»"}.`);
  const products: Product[] = [];
  const seen = new Map<number, number>();
  const cell = (row: string[], c: Col) => (cols[c] === undefined ? "" : String(row[cols[c]!] ?? "").trim());
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => !String(v ?? "").trim())) continue;
    const line = `Row ${r + 1}`;
    const nRaw = cell(row, "n");
    const n = Number(nRaw);
    if (!nRaw) { problems.push(`${line}: no Sarekooche number — left out.`); continue; }
    if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) { problems.push(`${line}: «${nRaw}» is not a number from 1 to ${MAX_NUMBER} — left out.`); continue; }
    if (seen.has(n)) { problems.push(`${line}: number ${n} is already used on row ${seen.get(n)} — left out.`); continue; }
    const en = cell(row, "en"), fa = cell(row, "fa");
    if (!en && !fa) { problems.push(`${line} (#${n}): no title in Farsi or English — left out.`); continue; }
    const unitRaw = cell(row, "unit");
    let unit = readUnit(unitRaw);
    if (!unit) {
      if (unitRaw) problems.push(`${line} (#${n}): unit «${unitRaw}» is not one we know (kg, g, lb, piece, box, pack) — taken as «piece».`);
      unit = "piece";
    }
    const priceRaw = cell(row, "price");
    const priceCents = priceRaw ? readPrice(priceRaw) : null;
    if (priceRaw && priceCents === null) problems.push(`${line} (#${n}): price «${priceRaw}» could not be read — shown as «Price in store».`);
    const photoRaw = cell(row, "photo");
    if (photoRaw && !isHttps(photoRaw)) problems.push(`${line} (#${n}): the photo is not an https:// link — left without a photo.`);
    const sku = cell(row, "sku");
    seen.set(n, r + 1);
    products.push({
      n, unit, priceCents,
      ...(sku ? { sku: sku.slice(0, 40) } : {}),
      ...(en ? { en: en.slice(0, 120) } : {}),
      ...(fa ? { fa: fa.slice(0, 120) } : {}),
      ...(photoRaw && isHttps(photoRaw) ? { photo: photoRaw } : {}),
    });
  }
  products.sort((a, b) => a.n - b.n);
  return { products, problems };
}

/** The next free Sarekooche number (for a product added by hand), or null when all 999 are taken. */
export function nextNumber(c: Catalogue | null): number | null {
  const taken = new Set((c?.products ?? []).map((p) => p.n));
  for (let n = 1; n <= MAX_NUMBER; n++) if (!taken.has(n)) return n;
  return null;
}

/** A product by number. */
export const productOf = (c: Catalogue | null, n: number | undefined) => (n === undefined ? undefined : c?.products.find((p) => p.n === n));

/** A catalogue as read from a bucket or a browser: checked, problems said, unsound products dropped. */
export function checkCatalogue(raw: unknown): { catalogue: Catalogue | null; problems: string[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const store = typeof o.store === "string" ? o.store : "";
  if (!STORE_RE.test(store)) return { catalogue: null, problems: ["The store id must be lowercase letters, digits and hyphens."] };
  const problems: string[] = [];
  const products: Product[] = [];
  const seen = new Set<number>();
  for (const p of Array.isArray(o.products) ? o.products : []) {
    const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const n = x.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_NUMBER || seen.has(n)) { problems.push(`A product's number «${String(n)}» is missing, out of 1–${MAX_NUMBER} or used twice.`); continue; }
    const unit = UNITS.includes(x.unit as Unit) ? (x.unit as Unit) : null;
    const en = typeof x.en === "string" ? x.en.trim().slice(0, 120) : "";
    const fa = typeof x.fa === "string" ? x.fa.trim().slice(0, 120) : "";
    const by = x.by === "hand" || x.by === "video" ? x.by : undefined;
    // A product found in the video waits for its owner to name it; every other one has a title.
    if (!unit || (!en && !fa && by !== "video")) { problems.push(`Product #${n} needs a title and a unit.`); continue; }
    const price = x.priceCents === null || x.priceCents === undefined ? null : typeof x.priceCents === "number" && Number.isInteger(x.priceCents) && x.priceCents >= 0 ? x.priceCents : NaN;
    if (Number.isNaN(price)) { problems.push(`Product #${n}: its price must be whole cents.`); continue; }
    const photo = typeof x.photo === "string" && isHttps(x.photo) ? x.photo : "";
    const sku = typeof x.sku === "string" ? x.sku.trim().slice(0, 40) : "";
    const note = typeof x.note === "string" ? x.note.trim().slice(0, 600) : "";
    const sawAs = typeof x.seen === "string" ? x.seen.trim().slice(0, 160) : "";
    seen.add(n);
    products.push({
      n, unit, priceCents: price as number | null, ...(sku ? { sku } : {}), ...(en ? { en } : {}), ...(fa ? { fa } : {}), ...(photo ? { photo } : {}),
      ...(by ? { by } : {}), ...(note ? { note } : {}), ...(sawAs ? { seen: sawAs } : {}),
    });
  }
  products.sort((a, b) => a.n - b.n);
  return { catalogue: { store, products, ...(typeof o.updated === "string" ? { updated: o.updated } : {}) }, problems };
}

/**
 * A STORE'S AISLES — its shelf videos in order (founder, 2026-10-12: "map
 * later, simple next previous now"): every `scenes/<store>-shelf-<id>/….mp4`,
 * by shelf (`2` before `10`, `3a` before `3b`), leaving out phone copies.
 */
export type Aisle = { key: string; shelf: string };
export function aislesOf(keys: string[], store: string): Aisle[] {
  const re = new RegExp(`^scenes/${store.replace(/[-]/g, "\\-")}-shelf-([a-z0-9-]+)/[^/]+\\.mp4$`, "i");
  const out: Aisle[] = [];
  for (const key of keys) {
    const m = re.exec(key);
    if (m && !/-phone\.mp4$/i.test(key)) out.push({ key, shelf: m[1] });
  }
  const num = (s: string) => Number(/^\d+/.exec(s)?.[0] ?? Infinity);
  return out.sort((a, b) => num(a.shelf) - num(b.shelf) || a.shelf.localeCompare(b.shelf) || a.key.localeCompare(b.key));
}
