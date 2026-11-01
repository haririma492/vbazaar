import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { PAGES, SITE_NAME, homeJsonLd, indexable } from "@/lib/seo";
import HomeBehaviour from "./HomeBehaviour";
import BazaarDirectory from "./BazaarDirectory";
import { readDirectory } from "@/lib/stores/directory";
import "@/content/olgoo-vca/vca.css";
import "./home.css";

// The home page (/ in Farsi, /en in English): olgoo.com's VCA page, carried
// here by scripts/import-olgoo-vca.mjs (owner, 2026-10-30). The sections are
// olgoo.com's HTML as it renders there; this file adds the site's header,
// footer, H1 term, search metadata and JSON-LD.
type Lang = "fa" | "en";

const DIR = join(process.cwd(), "content", "olgoo-vca");
const FAQ = JSON.parse(readFileSync(join(DIR, "faq.json"), "utf8")) as Record<Lang, { q: string; a: string }[]>;
const BODY: Record<Lang, string> = {
  fa: readFileSync(join(DIR, "home.fa.html"), "utf8"),
  en: readFileSync(join(DIR, "home.en.html"), "utf8"),
};

const T = {
  fa: {
    walk: "قدم بزنید", demo: "دمو", bazaar3d: "بازار سه‌بعدی", other: "English", otherHref: "/en", otherLang: "en",
    by: "ساخت الگو", olgoo: "https://olgoo.com/fa/", contact: "https://olgoo.com/fa/contact", contactL: "تماس",
    tm: "VCA™‎ علامت تجاری Olgoo Enterprise Services Inc. است.",
  },
  en: {
    walk: "Walk it", demo: "Demo", bazaar3d: "3D bazaar", other: "فارسی", otherHref: "/", otherLang: "fa",
    by: "Made by Olgoo", olgoo: "https://olgoo.com/", contact: "https://olgoo.com/contact", contactL: "Contact",
    tm: "VCA™ is a trademark of Olgoo Enterprise Services Inc.",
  },
} as const;

export function homeMetadata(lang: Lang): Metadata {
  const page = lang === "fa" ? PAGES.home : PAGES.homeEn;
  const base = indexable(page);
  const image = { url: "/media/og/vbazaar.jpg", width: 1200, height: 630, alt: `${SITE_NAME.fa} · ${SITE_NAME.en}` };
  return {
    ...base,
    alternates: { canonical: page.path, languages: { fa: PAGES.home.path, en: PAGES.homeEn.path, "x-default": PAGES.home.path } },
    openGraph: { ...base.openGraph, images: [image], locale: lang === "fa" ? "fa_IR" : "en_CA", alternateLocale: lang === "fa" ? "en_CA" : "fa_IR" },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [image.url] },
  };
}

export default async function VcaHome({ lang }: { lang: Lang }) {
  const directory = await readDirectory();
  const t = T[lang];
  const page = lang === "fa" ? PAGES.home : PAGES.homeEn;
  const body = BODY[lang].replace("{{H1}}", `<span class="vb-h1-term">${page.h1}</span>`);
  return (
    <div className="ovca vb-home" lang={lang} dir={lang === "fa" ? "rtl" : "ltr"}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" />
      {lang === "fa" && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd(lang, FAQ[lang])) }} />
      <header className="vb-nav">
        <a href={page.path} className="vb-brand">{lang === "fa" ? SITE_NAME.fa : SITE_NAME.en}</a>
        <nav className="vb-links" aria-label={lang === "fa" ? "منو" : "Menu"}>
          <a href="/vca/walk">{t.walk}</a>
          <a href="/vca">{t.bazaar3d}</a>
          <a href="/demo">{t.demo}</a>
          <a href={t.otherHref} hrefLang={t.otherLang} lang={t.otherLang} className="vb-lang">{t.other}</a>
        </nav>
      </header>
      <BazaarDirectory lang={lang} dir={directory} />
      <main dangerouslySetInnerHTML={{ __html: body }} />
      <footer className="vb-foot">
        <p><a href={t.olgoo}>{t.by}</a> · <a href={t.contact}>{t.contactL}</a></p>
        <p dir="ltr">Olgoo · 238 Doris Ave, North York, ON M2N 6W1 · <a href="tel:+14168001418">+1-416-800-1418</a> · <a href="mailto:admin@olgoo.com">admin@olgoo.com</a></p>
        <p>{t.tm}</p>
      </footer>
      <HomeBehaviour lang={lang} />
    </div>
  );
}
