// THE MAIN PAGE'S FIRST THING (owner, 2026-11-01): the places to walk into,
// then the stores. Each card opens its fixed address (/p/<place>, /s/<store>).
// Nothing is drawn until a place has a walk or a store is published.
import type { Directory } from "@/lib/stores/directory";

type Lang = "fa" | "en";
const T = {
  fa: { places: "قدم بزنید", placesSub: "یک مرکز خرید را انتخاب کنید و وارد شوید.", stores: "فروشگاه‌ها", walkIn: "ورود ←", n: (k: number) => `${k.toLocaleString("fa-IR")} فروشگاه` },
  en: { places: "Walk in", placesSub: "Choose a place and step inside.", stores: "Stores", walkIn: "Walk in →", n: (k: number) => `${k} store${k === 1 ? "" : "s"}` },
} as const;

export default function BazaarDirectory({ lang, dir }: { lang: Lang; dir: Directory }) {
  if (!dir.places.length && !dir.stores.length) return null;
  const t = T[lang];
  const nameIn = (n: { en: string; fa: string }) => (lang === "fa" ? n.fa || n.en : n.en || n.fa);
  const placeName = (id?: string) => { const p = dir.places.find((x) => x.id === id); return p ? nameIn(p.name) : ""; };
  return (
    <section className="vb-dir" aria-label={t.places}>
      {dir.places.length > 0 && (<>
        <h2>{t.places}</h2>
        <p className="vb-dir-sub">{t.placesSub}</p>
        <div className="vb-dir-grid vb-dir-places">
          {dir.places.map((p) => (
            <a key={p.id} href={`/p/${p.id}`} className="vb-dir-card vb-dir-place">
              <span className="vb-dir-name">{nameIn(p.name)}</span>
              {p.stores > 0 && <span className="vb-dir-meta">{t.n(p.stores)}</span>}
              <span className="vb-dir-go">{t.walkIn}</span>
            </a>
          ))}
        </div>
      </>)}
      {dir.stores.length > 0 && (<>
        <h2>{t.stores}</h2>
        <div className="vb-dir-grid">
          {dir.stores.map((s) => (
            <a key={s.slug} href={`/s/${s.slug}`} className="vb-dir-card vb-dir-store">
              {s.doorImage
                // eslint-disable-next-line @next/next/no-img-element -- the store's own door photo
                ? <img src={s.doorImage} alt="" loading="lazy" className="vb-dir-door" />
                : <span className="vb-dir-door vb-dir-door-none" aria-hidden>🚪</span>}
              <span className="vb-dir-name">{nameIn(s.name)}</span>
              <span className="vb-dir-meta">{[s.category, placeName(s.place)].filter(Boolean).join(" · ")}</span>
            </a>
          ))}
        </div>
      </>)}
    </section>
  );
}
