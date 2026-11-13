import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bestImageUrl, fillEndpoint, findJsonEndpoints, handleOf, isDisallowed, parseRobots, parseSitemap, productFromHtml, productFromJson,
  productPages, splitLanguages, toCents, toCsv, withSitemapImages,
} from "./websiteRules";

// shirazgallery.ca's own answers, 2026-11-06 (the first store the explorer read).
const ROBOTS = `User-Agent: *
Allow: /
Disallow: /account/
Disallow: /admin/
Disallow: /api/
Disallow: /cart

Host: https://www.shirazgallery.ca
Sitemap: https://www.shirazgallery.ca/sitemap.xml
`;
const SITEMAP = `<?xml version="1.0"?><urlset>
<url><loc>https://www.shirazgallery.ca</loc></url>
<url><loc>https://www.shirazgallery.ca/products/teapots</loc></url>
<url><loc>https://www.shirazgallery.ca/product/1-6l-oval-glass-buffet-warmer-with-stainless-steel-stand-lid</loc>
<image:image><image:loc>https://cdn.shopify.com/s/files/1/0844/3346/9684/files/0ECCC6B9-F60A-493A-AF9F-B4C7B30BF455.png?v=1788450478</image:loc></image:image></url>
<url><loc>https://www.shirazgallery.ca/product/stainless-steel-frying-pan</loc></url>
</urlset>`;
const JS = 'try{let t=await fetch(`/api/products/${encodeURIComponent(e)}/reviews`,{method:"POST",headers:{}})}catch{};'
  + 'try{let a=await fetch(`/api/products/${encodeURIComponent(e)}?locale=${encodeURIComponent(B)}`,{cache:"no-store",signal:t.signal})}catch{}'
  + 'let t=await fetch("/api/auth/me",{cache:"no-store"})';
const API = JSON.parse(readFileSync(new URL("./fixtures/shirazgallery-product.json", import.meta.url), "utf8"));
const URL1 = "https://www.shirazgallery.ca/product/1-6l-oval-glass-buffet-warmer-with-stainless-steel-stand-lid";

test("robots.txt: the store's own rules for every robot", () => {
  const r = parseRobots(ROBOTS);
  assert.deepEqual(r.disallow, ["/account/", "/admin/", "/api/", "/cart"]);
  assert.deepEqual(r.sitemaps, ["https://www.shirazgallery.ca/sitemap.xml"]);
  assert.equal(isDisallowed("/api/products/x?locale=en", r), true);
  assert.equal(isDisallowed("/product/x", r), false);
  assert.equal(isDisallowed("/products.json", r), false);
  assert.equal(isDisallowed("/cart/add", r), true);
});

test("robots.txt: a group for another robot is not ours, and the longest rule wins", () => {
  const r = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /shop/\nAllow: /shop/items/\n");
  assert.equal(isDisallowed("/anything", r), false);
  assert.equal(isDisallowed("/shop/cart", r), true);
  assert.equal(isDisallowed("/shop/items/kettle", r), false);
  assert.equal(isDisallowed("/x.pdf", parseRobots("User-agent: *\nDisallow: /*.pdf$")), true);
});

test("sitemap: products are the /product/ pages; /products/<x> there is a shelf", () => {
  const { urls } = parseSitemap(SITEMAP);
  assert.equal(urls.length, 4);
  const pages = productPages(urls);
  assert.deepEqual(pages.map((p) => handleOf(p.loc)), ["1-6l-oval-glass-buffet-warmer-with-stainless-steel-stand-lid", "stainless-steel-frying-pan"]);
  assert.equal(pages[0].images.length, 1);
  // A Shopify site: /products/<handle> ARE the products.
  const shop = parseSitemap("<urlset><url><loc>https://x.ca/products/kettle</loc></url><url><loc>https://x.ca/pages/about</loc></url></urlset>");
  assert.deepEqual(productPages(shop.urls).map((u) => u.loc), ["https://x.ca/products/kettle"]);
  assert.deepEqual(parseSitemap("<sitemapindex><sitemap><loc>https://x.ca/s1.xml</loc></sitemap></sitemapindex>").sitemaps, ["https://x.ca/s1.xml"]);
});

test("the page's own product JSON is found in its scripts; the review POST is not", () => {
  const found = findJsonEndpoints(JS);
  assert.deepEqual(found, ["/api/products/{handle}?locale=en"]);
  assert.equal(fillEndpoint(found[0], "a b"), "/api/products/a%20b?locale=en");
});

test("ShirazGallery's product: name, CAD price, every photo, the description split into English and Persian", () => {
  const p = productFromJson(API, URL1)!;
  assert.equal(p.name.en, "Oval Glass Bamboo Design Buffet Warmer with Stainless Steel Stand & Lid");
  assert.equal(p.priceCents, 9500);
  assert.equal(p.compareAtCents, null);
  assert.equal(p.currency, "CAD");
  assert.equal(p.images.length, 2);
  assert.ok(p.images[0].startsWith("https://cdn.shopify.com/") && p.images[0].includes("v=1788450478"));
  assert.ok(p.description.en.startsWith("Elegant 1.6L Oval Glass Buffet Warmer"));
  assert.ok(p.description.en.endsWith("special occasions"));
  assert.ok(p.description.fa.startsWith("سوفله‌خوری و گرم‌کن غذای بیضی"));
  assert.deepEqual(p.category, ["Serveware", "Chafing Dishes & Food Warmers"]);
  assert.equal(p.available, true);
  assert.deepEqual(p.variants, []); // one «Default Title» variant is no choice
  assert.equal(p.source, "json");
});

test("Shopify's /products.json shape: string prices, a sale, sizes as variants", () => {
  const p = productFromJson({
    title: "Samovar", handle: "samovar", body_html: "<p>Brass <b>samovar</b></p>", product_type: "Tea",
    variants: [{ title: "3L", price: "120.00", compare_at_price: "150.00", available: true }, { title: "5L", price: "160.00", compare_at_price: null, available: false }],
    images: [{ src: "https://cdn.shopify.com/s/files/1/x/files/sam_600x600.jpg?v=1" }],
  }, "https://x.ca/products/samovar", "shopify")!;
  assert.equal(p.priceCents, 12000);
  assert.equal(p.compareAtCents, 15000);
  assert.equal(p.variants.length, 2);
  assert.equal(p.description.en, "Brass samovar");
  assert.deepEqual(p.images, ["https://cdn.shopify.com/s/files/1/x/files/sam.jpg?v=1"]);
});

test("WooCommerce's Store API: prices in minor units", () => {
  const p = productFromJson({ name: "Kettle", prices: { price: "4599", regular_price: "5999", currency_code: "CAD", currency_minor_unit: 2 }, images: [{ src: "https://x.ca/wp-content/uploads/k-300x300.jpg" }] }, "https://x.ca/product/kettle", "woo")!;
  assert.equal(p.priceCents, 4599);
  assert.equal(p.compareAtCents, 5999);
  assert.deepEqual(p.images, ["https://x.ca/wp-content/uploads/k.jpg"]);
});

test("a page's structured data, else its share tags", () => {
  const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tray","image":["/i/tray.jpg"],"offers":{"@type":"Offer","price":"19.99","priceCurrency":"CAD","availability":"https://schema.org/InStock"}}</script>`;
  const a = productFromHtml(ld, "https://x.ca/product/tray")!;
  assert.equal(a.priceCents, 1999);
  assert.deepEqual(a.images, ["https://x.ca/i/tray.jpg"]);
  assert.equal(a.source, "jsonld");
  const b = productFromHtml(`<meta property="og:title" content="Pot &amp; Lid"/><meta property="og:image" content="https://x.ca/p.png"/>`, "https://x.ca/product/pot")!;
  assert.equal(b.name.en, "Pot & Lid");
  assert.equal(b.priceCents, null);
  assert.equal(b.source, "meta");
  assert.equal(productFromHtml("<html></html>", "https://x.ca/"), null);
  // shirazgallery.ca's drafts: the generic title is no name; kept for the photo, marked unlisted.
  const draft = productFromHtml(`<meta property="og:title" content="Product | محصول | Shiraz Gallery Canada"/><meta property="og:site_name" content="Shiraz Gallery Canada"/><meta property="og:image" content="https://cdn.shopify.com/s/files/IMG-1408.png?v=1"/>`, "https://s.ca/product/untitled-aug18")!;
  assert.equal(draft.unlisted, true);
  assert.deepEqual(draft.name, { en: "", fa: "" });
  assert.equal(draft.images.length, 1);
  // …and without the site-name tag (the drafts' own pages carry none).
  assert.equal(productFromHtml(`<meta property="og:title" content="Product | محصول | Shiraz Gallery Canada"/><meta property="og:image" content="https://x.ca/a.png"/>`, "https://s.ca/product/untitled")!.unlisted, true);
  assert.equal(productFromHtml(`<meta property="og:title" content="Copper Samovar | Shiraz Gallery Canada"/>`, "https://s.ca/product/samovar")!.name.en, "Copper Samovar | Shiraz Gallery Canada");
});

test("prices, languages and photos", () => {
  assert.equal(toCents(95), 9500);
  assert.equal(toCents("$1,299.50"), 129950);
  assert.equal(toCents({ amount: "9.99" }), 999);
  assert.equal(toCents("call for price"), null);
  assert.deepEqual(splitLanguages("Only English here"), { en: "Only English here", fa: "" });
  assert.equal(splitLanguages("قوری چینی گل‌سرخی با درب و نعلبکی").fa.length > 0, true);
  // The site's own labels (shirazgallery.ca's stockpot, 2026-11-06).
  const pot = splitLanguages("English Description 24 cm Stainless Steel Stockpot for Everyday Cooking. Suitable for induction cooking.توضیحات فارسی 24 cm قابلمه کارایی مناسب برای آشپزی روزمره را ترکیب می‌کند.");
  assert.equal(pot.en, "24 cm Stainless Steel Stockpot for Everyday Cooking. Suitable for induction cooking.");
  assert.equal(pot.fa, "24 cm قابلمه کارایی مناسب برای آشپزی روزمره را ترکیب می‌کند.");
  // No labels: a Persian word in an English sentence does not split it.
  assert.equal(splitLanguages("Our best seller, the Samovar (سماور), in brass.").fa, "");
  assert.equal(bestImageUrl("data:image/png;base64,xx"), null);
  assert.equal(bestImageUrl("//cdn.shopify.com/s/files/a_grande.png?width=300"), "https://cdn.shopify.com/s/files/a.png");
  const p = withSitemapImages(productFromJson(API, URL1)!, ["https://cdn.shopify.com/s/files/1/0844/3346/9684/files/0ECCC6B9-F60A-493A-AF9F-B4C7B30BF455.png?v=1788450478", "https://cdn.shopify.com/s/new.png"]);
  assert.equal(p.images.length, 3); // the same photo twice is once
});

test("the CSV keeps the Farsi and never starts a cell Excel would run", () => {
  const p = productFromJson(API, URL1)!;
  const csv = toCsv([{ ...p, name: { en: "=HYPERLINK(1)", fa: "سوفله‌خوری" } }]);
  assert.ok(csv.startsWith("﻿title_en,title_fa,unit price"));
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes("سوفله‌خوری"));
  assert.ok(csv.includes(",95.00,"));
});

import { socialPage } from "./websiteRules.ts";
test("a social page is not a shop; a page named like a web address points to it", () => {
  assert.deepEqual(socialPage("https://www.instagram.com/nuttime.ca/"), { network: "instagram", guess: "https://nuttime.ca" });
  assert.deepEqual(socialPage("https://www.instagram.com/saraye_bamdad/"), { network: "instagram", guess: null });
  assert.equal(socialPage("https://m.facebook.com/someshop")?.network, "facebook");
  assert.equal(socialPage("https://linktr.ee/shop")?.network, "linktree");
  assert.equal(socialPage("https://www.shirazgallery.ca/"), null);
  assert.equal(socialPage("https://notinstagram.com.example.ca/"), null);
  assert.equal(socialPage("not a url"), null);
});
