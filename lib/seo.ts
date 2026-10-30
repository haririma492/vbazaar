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
  // The home page: olgoo.com's VCA page, carried here (owner, 2026-10-30), in
  // Farsi at / and English at /en. It leads with this site's term; "3D virtual
  // store" stays olgoo.com/virtual-stores' search term.
  home: {
    path: "/",
    title: "بازار مجازی | مغازه و خیابانی که مشتری در آن قدم می‌زند و می‌خرد",
    description: "بازار مجازی VCA™‎: مغازه، خیابان یا پاساژ شما آنلاین؛ مشتری در آن قدم می‌زند، می‌گردد و می‌خرد، بدون اپ و در هر مرورگر. تور مجازی فروشگاه از ۳٬۵۰۰ دلار کانادا.",
    h1: "بازار مجازی",
  },
  homeEn: {
    path: "/en",
    title: "Virtual Bazaar: Walk-in Stores & Shopping Streets Online | VCA™",
    description: "Virtual Bazaar by VCA™: your store, street or plaza online, where shoppers walk in, browse and buy in any browser. Virtual stores from $3,500 CAD.",
    h1: "Virtual Bazaar",
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

/** The business, character for character as on its Google Business Profile (olgoo-com CLAUDE.md). */
export const ORG = {
  "@type": ["Organization", "ProfessionalService"],
  "@id": "https://olgoo.com/#org",
  name: "Olgoo",
  url: "https://olgoo.com/",
  telephone: "+1-416-800-1418",
  address: { "@type": "PostalAddress", streetAddress: "238 Doris Ave", addressLocality: "North York", addressRegion: "ON", postalCode: "M2N 6W1", addressCountry: "CA" },
};

/** The home page's JSON-LD @graph, in its language. The FAQPage comes from the visible FAQ (content/olgoo-vca/faq.json). */
export function homeJsonLd(lang: "fa" | "en", faq: { q: string; a: string }[]) {
  const page = lang === "fa" ? PAGES.home : PAGES.homeEn;
  const url = `${SITE}${page.path}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      ORG,
      { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: SITE_NAME.fa, alternateName: SITE_NAME.en, inLanguage: ["fa", "en"], publisher: { "@id": ORG["@id"] } },
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: page.title, description: page.description, isPartOf: { "@id": `${SITE}/#website` }, inLanguage: lang, about: { "@id": `${url}#service` } },
      {
        "@type": "Service", "@id": `${url}#service`, name: lang === "fa" ? "بازار مجازی VCA™‎ — تور مجازی فروشگاه" : "VCA™ Virtual Bazaar — walk-in virtual stores",
        serviceType: lang === "fa" ? "فروشگاه مجازی" : "Virtual store", provider: { "@id": ORG["@id"] }, areaServed: { "@type": "Country", name: "Canada" },
        offers: { "@type": "Offer", price: "3500", priceCurrency: "CAD", url: `${url}#packages` },
      },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: lang === "fa" ? SITE_NAME.fa : SITE_NAME.en, item: url }] },
      { "@type": "FAQPage", mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    ],
  };
}
