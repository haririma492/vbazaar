// TAKES DUPLICATE PHOTOS OFF THE STORE'S LIST (owner, 2026-11-23: "the dedup … duplicate product will reduce shopper's
// confidence"). After every website read and Google search: each web or Google photo is fingerprinted once (cached per
// address in `stores/<slug>/photo-hashes.json`), pictures that look the same are grouped, and every duplicate with no price
// is taken off the list (prices come later, with the owners). A priced product is never taken off. Rules: `photoDedupRules.ts`.
import { readCatalogue, readMastersText, writeCatalogue, writeMastersJson } from "@/lib/splats/r2";
import { run as runBin } from "./media";
import { sceneOf } from "./store";
import { dhashFromGray, groupDuplicates } from "./photoDedupRules";

const hashesKey = (slug: string) => `stores/${slug}/photo-hashes.json`;

async function hashOf(url: string): Promise<string | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gray = await runBin("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "pipe:1"], { input: bytes });
  return gray.length >= 72 ? dhashFromGray(gray) : null;
}

export async function dedupeStoreList(slug: string): Promise<{ removed: number; groups: number }> {
  const store = sceneOf(slug);
  const cat = await readCatalogue(store);
  if (!cat) return { removed: 0, groups: 0 };
  let cache: Record<string, string> = {};
  try { cache = JSON.parse((await readMastersText(hashesKey(slug))) ?? "{}"); } catch { cache = {}; }
  // Only pictures the website or Google gave us: the owner's own uploads are never compared or taken off.
  const sourced = cat.products.filter((p) => p.photo && p.web);
  let fresh = false;
  for (const url of new Set(sourced.map((p) => p.photo!))) {
    if (cache[url]) continue;
    const h = await hashOf(url).catch(() => null);
    if (h) { cache[url] = h; fresh = true; }
  }
  if (fresh) await writeMastersJson(hashesKey(slug), cache);

  const items = sourced.filter((p) => cache[p.photo!]).map((p) => ({ id: String(p.n), hash: cache[p.photo!] }));
  const groups = groupDuplicates(items, 5);
  const drop = new Set<string>();
  for (const g of groups) {
    for (const id of g.slice(1)) {
      const p = cat.products.find((x) => String(x.n) === id);
      // A website or Google item's name is the site's (or its page's), so it goes; only a priced one is kept.
      if (p && p.priceCents === null) drop.add(id);
    }
  }
  if (drop.size) {
    await writeCatalogue({ store, products: cat.products.filter((p) => !drop.has(String(p.n))) });
  }
  return { removed: drop.size, groups: groups.length };
}
