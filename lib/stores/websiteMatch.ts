// THE WEBSITE'S FACTS ON THE PRODUCTS FOUND IN THE VIDEO (owner, 2026-11-06: "for any new store or when re-doing it
// all add the website info synergy to virtual store"). Each product the crew found in the walk (lights, a photo cut
// from the video, no name) is matched to the store's website product it is (`websiteMatchRules.ts`: a word shortlist;
// `ai.ts` `sameProduct`: Claude Haiku compares the video's photo with each candidate's) and given its name, price,
// description and the store's photos. Its lights stay; the website product it matched leaves the list. Verdicts are
// kept (`stores/<slug>/website-match.json`), so a product is asked about once; a new video's products when they appear.
//
// Paid from the store's AI budget (Haiku: a small fraction of a cent a product). The end of the Website step.
import { readCatalogue, readMastersText, readWalks, writeCatalogue, writeMastersJson } from "@/lib/splats/r2";
import { readStore, updateStore } from "./bucket";
import { BUDGET_CENTS, sceneOf } from "./store";
import { OverBudget, sameProduct, type Purse } from "./ai";
import { jpegOf } from "./media";
import { MATCH_SURE, applyMatches, shortlist } from "./websiteMatchRules";

type Verdict = { into: number | null; web: string | null; confidence: number; why: string; at: string };
const memoKey = (slug: string) => `stores/${slug}/website-match.json`;

async function bytesOf(url: string | undefined, px: number): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await jpegOf(new Uint8Array(await res.arrayBuffer()), px);
  } catch { return null; }
}

function purse(slug: string, spentAtStart: number): Purse {
  let spent = spentAtStart;
  return {
    spent: () => spent,
    limit: BUDGET_CENTS,
    add: async (cents) => { spent += cents; await updateStore(slug, (x) => ({ ...x, spentCents: Math.round((x.spentCents + cents) * 100) / 100 })); },
  };
}

export async function matchVideoToWebsite(slug: string, say: (note: string) => Promise<void> = async () => undefined): Promise<string> {
  const store = sceneOf(slug);
  const c = await readCatalogue(store);
  if (!c) return "";
  const site = c.products.filter((p) => p.by === "website" && p.web);
  const video = c.products.filter((p) => p.by === "video" && !p.web && p.photo);
  if (!site.length || !video.length) return "";
  const s = await readStore(slug);
  if (!s) return "";
  const wallet = purse(slug, s.spentCents);
  let memo: Record<string, Verdict> = {};
  try { const t = await readMastersText(memoKey(slug)); memo = t ? JSON.parse(t) : {}; } catch { /* from the start */ }

  const matches = new Map<number, number>();
  let asked = 0, stopped = "";
  for (const [i, v] of video.entries()) {
    const had = memo[String(v.n)];
    if (had) {
      const target = had.web ? site.find((p) => p.web === had.web) : undefined;
      if (target) matches.set(v.n, target.n);
      continue;
    }
    const cands = shortlist(v, site, 8);
    if (!cands.length) { memo[String(v.n)] = { into: null, web: null, confidence: 0, why: "no website product shares a word with it", at: new Date().toISOString() }; continue; }
    if (i % 10 === 0) await say(`Matching the video's products to the website's: ${i + 1} of ${video.length}…`);
    const seen = await bytesOf(v.photo, 512);
    if (!seen) continue;
    try {
      const photos = await Promise.all(cands.map((p) => bytesOf(p.photo, 320)));
      const r = await sameProduct(wallet, { jpeg: seen, looks: v.seen ?? "" }, cands.map((p, k) => ({ jpeg: photos[k], name: p.en || p.fa || `#${p.n}`, price: p.priceCents === null ? "" : `$${(p.priceCents / 100).toFixed(2)}` })));
      asked++;
      const pick = r.choice !== null && r.confidence >= MATCH_SURE ? cands[r.choice - 1] : null;
      memo[String(v.n)] = { into: pick?.n ?? null, web: pick?.web ?? null, confidence: r.confidence, why: r.why, at: new Date().toISOString() };
      if (pick) matches.set(v.n, pick.n);
    } catch (e) {
      if (e instanceof OverBudget) { stopped = " Stopped: the store's AI budget is used up."; break; }
      console.error("[website] match", slug, v.n, e);
    }
    if (asked && asked % 20 === 0) await writeMastersJson(memoKey(slug), memo);
  }
  await writeMastersJson(memoKey(slug), memo);
  if (!matches.size) return ` No product found in the video matched a website product (${asked} compared).${stopped}`;

  const now = await readCatalogue(store);
  if (!now) return "";
  const walk = s.out.walk ? (await readWalks().catch(() => null))?.walks[s.out.walk] : undefined;
  const lit = new Set<number>((walk?.items ?? []).map((it) => Number(it.n)).filter((n) => Number.isInteger(n)));
  const r = applyMatches(now.products, matches, lit);
  await writeCatalogue({ ...now, products: r.products });
  const unseen = r.products.filter((p) => p.by === "website").length;
  return ` ${r.joined} products found in the video now carry the website's name, price, description and photos (${asked} compared this time); ${unseen} website products were not matched to the video.${stopped}`;
}
