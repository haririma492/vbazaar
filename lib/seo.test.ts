import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGES, homeJsonLd } from "./seo.ts";

// olgoo-com's "Masoud SEO standards": titles 50–65 characters, descriptions 145–160.
test("indexed pages keep their titles and descriptions within the limits", () => {
  for (const [name, p] of Object.entries(PAGES)) {
    if ("title" in p) assert.ok(p.title.length >= 50 && p.title.length <= 65, `${name} title is ${p.title.length}`);
    if (name === "home" || name === "homeEn") assert.ok(p.description.length >= 145 && p.description.length <= 160, `${name} description is ${p.description.length}`);
  }
});

test("the home page's FAQPage comes from its visible FAQ, with a CAD offer", () => {
  const faq = JSON.parse(readFileSync(new URL("../content/olgoo-vca/faq.json", import.meta.url), "utf8"));
  for (const lang of ["fa", "en"] as const) {
    const html = readFileSync(new URL(`../content/olgoo-vca/home.${lang}.html`, import.meta.url), "utf8");
    assert.equal((html.match(/<details class="faq-q/g) || []).length, faq[lang].length);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
    const g = homeJsonLd(lang, faq[lang])["@graph"] as any[];
    assert.equal(g.find((n) => n["@type"] === "FAQPage").mainEntity.length, faq[lang].length);
    assert.equal(g.find((n) => n["@type"] === "Service").offers.priceCurrency, "CAD");
  }
});
