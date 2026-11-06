import { test } from "node:test";
import assert from "node:assert/strict";
import type { Product } from "@/lib/splats/catalogue";
import { applyMatches, joinProduct, shortlist } from "./websiteMatchRules";

// ShirazGallery, 2026-11-06: products the crew found in the walk, and the website's.
const video: Product[] = [
  { n: 3, unit: "piece", priceCents: null, by: "video", seen: "Stainless steel stock pots", photo: "https://m/p3.jpg" },
  { n: 1, unit: "piece", priceCents: null, by: "video", seen: "Grey wok with cream rim and glass lid", photo: "https://m/p1.jpg" },
];
const site: Product[] = [
  { n: 140, unit: "piece", priceCents: 8500, by: "website", web: "https://s.ca/product/stainless-steel-pot-24-cm", en: "Stainless Steel Stockpot for Everyday Cooking", note: "24 cm stockpot…", photo: "https://m/web-a.jpg", more: ["https://cdn/b.png"] },
  { n: 141, unit: "piece", priceCents: 6500, by: "website", web: "https://s.ca/product/granite-wok", en: "Granite Nonstick Wok with Glass Lid", photo: "https://m/web-c.jpg" },
  { n: 142, unit: "piece", priceCents: 3000, by: "website", web: "https://s.ca/product/teapot", en: "Glass Teapot", photo: "https://m/web-d.jpg" },
];

test("the shortlist: website products sharing words with what the finder saw, best first", () => {
  assert.equal(shortlist(video[0], site)[0].n, 140);
  // "stock pots" meets "Stockpot": a word inside another counts.
  assert.equal(shortlist({ n: 9, unit: "piece", priceCents: null, by: "video", seen: "Large stock pots" }, [site[2], { ...site[0], en: "Stockpot 24 cm", note: "" }])[0].n, 140);
  // A word most products carry counts for less than a telling one.
  const many = Array.from({ length: 6 }, (_, i) => ({ n: 200 + i, unit: "piece" as const, priceCents: 100, by: "website" as const, web: `w${i}`, en: `Stainless Steel Spoon ${i}` }));
  assert.equal(shortlist({ n: 9, unit: "piece", priceCents: null, by: "video", seen: "Stainless steel wok" }, [...many, site[1]])[0].n, 141);
  assert.deepEqual(shortlist(video[1], site).map((p) => p.n), [141, 142]); // the teapot shares "glass": the picture decides
  assert.deepEqual(shortlist({ n: 9, unit: "piece", priceCents: null, by: "video", seen: "" }, site), []);
});

test("a match: the video product keeps its number (its lights) and gets the site's name, price, description and photos", () => {
  const j = joinProduct(video[0], site[0]);
  assert.equal(j.n, 3);
  assert.equal(j.by, "video");
  assert.equal(j.en, "Stainless Steel Stockpot for Everyday Cooking");
  assert.equal(j.priceCents, 8500);
  assert.equal(j.web, site[0].web);
  assert.equal(j.photo, "https://m/web-a.jpg");
  assert.deepEqual(j.more, ["https://m/p3.jpg", "https://cdn/b.png"]); // the video's own cut stays, after the store's photo
  // A price or name the owner gave is theirs.
  assert.equal(joinProduct({ ...video[0], priceCents: 7999, en: "Big pot" }, site[0]).priceCents, 7999);
});

test("the matched website product leaves the list; an unmatched one and one with lights stay", () => {
  const r = applyMatches([...video, ...site], new Map([[3, 140], [1, 141]]), new Set([3, 1, 141]));
  assert.equal(r.joined, 2);
  assert.equal(r.folded, 1);
  assert.deepEqual(r.products.map((p) => p.n).sort((a, b) => a - b), [1, 3, 141, 142]);
});
