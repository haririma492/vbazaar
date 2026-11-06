// WHICH WEBSITE PRODUCT A PRODUCT FOUND IN THE VIDEO IS (owner, 2026-11-06: "for any new store or when re-doing it
// all add the website info synergy to virtual store"). Pure: imports only types, so `node --test` runs it.
//
// The crew finds products in the walk (`by: "video"`: a photo cut from the video, what it looked like, lights in the
// walk, no name or price). The Website Explorer reads the same products off the store's site (`by: "website"`: name,
// price, description, the store's photos, no lights). Joined, each product has both. A shortlist by words comes
// first (here), then Claude compares the pictures (`websiteMatch.ts`).
import type { Product } from "@/lib/splats/catalogue";

const STOP = new Set(["the", "a", "an", "and", "with", "of", "for", "in", "on", "set", "pcs", "piece", "pieces", "cm", "l", "ml", "everyday", "cooking", "design", "style", "product"]);
export const words = (s: string | undefined) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(es|s)$/, ""));

/** Up to `k` website products whose name or note shares the most words with what the finder saw, best first. */
export function shortlist(video: Product, site: Product[], k = 10): Product[] {
  const want = new Set(words(`${video.seen ?? ""} ${video.en ?? ""}`));
  if (!want.size) return [];
  const scored = site.map((p) => {
    const have = new Set(words(`${p.en ?? ""} ${p.fa ?? ""} ${(p.note ?? "").slice(0, 200)}`));
    let score = 0;
    for (const w of want) if (have.has(w)) score++;
    return { p, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.p.n - b.p.n);
  return scored.slice(0, k).map((x) => x.p);
}

/** The video product with the site's facts: name, price and description where it has none, the store's photos. */
export function joinProduct(video: Product, site: Product): Product {
  const more = [...new Set([...(video.photo ? [video.photo] : []), ...(site.more ?? [])])].filter((u) => u !== site.photo).slice(0, 8);
  return {
    ...video,
    en: video.en || site.en,
    fa: video.fa || site.fa,
    priceCents: video.priceCents ?? site.priceCents,
    note: video.note || site.note,
    sku: video.sku || site.sku,
    web: site.web,
    ...(site.photo ? { photo: site.photo } : {}),
    ...(more.length ? { more } : {}),
  };
}

export const MATCH_SURE = 0.75;

/**
 * The list with every match applied: each matched video product carries the site's facts, and the website product it
 * matched leaves the list (it was ours, with no lights; the video product is now that product). A website product
 * with lights in the walk stays.
 */
export function applyMatches(products: Product[], matches: Map<number, number>, lit: Set<number>): { products: Product[]; joined: number; folded: number } {
  const byN = new Map(products.map((p) => [p.n, p]));
  const used = new Set<number>();
  let joined = 0;
  const out = products.map((p) => {
    const into = matches.get(p.n);
    const site = into === undefined ? undefined : byN.get(into);
    if (!site || p.by !== "video") return p;
    used.add(site.n);
    joined++;
    return joinProduct(p, site);
  });
  const fold = (p: Product) => used.has(p.n) && p.by === "website" && !lit.has(p.n);
  return { products: out.filter((p) => !fold(p)), joined, folded: out.filter(fold).length };
}
