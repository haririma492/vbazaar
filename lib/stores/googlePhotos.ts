// THE GOOGLE PHOTO EXPLORER, the server half (owner, 2026-11-23: a Google photo explorer alongside the Website
// Explorer, "bring them all in all photos"). The rules are `googlePhotosRules.ts` (tested).
//
// For each product of the store's list that has a name, and for the store itself (its name and street), it asks
// Google's image search (Custom Search JSON API, `searchType=image`), keeps the best few usable pictures, copies each
// into our bucket (`website.ts`'s `copyPhoto`: 1600 px, on white) and puts the copies on the product as `google`.
// The result is `stores/<slug>/google-photos.json` (masters bucket, private); a product already searched is not
// searched again unless the operator asks for a fresh run.
//
// SET UP ONCE (on Railway, the v-bazzar service): `GOOGLE_CSE_KEY` (an API key with the Custom Search JSON API on)
// and `GOOGLE_CSE_CX` (a Programmable Search Engine set to search the whole web, with image search on). Without them
// the explorer says so and does nothing. Free up to 100 searches a day, then $5 per 1,000; each run spends at most
// `QUERY_CAP` searches. Not yet run against the live API when this was written: the first run is the check.
//
// Not a bulk crawl of Google: one question per product, a pause between them, and the operator starts it.
import { createHash } from "node:crypto";
import { r2Config, readCatalogue, readMastersText, writeCatalogue, writeMastersJson } from "@/lib/splats/r2";
import type { Product } from "@/lib/splats/catalogue";
import { readStore } from "./bucket";
import { sceneOf } from "./store";
import { copyPhoto, readWebsite } from "./website";
import {
  emptyGoogleRun, hostOf, PER_PRODUCT, PER_STORE, pickPhotos, QUERY_CAP, storeQuery, summaryNote, toSearch,
  type CseItem, type GoogleRun, type GoogleRunEntry,
} from "./googlePhotosRules";

export const googleKey = (slug: string) => `stores/${slug}/google-photos.json`;
const GAP_MS = 300;
const TIMEOUT_MS = 20_000;
let busy: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Are the Custom Search key and engine id set? */
export const googleConfigured = () => Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX);

export async function readGoogle(slug: string): Promise<GoogleRun | null> {
  try { const t = await readMastersText(googleKey(slug)); return t ? (JSON.parse(t) as GoogleRun) : null; } catch { return null; }
}

/** One question to Google's image search. Throws with the reason when the answer is not usable. */
export async function searchImages(q: string): Promise<CseItem[]> {
  const params = new URLSearchParams({
    key: process.env.GOOGLE_CSE_KEY || "", cx: process.env.GOOGLE_CSE_CX || "", q, searchType: "image", num: "10", safe: "active",
  });
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({}))) as { items?: CseItem[]; error?: { message?: string } };
  if (res.status === 429) throw new Error("Google's daily search limit is used up (100 a day on the free plan). Try again tomorrow, or raise the quota.");
  if (!res.ok) throw new Error(`Google answered ${res.status}: ${body.error?.message ?? "no reason given"}`);
  return Array.isArray(body.items) ? body.items : [];
}

/** Copy the picked pictures into our bucket; their addresses, the ones that worked. */
async function keep(slug: string, links: string[]): Promise<string[]> {
  const base = r2Config().publicBase;
  const out: string[] = [];
  for (const url of links) {
    const key = `scenes/catalogues/${sceneOf(slug)}/g-${createHash("sha1").update(url).digest("hex").slice(0, 16)}.jpg`;
    try { if (await copyPhoto(url, key)) out.push(`${base}/${key}`); } catch (e) { console.error("[google] copy", url, (e as Error).message); }
  }
  return out;
}

/** Start (or carry on) the Google search for the store, in the background. */
export async function startGooglePhotos(slug: string, opts: { fresh?: boolean } = {}): Promise<{ started: boolean; note: string }> {
  if (!googleConfigured()) return { started: false, note: "Not set up yet: GOOGLE_CSE_KEY and GOOGLE_CSE_CX are not set on the server (see lib/stores/googlePhotos.ts)." };
  if (busy) return { started: false, note: busy === slug ? "Already searching Google for this store." : `Searching for another store (${busy}); try again when it is done.` };
  const site = await readWebsite(slug).catch(() => null);
  if (site?.running) return { started: false, note: "The Website Explorer is reading this store's site right now. Start the Google search when it is done, so the two do not write the list at once." };
  if (!(await readStore(slug))) return { started: false, note: "No such store." };
  void runGoogle(slug, opts).catch((e) => console.error("[google]", slug, e));
  return { started: true, note: "Searching Google for the store's products…" };
}

async function runGoogle(slug: string, opts: { fresh?: boolean }) {
  busy = slug;
  const now = () => new Date().toISOString();
  try {
    const store = await readStore(slug);
    const storeName = store?.name.en || store?.name.fa || slug;
    const cat = await readCatalogue(sceneOf(slug));
    const prev = await readGoogle(slug);
    const run: GoogleRun = opts.fresh || !prev ? { ...emptyGoogleRun(slug) } : { ...prev, products: { ...prev.products } };
    run.store = slug;
    run.running = true;
    run.started = now();
    run.finished = null;
    run.queries = 0;
    run.note = "Searching Google…";
    const save = async (note?: string) => { if (note) run.note = note; await writeMastersJson(googleKey(slug), run); };
    await save();

    const ownHost = hostOf(store?.website);
    const products = cat?.products ?? [];
    const todo = toSearch(products, { ...run, store: storeName }, Boolean(opts.fresh));
    const wantStore = opts.fresh || !run.store_photos;
    const budget = QUERY_CAP - (wantStore ? 1 : 0);
    let stopped = "";

    for (const [i, { n, q }] of todo.entries()) {
      if (run.queries >= budget) { stopped = ` Stopped at the search cap (${QUERY_CAP} a run); the rest on the next run.`; break; }
      if (i % 5 === 0) await save(`Searching Google: ${i + 1} of ${todo.length}…`);
      try {
        const items = await searchImages(q);
        run.queries++;
        const picks = pickPhotos(items, PER_PRODUCT, ownHost);
        const entry: GoogleRunEntry = { q, photos: await keep(slug, picks), at: now(), found: items.length };
        run.products[String(n)] = entry;
      } catch (e) {
        const why = (e as Error).message;
        run.queries++;
        if (/limit/.test(why)) { stopped = ` ${why}`; break; }
        // Not recorded as searched: the next run asks again (a network hiccup must not lose the product its photos).
        console.error("[google] search", n, why);
      }
      await sleep(GAP_MS);
    }

    if (wantStore && !stopped && store) {
      const q = storeQuery(storeName, store.address);
      if (q) {
        try {
          const items = await searchImages(q);
          run.queries++;
          run.store_photos = { q, photos: await keep(slug, pickPhotos(items, PER_STORE, ownHost)), at: now(), found: items.length };
        } catch (e) { run.queries++; stopped = ` The store's own photos: ${(e as Error).message}`; }
      }
    }

    // The copies go on the products (their `google` field); a product whose answer is empty loses nothing it had.
    const fresh = await readCatalogue(sceneOf(slug));
    if (fresh) {
      const products2: Product[] = fresh.products.map((p) => {
        const got = run.products[String(p.n)]?.photos ?? [];
        const rest = { ...p };
        delete rest.google;
        return got.length ? { ...rest, google: got } : rest;
      });
      await writeCatalogue({ store: sceneOf(slug), products: products2 });
    }
    run.running = false;
    run.finished = now();
    await save(summaryNote(run) + stopped);
  } catch (e) {
    const prev = await readGoogle(slug);
    await writeMastersJson(googleKey(slug), { ...(prev ?? emptyGoogleRun(slug)), running: false, finished: now(), note: `Stopped: ${(e as Error).message}` });
    throw e;
  } finally { busy = null; }
}
