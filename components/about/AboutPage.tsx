import TourBazaarLink from "@/components/brand/TourBazaarLink";
import type { Metadata } from "next";
import { ORG, PAGES, SITE, SITE_NAME, SHARE_IMAGE, indexable } from "@/lib/seo";
import "@/content/olgoo-vca/vca.css";
import "@/components/home/home.css";
import "./about.css";

// About us (owner, 2026-11-15: "create an about us for vbazaar and speak about VCA in brief", with the CEO's photo
// and the same text as olgoo.com/about's Leadership). Farsi at /about, English at /en/about. Every fact here is
// already on olgoo.com (about, virtual-stores, the home page's FAQ): nothing new is claimed.
type Lang = "fa" | "en";

const PHOTO = "/media/team/farid-hariri-2026.jpg";

const T = {
  fa: {
    page: PAGES.about, home: PAGES.home.path, other: "English", otherHref: PAGES.aboutEn.path, otherLang: "en",
    walk: "قدم بزنید", demo: "دمو",
    kicker: "درباره ما",
    lead: "بازار مجازی (vbazaar.app) جایی است که خیابان‌ها، پاساژها و مغازه‌های واقعی تورنتو را آنلاین قدم می‌زنید، وارد مغازه می‌شوید و خرید می‌کنید. آن را Olgoo Enterprise Services Inc. ساخته است، تیمی کوچک در نورث یورک تورنتو که از ۲۰۲۲ کسب‌وکارها را آنلاین می‌کند.",
    vcaK: "VCA™‎ در چند جمله",
    vcaH: "نشانی تجاری مجازی",
    vca: [
      "VCA™‎ (Virtual Commercial Address، نشانی تجاری مجازی) مقصدی در دنیای دیجیتال است که با یک مکان تجاری واقعی، یعنی یک خیابان، پاساژ یا مغازه، یکی است؛ مردم آنلاین به آن می‌رسند، در آن قدم می‌زنند، وارد مغازه‌ها می‌شوند و می‌خرند.",
      "فرقش با تور مجازی این است که تور یک جا را نشان می‌دهد و VCA جاها را به هم وصل می‌کند: مغازه کنار مغازه، روی خیابان واقعی خودش، و هر کالا را می‌شود لمس کرد و به سبد افزود. خرید است، نه فقط تماشا.",
      "بدون اپ و بدون عینک واقعیت مجازی، در هر مرورگر روی کامپیوتر، تلفن یا تبلت. تور مجازی یک فروشگاه از ۳٬۵۰۰ دلار کانادا.",
    ],
    facts: ["تأسیس ۲۰۲۲ · نورث یورک، تورنتو", "ثبت اختراع VCA™‎ در CIPO", "علائم تجاری VCA™‎ و Simourgh™‎"],
    walkCta: "در بازار قدم بزنید", joinCta: "مغازه‌تان را بیاورید",
    leadK: "مدیریت",
    name: "فرید حریری",
    role: "بنیان‌گذار و مدیرعامل",
    bio: [
      "فرید حریری نزدیک به سه دهه در شرکت Oracle کار کرده و تخصص فنی در سیستم‌های سازمانی را با رهبری راهبردی و درک کسب‌وکار درآمیخته است. او تیم‌های مهندسی را رهبری کرده، مسائل پیچیدهٔ سازمانی را حل کرده و با مشتریان جهانی و گروه‌های توسعهٔ محصول همکاری داشته است. پیش از آن در دانشگاه صنعتی آریامهر در ایران مهندسی سیستم‌ها، تحقیق در عملیات و مدیریت پروژه درس می‌داد. او کارشناسی ارشد برنامه‌ریزی سیستم‌ها و تحقیق در عملیات و کارشناسی مهندسی صنایع دارد.",
      "او به‌عنوان مدیرعامل، رهبری‌ای بر پایهٔ نوآوری، تفکر تحلیلی و برتری عملیاتی دارد. تخصص او هوش مصنوعی، یادگیری ماشین، زیرساخت ابری و سیستم‌های سازمانی را در بر می‌گیرد، و تمرکزش بر ساختن تیم‌های پربازده، رشد سازمان و تبدیل فناوری‌های نو به راه‌حل‌هایی مقیاس‌پذیر و ارزشمند است.",
    ],
    contactH: "تماس", by: "ساخت الگو", olgoo: "https://olgoo.com/fa/about",
    tm: "VCA™‎ علامت تجاری Olgoo Enterprise Services Inc. است.",
  },
  en: {
    page: PAGES.aboutEn, home: PAGES.homeEn.path, other: "فارسی", otherHref: PAGES.about.path, otherLang: "fa",
    walk: "Walk it", demo: "Demo",
    kicker: "About us",
    lead: "Virtual Bazaar (vbazaar.app) is where you walk Toronto’s real shopping streets, plazas and stores online, step into a store and buy. It is built by Olgoo Enterprise Services Inc., a small team in North York, Toronto, that has been putting businesses online since 2022.",
    vcaK: "VCA™ in brief",
    vcaH: "The Virtual Commercial Address",
    vca: [
      "VCA™ (Virtual Commercial Address) is a destination in the digital world that corresponds to a real commercial place — a street, mall or store — so people can arrive online, walk through it, step into stores and buy.",
      "A tour shows one place; VCA connects places. Stores sit beside stores on their real streets, and every product can be tapped and added to the basket — it’s shopping, not just a view.",
      "No app and no VR headset: it runs in any modern browser on a computer, phone or tablet. A walk-in virtual store starts from $3,500 CAD.",
    ],
    facts: ["Founded 2022 · North York, Toronto", "VCA™ patent filed with CIPO", "VCA™ and Simourgh™ trademarks"],
    walkCta: "Walk the bazaar", joinCta: "Bring your store",
    leadK: "Leadership",
    name: "Farid Hariri",
    role: "Founder & Chief Executive Officer",
    bio: [
      "Farid Hariri brings nearly three decades of experience at Oracle Corporation, combining enterprise technology expertise, strategic leadership, and business acumen. He has led engineering teams, resolved complex enterprise challenges, and collaborated with global customers and product development groups. He also served as a professor at Aryamehr University of Technology in Iran, teaching Systems Engineering, Operations Research, and Project Management. He holds a Master’s degree in Systems Planning and Operations Research and a Bachelor’s degree in Industrial Engineering.",
      "As CEO, Farid brings a leadership approach grounded in innovation, analytical thinking, and operational excellence. His expertise spans artificial intelligence, machine learning, cloud infrastructure, and enterprise systems. He focuses on building high-performing teams, driving organizational growth, and translating emerging technologies into scalable, commercially valuable solutions.",
    ],
    contactH: "Contact", by: "Made by Olgoo", olgoo: "https://olgoo.com/about",
    tm: "VCA™ is a trademark of Olgoo Enterprise Services Inc.",
  },
} as const;

export function aboutMetadata(lang: Lang): Metadata {
  const page = T[lang].page;
  const base = indexable(page);
  return {
    ...base,
    alternates: { canonical: page.path, languages: { fa: PAGES.about.path, en: PAGES.aboutEn.path, "x-default": PAGES.about.path } },
    openGraph: { ...base.openGraph, locale: lang === "fa" ? "fa_IR" : "en_CA", alternateLocale: lang === "fa" ? "en_CA" : "fa_IR" },
  };
}

function jsonLd(lang: Lang) {
  const t = T[lang];
  const url = `${SITE}${t.page.path}`;
  const person = `${SITE}/about#farid-hariri`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { ...ORG, founder: { "@id": person } },
      { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: SITE_NAME.fa, alternateName: SITE_NAME.en, inLanguage: ["fa", "en"], publisher: { "@id": ORG["@id"] } },
      { "@type": "AboutPage", "@id": `${url}#webpage`, url, name: t.page.title, description: t.page.description, inLanguage: lang, isPartOf: { "@id": `${SITE}/#website` }, about: { "@id": ORG["@id"] }, primaryImageOfPage: `${SITE}${SHARE_IMAGE.url}` },
      { "@type": "Person", "@id": person, name: "Farid Hariri", alternateName: "فرید حریری", jobTitle: lang === "fa" ? t.role : "Founder & Chief Executive Officer", image: `${SITE}${PHOTO}`, worksFor: { "@id": ORG["@id"] } },
      {
        "@type": "DefinedTerm", "@id": `${SITE}/about#vca`, name: "Virtual Commercial Address (VCA™)", alternateName: "نشانی تجاری مجازی",
        description: T.en.vca[0], inDefinedTermSet: "https://olgoo.com/virtual-commercial-address",
      },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: lang === "fa" ? SITE_NAME.fa : SITE_NAME.en, item: `${SITE}${t.home}` },
        { "@type": "ListItem", position: 2, name: t.page.h1, item: url },
      ] },
    ],
  };
}

export default function AboutPage({ lang }: { lang: Lang }) {
  const t = T[lang];
  return (
    <div className="ovca vb-home vb-about" lang={lang} dir={lang === "fa" ? "rtl" : "ltr"}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" />
      {lang === "fa" && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(lang)) }} />
      <header className="vb-nav">
        <TourBazaarLink here={t.home} className="vb-sign" />
        <a href={t.home} className="vb-brand">{lang === "fa" ? `${SITE_NAME.fa} تورنتو` : `${SITE_NAME.en} Toronto`}</a>
        <nav className="vb-links" aria-label={lang === "fa" ? "منو" : "Menu"}>
          <a href="/vca/walk">{t.walk}</a>
          <a href="/demo">{t.demo}</a>
          <a href={t.otherHref} hrefLang={t.otherLang} lang={t.otherLang} className="vb-lang">{t.other}</a>
        </nav>
      </header>
      <main>
        <section className="ab-sec ab-hero">
          <div className="hm-wrap">
            <p className="hm-kicker">{t.kicker}</p>
            <h1 className="ab-h1">{t.page.h1}</h1>
            <p className="ab-lead">{t.lead}</p>
          </div>
        </section>
        <section className="ab-sec" aria-labelledby="ab-vca">
          <div className="hm-wrap">
            <p className="hm-kicker">{t.vcaK}</p>
            <h2 className="vs-h3" id="ab-vca">{t.vcaH}</h2>
            {t.vca.map((p) => <p key={p} className="ab-text">{p}</p>)}
            <ul className="ab-facts">{t.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            <p className="ab-ctas">
              <a href="/vca/walk" className="ab-btn gold">{t.walkCta}</a>
              <a href={`${t.home}#pilot`} className="ab-btn ghost">{t.joinCta}</a>
            </p>
          </div>
        </section>
        <section className="ab-sec" aria-labelledby="ab-lead-title">
          <div className="hm-wrap">
            <p className="hm-kicker">{t.leadK}</p>
            <div className="ab-leader">
              <img className="ab-leader-photo" src={PHOTO} alt={t.name} width={600} height={800} loading="lazy" />
              <div>
                <h2 className="vs-h3" id="ab-lead-title">{t.name}</h2>
                <p className="ab-leader-role">{t.role}</p>
                {t.bio.map((p) => <p key={p} className="ab-text">{p}</p>)}
              </div>
            </div>
          </div>
        </section>
        <section className="ab-sec" aria-labelledby="ab-contact">
          <div className="hm-wrap">
            <h2 className="vs-h3" id="ab-contact">{t.contactH}</h2>
            <p className="ab-text" dir="ltr">Olgoo Enterprise Services Inc. · 238 Doris Ave, North York, ON M2N 6W1 · <a href="tel:+14168001418">+1-416-800-1418</a> · <a href="mailto:admin@olgoo.com">admin@olgoo.com</a></p>
          </div>
        </section>
      </main>
      <footer className="vb-foot">
        <p><a href={t.olgoo}>{t.by}</a></p>
        <p>{t.tm}</p>
      </footer>
    </div>
  );
}
