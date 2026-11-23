// THE GOOGLE PHOTO EXPLORER'S RULES (owner, 2026-11-23: "in addition to Website explorer also add a Google … photo
// explorer and bring them all in all photos"). Pure: imports nothing, so `node --test` runs it.
//
// The server half is `googlePhotos.ts`. It asks Google's image search (Custom Search JSON API, `searchType=image`)
// for each product of the store and for the store itself, and keeps the best few answers. Those are copied into our
// bucket (`website.ts`'s copy: 1600 px, on white) and put on the product as `google`, beside the website's photos, so
// the product card, the tray panel and the Shelf Tour show all of them. A website re-merge rewrites `more`, never
// `google`, so the two sources never overwrite each other.
//
// Costs and limits: Custom Search is free for 100 queries a day, then $5 per 1,000. Each run spends at most
// `QUERY_CAP` queries; a product already searched is not searched again unless the operator asks for a fresh run.

export const QUERY_CAP = 90;
/** Photos kept for one product, and for the store. */
export const PER_PRODUCT = 3;
export const PER_STORE = 8;
/** Smaller than this and the picture will not zoom well on a shelf card. */
export const MIN_WIDTH = 600;
/** The picture types we keep. */
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

/** One answer of the Custom Search JSON API (only what we read). */
export type CseItem = {
  link?: string;
  mime?: string;
  displayLink?: string;
  image?: { width?: number; height?: number; contextLink?: string };
};

export type GoogleRunEntry = { q: string; photos: string[]; at: string; found: number };
export type GoogleRun = {
  store: string;
  running: boolean;
  /** What it is doing or did, in one sentence. */
  note: string;
  /** When it was last started and finished. */
  started: string | null;
  finished: string | null;
  /** Searches spent in the last run. */
  queries: number;
  /** Per product number: the query and our copies of its photos. */
  products: Record<string, GoogleRunEntry>;
  /** The store's own photos (its name and address). */
  store_photos: GoogleRunEntry | null;
};

export const emptyGoogleRun = (store: string): GoogleRun => ({
  store, running: false, note: "", started: null, finished: null, queries: 0, products: {}, store_photos: null,
});

const clean = (s: string | undefined) => String(s || "").replace(/\s+/g, " ").trim();

/** The search for one product: its English name in quotes (the exact title), then the store's name, so the answers are
 *  that store's product. No English name: the Farsi name, else nothing to search. */
export function productQuery(storeName: string, product: { en?: string; fa?: string }): string {
  const name = clean(product.en) || clean(product.fa);
  if (!name) return "";
  const shop = clean(storeName);
  return clean(`"${name.replace(/"/g, "")}" ${shop}`);
}

/** The search for the store itself: its name and its address (the street, not the whole address). */
export function storeQuery(storeName: string, address: string): string {
  const street = clean(address).split(",")[0] ?? "";
  return clean(`${storeName} ${street}`);
}

/** Is this link a picture worth keeping? Https, a usable type, big enough, not an image of the store's own site. */
export function usable(item: CseItem, ownHost: string): boolean {
  const link = clean(item.link);
  if (!/^https:\/\//i.test(link) || /\.svg(\?|$)/i.test(link)) return false;
  const mime = clean(item.mime).toLowerCase();
  if (mime && !ALLOWED_MIME.includes(mime)) return false;
  const width = Number(item.image?.width ?? 0);
  if (width && width < MIN_WIDTH) return false;
  if (!width && !mime) return false; // nothing says what it is
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    if (ownHost && host === ownHost.replace(/^www\./, "")) return false;
  } catch { return false; }
  return true;
}

/** The best `max` links of an answer, in its order: usable only, no repeats. */
export function pickPhotos(items: CseItem[], max: number, ownHost = ""): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (out.length >= max) break;
    if (!usable(it, ownHost)) continue;
    const link = clean(it.link);
    if (!out.includes(link)) out.push(link);
  }
  return out;
}

/** The host of the store's own website, for `pickPhotos` (its photos are the website explorer's). */
export function hostOf(website: string | undefined): string {
  try { return website ? new URL(website).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}

/** Every photo a product shows, in order: the main photo, the website's, then Google's — each once, at most 12. */
export function photosOf(p: { photo?: string; more?: string[]; google?: string[] }): string[] {
  return [...new Set([p.photo, ...(p.more ?? []), ...(p.google ?? [])].filter((u): u is string => Boolean(u)))].slice(0, 12);
}

/** A product still to search: it has a name, and no answer from an earlier run (unless `fresh`). */
export function toSearch(products: { n: number; en?: string; fa?: string }[], run: GoogleRun | null, fresh: boolean): { n: number; q: string }[] {
  const out: { n: number; q: string }[] = [];
  for (const p of products) {
    const q = productQuery(run?.store ?? "", p);
    if (!q) continue;
    if (!fresh && run?.products[String(p.n)]) continue;
    out.push({ n: p.n, q });
  }
  return out;
}

/** The note the page shows, from the run's counts. */
export function summaryNote(run: GoogleRun): string {
  const entries = Object.values(run.products);
  const withPhotos = entries.filter((e) => e.photos.length).length;
  const photos = entries.reduce((n, e) => n + e.photos.length, 0);
  const store = run.store_photos?.photos.length ?? 0;
  const storeLine = `${store} ${store === 1 ? "photo" : "photos"} of the store`;
  return `${withPhotos} of ${entries.length} searched products have Google photos (${photos} in all); ${storeLine}. ${run.queries} searches this run.`;
}
