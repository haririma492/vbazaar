import { test } from "node:test";
import assert from "node:assert/strict";
import type { Product } from "@/lib/splats/catalogue";
import { fieldsOf, mergeIntoCatalogue, MAX_NOTE } from "./websiteMerge";
import type { SiteProduct } from "./websiteRules";

const site = (url: string, over: Partial<SiteProduct> = {}): SiteProduct => ({
  url, handle: url.split("/").pop()!, name: { en: "Glass Teapot", fa: "" }, description: { en: "A clear glass teapot.", fa: "قوری شیشه‌ای شفاف با صافی استیل" },
  priceCents: 4500, compareAtCents: null, currency: "CAD", images: ["https://cdn.shopify.com/a.png", "https://cdn.shopify.com/b.png"], variants: [],
  category: ["Teapots"], available: true, source: "json", ...over,
});
const photo = (u: string) => `https://media.vbazaar.app/copy/${u.split("/").pop()}`;

test("a new product from the site joins the list with the next free number, its own photo first and the rest after", () => {
  const had: Product[] = [{ n: 1, unit: "piece", priceCents: 100, en: "Kettle", by: "hand" }, { n: 3, unit: "piece", priceCents: null, by: "video", seen: "a pot" }];
  const m = mergeIntoCatalogue(had, [site("https://s.ca/product/teapot")], [], photo);
  assert.equal(m.added, 1);
  const p = m.products.find((x) => x.by === "website")!;
  assert.equal(p.n, 2);
  assert.equal(p.priceCents, 4500);
  assert.equal(p.photo, "https://media.vbazaar.app/copy/a.png");
  assert.deepEqual(p.more, ["https://cdn.shopify.com/b.png"]);
  assert.equal(p.web, "https://s.ca/product/teapot");
  assert.ok(p.note!.includes("A clear glass teapot.") && p.note!.includes("قوری"));
  assert.equal(m.products.length, 3); // the video's product stays: the owner decides
});

test("the owner's changes are theirs; the site's old words are refreshed", () => {
  const url = "https://s.ca/product/teapot";
  const first = mergeIntoCatalogue([], [site(url)], [], photo).products;
  const owned = first.map((p) => ({ ...p, priceCents: 3999 })); // the owner set the vbazaar price
  const again = mergeIntoCatalogue(owned, [site(url, { priceCents: 4800, name: { en: "Glass Teapot 1L", fa: "" } })], [site(url)], photo);
  assert.equal(again.updated, 1);
  assert.equal(again.products[0].priceCents, 3999);
  assert.equal(again.products[0].en, "Glass Teapot 1L");
  const same = mergeIntoCatalogue(again.products, [site(url, { priceCents: 4800, name: { en: "Glass Teapot 1L", fa: "" } })], [site(url, { priceCents: 4800, name: { en: "Glass Teapot 1L", fa: "" } })], photo);
  assert.equal(same.updated, 0);
  assert.equal(same.unchanged, 1);
});

test("a product from the merchant's sheet with the same English name is the same product, not a second one", () => {
  const had: Product[] = [{ n: 7, unit: "piece", priceCents: null, en: "Glass  teapot" }];
  const m = mergeIntoCatalogue(had, [site("https://s.ca/product/teapot")], [], photo);
  assert.equal(m.added, 0);
  assert.equal(m.products.length, 1);
  assert.equal(m.products[0].priceCents, 4500); // it had none
  assert.equal(m.products[0].web, "https://s.ca/product/teapot");
});

test("sizes: the lowest price, and every size with its price in the description; never past the note's limit", () => {
  const f = fieldsOf(site("u", {
    variants: [{ title: "1L", priceCents: 4500, compareAtCents: null, available: true }, { title: "2L", priceCents: 3900, compareAtCents: null, available: true }],
    compareAtCents: 6000, description: { en: "x".repeat(900), fa: "ی".repeat(900) },
  }));
  assert.equal(f.priceCents, 3900);
  assert.ok(f.note.startsWith("Sizes: 1L $45.00 · 2L $39.00 · Was $60.00"));
  assert.ok(f.note.length <= MAX_NOTE);
});

test("a product gone from the site is counted, never taken off; a full list says so", () => {
  const first = mergeIntoCatalogue([], [site("https://s.ca/product/a")], [], photo).products;
  const m = mergeIntoCatalogue(first, [site("https://s.ca/product/b", { name: { en: "Other", fa: "" } })], [], photo, 1);
  assert.equal(m.gone, 1);
  assert.equal(m.full, true);
  assert.equal(m.products.length, 1);
});
