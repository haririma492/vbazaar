import type { Metadata } from "next";

/**
 * Search metadata for vbazaar.app's public pages (owner, 2026-10-30: "I want
 * all SEO indexing, strategy and Automatic agent optimization to be turned on
 * on vbazaar.app as well"). Pages are noindex by default (`app/layout.tsx`);
 * a page is indexed only by calling `indexable()`. Titles 50–65 characters,
 * descriptions 145–160 (olgoo-com CLAUDE.md, "Masoud SEO standards").
 * The site's own terms: "virtual bazaar" / «بازار مجازی». "3D virtual store",
 * "virtual mall" belong to olgoo.com/virtual-stores — one term, one page.
 */
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://vbazaar.app").replace(/\/+$/, "");
export const SITE_NAME = { fa: "بازار مجازی", en: "Virtual Bazaar" };

export const PAGES = {
  home: {
    path: "/",
    title: "بازار مجازی | Virtual Bazaar — قدم زدن ۳۶۰° در خیابان یانگ",
    description: "در بازار مجازی، خیابان یانگ را ۳۶۰ درجه قدم بزنید، وارد مغازه‌ها شوید، قیمت‌ها و حراج‌ها را ببینید و به سبد اضافه کنید. Walk the Virtual Bazaar online.",
  },
  walk: {
    path: "/vca/walk",
    title: "قدم زدن ۳۶۰° در بازار مجازی | Virtual Bazaar 360° walk",
    description: "خیابان واقعی را در ویدیوی ۳۶۰ درجه قدم بزنید، به اطراف نگاه کنید و از در هر مغازه وارد شوید. Walk a real street in 360°, look around and step into a shop.",
  },
  bazaar3d: {
    path: "/vca",
    title: "بازار مجازی سه‌بعدی: خیابان و مغازه‌ها | Virtual Bazaar 3D",
    description: "بازار مجازی را سه‌بعدی ببینید: خیابان‌ها، مغازه‌ها و نشانی مجازی هر مغازه، با رفتن به داخل و خرید. See the Virtual Bazaar in 3D: its streets and its shops.",
  },
  address: {
    path: "/vb",
    description: "نشانی مجازی در بازار مجازی: در بازار قدم بزنید، جلوی هر مغازه بایستید و از مغازه‌ها خرید کنید. Your virtual address in the Virtual Bazaar — walk in and shop.",
  },
} as const;

/** Metadata for an indexed page: its own canonical, and the same text on share cards. */
export function indexable({ path, title, description }: { path: string; title: string; description: string }): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title, description, siteName: SITE_NAME.fa, locale: "fa_IR" },
    twitter: { card: "summary", title, description },
    robots: { index: true, follow: true },
  };
}

/** One JSON-LD @graph for the home page: the site and the page. */
export function homeJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: SITE_NAME.fa, alternateName: SITE_NAME.en, inLanguage: "fa" },
      { "@type": "WebPage", "@id": `${SITE}/#webpage`, url: `${SITE}/`, name: PAGES.home.title, description: PAGES.home.description, isPartOf: { "@id": `${SITE}/#website` }, inLanguage: "fa" },
    ],
  };
}
