#!/usr/bin/env node
// The home page's content is everything VCA on olgoo.com: its home page's
// VCA hero ("Don't just shop online. Walk in.") and its VCA page
// (/virtual-stores), in English and Farsi, copied here (owner, 2026-10-30: "bring all related to
// VCA from olgoo.com to here as main page, not eliminating from olgoo.com
// yet"). While both sites carry it, olgoo.com stays the source: run this again
// after its VCA page changes, check the result, commit.
//
//   node scripts/import-olgoo-vca.mjs [base]     (base: https://olgoo.com, or a local olgoo-com server)
//
// Writes content/olgoo-vca/: home.en.html and home.fa.html (the page's
// sections, links to olgoo.com pages made absolute), faq.json (the visible
// FAQ, for the FAQPage JSON-LD) and vca.css (olgoo.com's site.css, kept to the
// rules these sections use and scoped under .ovca so it touches no other page).
// The media it shows live in public/media/vca/ (copied from olgoo-com/media/vca).
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const BASE = (process.argv[2] || "https://olgoo.com").replace(/\/+$/, "");
const OLGOO = "https://olgoo.com";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "olgoo-vca");
// Paths this app serves itself; every other olgoo.com path becomes an absolute link.
const LOCAL = /^\/(vca|vb|demo|vr|chinastore|media\/vca)(\/|\?|#|$)/;

async function get(path) {
  const r = await fetch(BASE + path, { headers: { "user-agent": "vbazaar-import" } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}

function between(html, start, end, path) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`${path}: markers not found (${start} … ${end}) — has the page changed?`);
  return html.slice(a, b);
}

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "’");
const text = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function sections(html, lang, docs) {
  const path = lang === "fa" ? "/fa/virtual-stores" : "/virtual-stores";
  let s = between(html, '<section class="vca hm-hero"', '<!-- Sign-in for the private VCA documents', path);
  s += between(html, '<dialog class="hm-player"', "</dialog>", path) + "</dialog>\n";
  const self = lang === "fa" ? "/fa/virtual-stores" : "/virtual-stores";
  s = s
    .replace(/ data-i18n(-[a-z]+)?="[^"]*"/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // olgoo.com's home hero (hero() below) carries the page's one H1; this hero's heading becomes an H2
    // that keeps the H1 look (vb-h1like gets olgoo.com's bare h1 rules, see scopeCss).
    .replace(/<h1 class="hm-h1([^"]*)"([^>]*)>([\s\S]*?)<\/h1>/, '<h2 class="hm-h1 vb-h1like$1"$2>$3</h2>')
    .replace('<section class="vca hm-hero" id="top"', '<section class="vca hm-hero" id="virtual-stores"')
    .replace(/(href|src|poster|data-video)="(\/[^"]*)"/g, (m, attr, url) => {
      if (url.startsWith(self + "#")) return `${attr}="${url.slice(self.length)}"`;
      if (LOCAL.test(url)) return m;
      return `${attr}="${OLGOO}${url}"`;
    })
    // The private documents: their titles (public) as olgoo.com lists them; access stays on olgoo.com.
    .replace('<div id="vca-docs" class="vs-docs-slot"></div>', `<div id="vca-docs" class="vs-docs-slot">${docs}</div>`)
    // Signing in to request them works on olgoo.com only (its session cookie): link there instead.
    .replace(/<div class="vs-docs-request[^"]*"[^>]*><\/div>/, `<p class="vs-docs-note rv"><a href="${OLGOO}${self}#vca-docs">${lang === "fa" ? "درخواست اسناد در olgoo.com ←" : "Request the documents on olgoo.com →"}</a></p>`);
  if (/<h1[\s>]/.test(s)) throw new Error(`${path}: an H1 is left in the sections`);
  const faq = [...s.matchAll(/<details class="faq-q[^"]*">\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
    .map(([, q, a]) => ({ q: text(q), a: text(a) }));
  if (faq.length < 3) throw new Error(`${path}: FAQ not found`);
  return { html: s.trim() + "\n", faq };
}

// olgoo.com's home page hero ("Don't just shop online. Walk in.", the VCA hook with the live walk).
// Its price line is e-commerce's, so it takes the VCA one from the same page's VCA card.
function hero(html, lang) {
  const path = lang === "fa" ? "/fa/" : "/";
  let s = between(html, '<section class="vca hub-hero hk-hero"', "</section>", path) + "</section>\n";
  const vcaCard = between(html, 'data-track="card_vca"', "</a>", path);
  const price = (vcaCard.match(/<small>([\s\S]*?)<\/small>/) || [])[1];
  if (!price) throw new Error(`${path}: the VCA card's price line not found`);
  s = s
    .replace(/ data-i18n(-[a-z]+)?="[^"]*"/g, "")
    .replace(/ data-track="[^"]*"/g, "")
    .replace(/(<p class="hk-trust[^"]*">)[\s\S]*?(<\/p>)/, `$1VCA™ · ${price}$2`)
    // The H1 leads with this site's own term (lib/seo.ts, filled in for {{H1}}), then olgoo.com's line.
    .replace(/(<h1 class="hub-h1[^"]*"[^>]*>)/, "$1{{H1}}")
    .replace(/(href|src|poster)="([^"]*)"/g, (m, attr, url) => {
      if (url.startsWith("#")) return `${attr}="${OLGOO}${path}${url}"`;
      if (!url.startsWith("/") || LOCAL.test(url)) return m;
      return `${attr}="${OLGOO}${url}"`;
    });
  if (!s.includes("{{H1}}")) throw new Error(`${path}: no H1 in the hero`);
  return s;
}

// site.css, kept to the rules whose classes appear in the sections, scoped to .ovca.
function scopeCss(css, used) {
  const root = postcss.parse(css);
  const scope = (sel) => {
    sel = sel.trim();
    const m = sel.match(/^(html|body|:root)((\[[^\]]+\])*)(.*)$/);
    if (m) return `.ovca${m[2] || ""}${m[4]}`;
    if (/^\[dir="?rtl"?\]/.test(sel)) return sel.replace(/^\[dir="?rtl"?\]/, ".ovca[dir=rtl]");
    if (sel === "*") return ".ovca,.ovca *";
    return `.ovca ${sel}`;
  };
  const keep = (sel) => {
    const classes = [...sel.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((x) => x[1]);
    if (classes.length) return classes.every((c) => used.has(c) || ["in", "open", "locked"].includes(c));
    // Element-only rules: the page's own header and footer are this site's.
    return !/^(nav|footer|header)\b/.test(sel.replace(/^(html|body)(\[[^\]]+\])*\s*/, ""));
  };
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test(rule.parent.name)) return;
    const sels = rule.selectors.filter(keep).flatMap((x) => (/^h1\b/.test(x.trim()) ? [x, x.trim().replace(/^h1/, ".vb-h1like")] : [x]));
    if (!sels.length) return rule.remove();
    rule.selectors = sels.map(scope);
  });
  root.walkAtRules("media", (at) => { if (!at.nodes?.length) at.remove(); });
  return root.toString().replace(/\n{3,}/g, "\n\n");
}

const [en, fa, homeEn, homeFa, css, docs] = await Promise.all([get("/virtual-stores"), get("/fa/virtual-stores"), get("/"), get("/fa/"), get("/site.css"), get("/api/vca")]);
const docsHtml = (() => { try { return JSON.parse(docs).html || ""; } catch { return docs.trim().startsWith("<") ? docs : ""; } })();
const E = sections(en, "en", docsHtml), F = sections(fa, "fa", docsHtml);
E.html = hero(homeEn, "en") + "\n" + E.html;
F.html = hero(homeFa, "fa") + "\n" + F.html;
const used = new Set([...(E.html + F.html).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
const fonts = `
/* Farsi: Vazirmatn throughout (as olgoo.com's i18n.js does) */
.ovca[lang=fa],.ovca[lang=fa] *:not(svg):not(path):not(code){font-family:'Vazirmatn','DM Sans',sans-serif !important;letter-spacing:0 !important;text-transform:none !important}
`;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "home.en.html"), E.html);
await writeFile(join(OUT, "home.fa.html"), F.html);
await writeFile(join(OUT, "faq.json"), JSON.stringify({ en: E.faq, fa: F.faq }, null, 2) + "\n");
await writeFile(join(OUT, "vca.css"), `/* Generated by scripts/import-olgoo-vca.mjs from olgoo.com/site.css — do not edit by hand. */\n${scopeCss(css, used)}${fonts}`);
console.log(`imported from ${BASE}: en ${E.html.length} B, fa ${F.html.length} B, FAQ ${E.faq.length}/${F.faq.length}, docs ${docsHtml ? "yes" : "none"}`);
