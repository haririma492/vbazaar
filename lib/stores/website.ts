// THE WEBSITE EXPLORER (owner, 2026-11-06): a store's own website read into a product list — names, prices,
// descriptions in both languages, the largest photos the site serves, sizes and their prices, the site's shelves.
// The rules are `websiteRules.ts` (tested); this is the server half. The result is `stores/<slug>/website.json`
// (masters bucket, private) and is shown at `/stores/<slug>/website`.
//
//   robots.txt ─► shop platform list? (Shopify /products.json · WooCommerce Store API) ── yes ─► done
//        │ no
//        ▼
//   sitemap(s) ─► product pages ─► first page's scripts: the JSON it asks for?
//        │                                  │ disallowed by robots.txt and not agreed → STOP and ask the operator
//        ▼                                  ▼
//   each page in turn (one request at a time, 0.4 s apart): that JSON, else JSON-LD, else share tags
//        └─► saved every 10 products, so a restart (or «Carry on») picks up where it stopped
//                     ▼
//   INTEGRATE (`integrate`, owner, 2026-11-06: "the same agent is responsible to integrate the result … to its
//   vbazaar page … so … 1) free tour 2) shelf tour benefit from all that is on the web site"):
//   each main photo copied into our bucket (1600 px, flattened on white) → merged into the store's product list
//   (`websiteMerge.ts`: added, or refreshed where the owner has not changed it) → the Tagger runs again on the
//   store's walk, so the products get their lights; both tours' product card reads the list.
//
// Free: no AI. Polite: one request at a time, a gap between them, our own User-Agent naming the bazaar, 20 s and
// 4 MB a request, one retry on a timeout or a 5xx. One run at a time per server.
import { createHash } from "node:crypto";
import { putSignImage, r2Config, readCatalogue, readMastersText, writeCatalogue, writeMastersJson } from "@/lib/splats/r2";
import { readStore, updateStore } from "./bucket";
import { setJob } from "./jobState";
import { run as runBin } from "./media";
import { redo, sceneOf, setStep } from "./store";
import { matchVideoToWebsite } from "./websiteMatch";
import { mergeIntoCatalogue } from "./websiteMerge";
import {
  fillEndpoint, findJsonEndpoints, handleOf, isDisallowed, parseRobots, parseSitemap, productFromHtml, productFromJson, productPages,
  withSitemapImages, type Robots, type SiteProduct, type SitemapEntry, type WebsiteRun,
} from "./websiteRules";

export const websiteKey = (slug: string) => `stores/${slug}/website.json`;
const UA = "VBazaarWebsiteExplorer/1.0 (+https://vbazaar.app; reads a store's own site for its place in the Virtual Bazaar)";
const GAP_MS = 400;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 5000; // a guard against a runaway sitemap, not a cap a store reaches
let busy: string | null = null;

export async function readWebsite(slug: string): Promise<WebsiteRun | null> {
  try { const t = await readMastersText(websiteKey(slug)); return t ? (JSON.parse(t) as WebsiteRun) : null; } catch { return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Got = { status: number; text: string; type: string } | { status: 0; text: ""; type: ""; error: string };

async function get(url: string, accept = "*/*"): Promise<Got> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const len = Number(res.headers.get("content-length") || 0);
      if (len > MAX_BYTES) return { status: 0, text: "", type: "", error: `bigger than ${MAX_BYTES / 1048576} MB` };
      const text = (await res.text()).slice(0, MAX_BYTES);
      if (res.status >= 500 && attempt === 0) { await sleep(2000); continue; }
      return { status: res.status, text, type: res.headers.get("content-type") || "" };
    } catch (e) {
      if (attempt === 0) { await sleep(2000); continue; }
      return { status: 0, text: "", type: "", error: (e as Error).message || "no answer" };
    }
  }
  return { status: 0, text: "", type: "", error: "no answer" };
}

const json = (g: Got): unknown => { if (g.status !== 200) return null; try { return JSON.parse(g.text); } catch { return null; } };

/** The store's site as an origin, or why not (an Instagram name is not a website). */
export function siteOf(website: string | undefined): { origin: string } | { error: string } {
  if (!website) return { error: "The store has no website on its details. Add it on /stores/<slug> (مشخصات فروشگاه)." };
  if (!/^https:\/\//.test(website)) return { error: `“${website}” is not a website (an Instagram name?). The explorer reads https:// sites.` };
  try { return { origin: new URL(website).origin }; } catch { return { error: `“${website}” is not an address.` }; }
}

/** Start (or carry on) reading the store's site, in the background (the page's key). The Website step is kept in step. */
export async function startWebsite(slug: string, opts: { readDisallowed?: boolean; fresh?: boolean; by?: string } = {}): Promise<{ started: boolean; note: string }> {
  if (busy) return { started: false, note: busy === slug ? "Already reading this store's site." : `Reading another store's site (${busy}); try again when it is done.` };
  const store = await readStore(slug);
  if (!store) return { started: false, note: "No such store." };
  if ("error" in siteOf(store.website)) return { started: false, note: (siteOf(store.website) as { error: string }).error };
  void exploreNow(slug, opts).then(async (run) => {
    // Read from the page: the crew's Website step says so too (unless the crew itself is running it).
    if (run && !run.ask) await updateStore(slug, (x) => (x.steps.website?.state === "working" ? null : setStep(x, "website", "done", run.note, new Date())));
  }).catch((e) => console.error("[website]", slug, e));
  return { started: true, note: "Reading the site…" };
}

/** Read the store's site now and wait for it (the crew's Website step): the run as it ended, or null. */
export async function exploreNow(slug: string, opts: { readDisallowed?: boolean; fresh?: boolean; by?: string } = {}, say?: (note: string) => Promise<void>): Promise<WebsiteRun | null> {
  while (busy && busy !== slug) await sleep(5000);
  if (busy === slug) { while (busy === slug) await sleep(3000); return readWebsite(slug); }
  const store = await readStore(slug);
  const site = siteOf(store?.website);
  if ("error" in site) throw new Error(site.error);
  busy = slug;
  try {
    await explore(slug, site.origin, opts, say);
  } catch (e) {
    console.error("[website]", slug, e);
    const run = await readWebsite(slug);
    if (run) await writeMastersJson(websiteKey(slug), { ...run, running: false, finished: new Date().toISOString(), note: `Stopped: ${(e as Error).message}` });
    throw e;
  } finally { busy = null; void setJob("website-explorer", { busy: false, key: null }); }
  return readWebsite(slug);
}

async function explore(slug: string, origin: string, opts: { readDisallowed?: boolean; fresh?: boolean; by?: string }, say?: (note: string) => Promise<void>) {
  const last = await readWebsite(slug);
  const prev = opts.fresh ? null : last;
  const now = () => new Date().toISOString();
  const run: WebsiteRun = prev && prev.site === origin ? { ...prev, running: true, finished: null, ask: null } : {
    store: slug, site: origin, started: now(), finished: null, running: true, note: "Reading robots.txt…", method: "",
    robots: { disallow: [], sitemaps: [] }, ask: null, permission: null, endpoint: null, found: 0, done: [], failures: [], products: [],
    // Read again from the start, the photo copies and the last merge are kept: the owner's changes stay theirs.
    // …and so is the operator's answer about robots.txt for this site.
    ...(last?.site === origin ? { photos: last.photos, merged: last.merged, integrated: last.integrated, permission: last.permission } : {}),
  };
  if (opts.readDisallowed !== undefined) run.permission = { readDisallowed: opts.readDisallowed, by: opts.by || "operator", at: now() };
  const save = async (note?: string) => { if (note) { run.note = note; if (say) await say(note).catch(() => undefined); } await writeMastersJson(websiteKey(slug), run); };
  await setJob("website-explorer", { busy: true, key: slug, note: origin });
  await save("Reading robots.txt…");

  // 1. robots.txt
  const rob = await get(`${origin}/robots.txt`, "text/plain");
  const robots: Robots = rob.status === 200 ? parseRobots(rob.text) : { disallow: [], allow: [], sitemaps: [] };
  run.robots = { disallow: robots.disallow, sitemaps: robots.sitemaps };
  const mayRead = (url: string) => { const u = new URL(url, origin); return !isDisallowed(u.pathname + u.search, robots) || run.permission?.readDisallowed === true; };

  // 2. A shop platform's own public list: everything in a few requests.
  if (!run.done.length && (await fromPlatform(origin, run, mayRead, save))) return finish(run, save);

  // 3. The sitemap's product pages.
  await save("Reading the sitemap…");
  const pages = await sitemapPages(origin, robots);
  run.found = pages.length;
  if (!pages.length) { run.method = "nothing found"; return finish(run, save, "No product list, and no product pages in the sitemap. Tell the operator: this site needs a closer look."); }

  // 4. The JSON the product page's own scripts ask for.
  if (run.endpoint === null || run.endpoint === undefined) run.endpoint = await discoverEndpoint(origin, pages[0].loc);
  if (run.endpoint) {
    const path = run.endpoint.split("{handle}")[0];
    if (isDisallowed(path, robots) && !run.permission?.readDisallowed) {
      if (run.permission?.readDisallowed === false) run.endpoint = ""; // asked, and the answer was no: the pages only
      else {
        run.ask = { path, why: `The prices and all the photos come from ${path}…, which this site's robots.txt asks robots not to read. Read it only if this is the store's own website and the store has agreed.` };
        run.running = false;
        return save(`Waiting for you: may the explorer read ${path}?`);
      }
    }
  }
  run.method = run.endpoint ? `sitemap → the site's own product JSON (${run.endpoint})` : "sitemap → each product page (structured data or share tags)";

  // 5. Each product, in turn; resumable.
  const done = new Set(run.done);
  const byUrl = new Map(run.products.map((p) => [p.url, p]));
  let since = 0;
  for (const [i, page] of pages.entries()) {
    if (done.has(page.loc)) continue;
    await save(`Reading product ${i + 1} of ${pages.length}…`).catch(() => undefined);
    const p = await readProduct(origin, page, run.endpoint || "", mayRead);
    if ("why" in p) run.failures = [...run.failures.filter((f) => f.url !== page.loc), { url: page.loc, why: p.why }];
    else { byUrl.set(page.loc, p); run.failures = run.failures.filter((f) => f.url !== page.loc); }
    done.add(page.loc);
    run.done = [...done];
    run.products = [...byUrl.values()];
    if (++since >= 10) { since = 0; await save(); }
    await sleep(GAP_MS);
  }
  return finish(run, save);
}

async function finish(run: WebsiteRun, save: (note?: string) => Promise<void>, note?: string) {
  const priced = run.products.filter((p) => p.priceCents !== null).length;
  const read = note ?? `Read ${run.products.length} products (${priced} with a price), ${run.products.reduce((n, p) => n + p.images.length, 0)} photos${run.failures.length ? `, ${run.failures.length} pages not read` : ""}.`;
  if (run.products.length) {
    await save(`${read} Putting them on the store's page…`);
    try { run.integrated = await integrate(run, (n) => save(`${read} ${n}`)); }
    catch (e) { run.integrated = { at: new Date().toISOString(), note: `Not put on the store's page: ${(e as Error).message}`, added: 0, updated: 0, gone: 0 }; }
  }
  run.running = false;
  run.finished = new Date().toISOString();
  await save(run.integrated ? `${read} ${run.integrated.note}` : read);
}

/** Our own copy of a site photo: one per picture (its address hashed), so a re-run copies only what is new. */
const photoKey = (slug: string, url: string) => `scenes/catalogues/${sceneOf(slug)}/web-${createHash("sha1").update(url).digest("hex").slice(0, 16)}.jpg`;

async function copyPhoto(url: string, key: string): Promise<boolean> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return false;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return false;
  // A transparent PNG would turn black as a JPEG: it is laid on white first.
  const jpeg = new Uint8Array(await runBin("ffmpeg", [
    "-v", "error", "-i", "pipe:0", "-frames:v", "1", "-filter_complex",
    "[0:v]scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease,format=rgba[fg];color=white:s=16x16[bg];[bg][fg]scale2ref[b][f];[b][f]overlay=format=auto,format=yuvj420p",
    "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
  ], { input: bytes }));
  await putSignImage(key, "image/jpeg", jpeg);
  return true;
}

/**
 * The site's products into the store's product list, and the store's walk tagged again with them. Runs at the end
 * of every read (and from the page's «Put on the store's page» key). The list replaced is kept
 * (`catalogues-history/`), so a merge can be undone.
 */
export async function integrate(run: WebsiteRun, say: (note: string) => Promise<void>): Promise<NonNullable<WebsiteRun["integrated"]>> {
  const slug = run.store;
  const base = r2Config().publicBase;
  const photos = { ...(run.photos ?? {}) };
  const wanted = [...new Set(run.products.map((p) => p.images[0]).filter((u): u is string => Boolean(u)))];
  let copied = 0, failed = 0;
  for (const [i, url] of wanted.entries()) {
    if (photos[url]) continue;
    if (i % 10 === 0) await say(`Copying photos: ${i + 1} of ${wanted.length}…`);
    const key = photoKey(slug, url);
    try { if (await copyPhoto(url, key)) { photos[url] = `${base}/${key}`; copied++; } else failed++; }
    catch (e) { console.error("[website] photo", url, e); failed++; }
    await sleep(150);
  }
  run.photos = photos;
  const store = sceneOf(slug);
  const before = await readCatalogue(store);
  const m = mergeIntoCatalogue(before?.products ?? [], run.products, run.merged ?? [], (u) => photos[u]);
  if (m.added || m.updated || !before) await writeCatalogue({ store, products: m.products });
  run.merged = run.products;
  // The products in the walk: the Tagger finds them again (it only runs once the store's walk is made).
  // The products found in the video get the site's facts (`websiteMatch.ts`); their lights stay.
  let matched = "";
  try { matched = await matchVideoToWebsite(slug, say); } catch (e) { matched = ` Matching to the video stopped: ${(e as Error).message}`; }
  const s = await readStore(slug);
  let tagged = "";
  // The Tagger again only when the list is not the video's own find (that one already pinned its products' lights).
  if (s?.out.walk && s.out.found !== s.out.walk && (m.added || m.updated)) {
    await updateStore(slug, (x) => redo(x, ["tag", "check"]));
    const { kick } = await import("./crew");
    kick();
    tagged = " The Tagger is finding them in the walk.";
  } else if (!s?.out.walk) tagged = " They get their lights in the tours once the store's walk is made.";
  const note = `On the store's page: ${m.added} added, ${m.updated} updated, ${m.unchanged} already there${m.gone ? `, ${m.gone} no longer on the site (kept)` : ""}${m.full ? ", the list is full (999)" : ""}; ${copied} photos copied${failed ? `, ${failed} could not be` : ""}.${matched}${tagged}`;
  return { at: new Date().toISOString(), note, added: m.added, updated: m.updated, gone: m.gone };
}

/** «Put on the store's page» again, without reading the site. */
export async function integrateAgain(slug: string): Promise<string> {
  if (busy) return "The explorer is busy; try again in a moment.";
  const run = await readWebsite(slug);
  if (!run?.products.length) return "Nothing read from the site yet.";
  busy = slug;
  try {
    run.integrated = await integrate(run, async () => undefined);
    await writeMastersJson(websiteKey(slug), run);
    return run.integrated.note;
  } finally { busy = null; }
}

async function fromPlatform(origin: string, run: WebsiteRun, mayRead: (u: string) => boolean, save: (n?: string) => Promise<void>): Promise<boolean> {
  // Shopify
  if (mayRead(`${origin}/products.json`)) {
    const all: SiteProduct[] = [];
    for (let page = 1; page <= 40; page++) {
      const d = json(await get(`${origin}/products.json?limit=250&page=${page}`, "application/json")) as { products?: unknown[] } | null;
      if (!d || !Array.isArray(d.products)) break;
      for (const raw of d.products) {
        const h = (raw as { handle?: string })?.handle;
        const p = productFromJson(raw, `${origin}/products/${h ?? ""}`, "shopify");
        if (p) all.push(p);
      }
      await save(`Reading the shop's product list (${all.length} so far)…`);
      if (d.products.length < 250) break;
      await sleep(GAP_MS);
    }
    if (all.length) { Object.assign(run, { method: "Shopify product list (/products.json)", products: all, found: all.length, done: all.map((p) => p.url) }); return true; }
  }
  // WooCommerce
  if (mayRead(`${origin}/wp-json/wc/store/v1/products`)) {
    const all: SiteProduct[] = [];
    for (let page = 1; page <= 100; page++) {
      const d = json(await get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, "application/json"));
      if (!Array.isArray(d) || !d.length) break;
      for (const raw of d) { const p = productFromJson(raw, String((raw as { permalink?: string }).permalink || origin), "woo"); if (p) all.push(p); }
      await save(`Reading the shop's product list (${all.length} so far)…`);
      if (d.length < 100) break;
      await sleep(GAP_MS);
    }
    if (all.length) { Object.assign(run, { method: "WooCommerce Store API", products: all, found: all.length, done: all.map((p) => p.url) }); return true; }
  }
  return false;
}

async function sitemapPages(origin: string, robots: Robots): Promise<SitemapEntry[]> {
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${origin}/sitemap.xml`];
  const seen = new Set<string>();
  const urls: SitemapEntry[] = [];
  while (queue.length && seen.size < 50) {
    const s = queue.shift()!;
    if (seen.has(s)) continue;
    seen.add(s);
    const g = await get(s, "application/xml");
    if (g.status !== 200) continue;
    const { urls: u, sitemaps } = parseSitemap(g.text);
    urls.push(...u.filter((x) => { try { return new URL(x.loc).origin === origin || new URL(x.loc).hostname.replace(/^www\./, "") === new URL(origin).hostname.replace(/^www\./, ""); } catch { return false; } }));
    queue.push(...sitemaps);
    if (urls.length > MAX_PAGES) break;
  }
  const byLoc = new Map(urls.map((u) => [u.loc.replace(/\/$/, ""), u]));
  return productPages([...byLoc.values()]).slice(0, MAX_PAGES);
}

/** The product JSON the first product page's scripts ask for, checked on that product; "" when there is none. */
async function discoverEndpoint(origin: string, pageUrl: string): Promise<string> {
  const page = await get(pageUrl, "text/html");
  if (page.status !== 200) return "";
  const scripts = [...new Set([...page.text.matchAll(/["'](\/_next\/static\/[^"'\\\s]+\.js|\/[^"'\\\s]*\.js)["']/g)].map((m) => m[1]))].slice(0, 40);
  const handle = handleOf(pageUrl);
  for (const src of scripts) {
    const js = await get(new URL(src, origin).toString(), "application/javascript");
    for (const template of findJsonEndpoints(js.text)) {
      const d = json(await get(`${origin}${fillEndpoint(template, handle)}`, "application/json"));
      if (d && productFromJson(d, pageUrl)) return template;
    }
  }
  return "";
}

async function readProduct(origin: string, page: SitemapEntry, endpoint: string, mayRead: (u: string) => boolean): Promise<SiteProduct | { why: string }> {
  let draft = false;
  if (endpoint) {
    const url = `${origin}${fillEndpoint(endpoint, handleOf(page.loc))}`;
    if (mayRead(url)) {
      const g = await get(url, "application/json");
      const d = json(g) as { success?: boolean; message?: string } | null;
      const p = productFromJson(d, page.loc);
      if (p) return withSitemapImages(p, page.images);
      // The site's own data says it has no such product (a draft still in its sitemap).
      draft = g.status === 404 || d?.success === false || /not found/i.test(String(d?.message ?? ""));
    }
  }
  if (!mayRead(page.loc)) return { why: "robots.txt asks robots not to read this page" };
  const g = await get(page.loc, "text/html");
  if (g.status !== 200) return { why: "error" in g ? g.error : `the site answered ${g.status}` };
  const p = productFromHtml(g.text, page.loc);
  if (!p) {
    // A draft whose page has no photo tag: its photos are still in the sitemap, and every photo is wanted.
    if (page.images.length) return withSitemapImages({
      url: page.loc, handle: handleOf(page.loc), name: { en: "", fa: "" }, description: { en: "", fa: "" }, priceCents: null, compareAtCents: null,
      currency: "CAD", images: [], variants: [], category: [], available: null, source: "meta", unlisted: true,
    }, page.images);
    return { why: "no product on the page" };
  }
  const out = withSitemapImages(p, page.images);
  return draft ? { ...out, unlisted: true, name: { en: "", fa: "" }, priceCents: null } : out;
}
