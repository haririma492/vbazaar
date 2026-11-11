// vbazaar.app/tours — every store that is published or switched onto this page by the operator (`onTours`), for showing the bazaar to a new store (owner, 2026-11-10:
// "I am going to demo these ready stores to new prospects, add all existing published stores to vbazaar.app/tours
// just for the demo"). Each store: its door photo, its name, and one key per tour it has. Not indexed and not
// linked from the home page; the switch is «Show on the tours page» on the store's page.
import type { Metadata } from "next";
import TourBazaarLink from "@/components/brand/TourBazaarLink";
import { readTourStores } from "@/lib/stores/directory";
import { readTour } from "@/lib/stores/tourJob";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Store tours · Virtual Bazaar", robots: { index: false, follow: false } };

export default async function ToursPage() {
  const stores = await Promise.all((await readTourStores()).map(async (s) => ({ ...s, shelfTour: Boolean(await readTour(s.slug).catch(() => null)) })));
  stores.sort((a, b) => (a.name.en || a.name.fa).localeCompare(b.name.en || b.name.fa));
  return (
    <main dir="ltr" className="mx-auto min-h-screen max-w-6xl px-4 py-6 text-white sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-200 sm:text-3xl">Store tours · <span className="sk-font">گشت فروشگاه‌ها</span></h1>
          <p className="mt-1 text-[14px] text-white/60">
            {stores.length ? `${stores.length} store${stores.length === 1 ? "" : "s"} open in the Virtual Bazaar. Walk into any of them.` : "No store is on this page yet."}
          </p>
        </div>
        <TourBazaarLink />
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((s) => (
          <article key={s.slug} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            <a href={`/walk/${s.slug}`} className="block aspect-[4/3] bg-white/[0.06]">
              {s.doorImage
                // eslint-disable-next-line @next/next/no-img-element -- the store's own door photo
                ? <img src={s.doorImage} alt={s.name.en || s.name.fa} loading="lazy" className="h-full w-full object-cover" />
                : <span className="flex h-full w-full items-center justify-center text-5xl" aria-hidden>🚪</span>}
            </a>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <h2 className="text-[17px] font-bold leading-snug">
                {s.name.en || s.name.fa}
                {s.name.en && s.name.fa ? <span dir="rtl" className="sk-font block text-[15px] font-normal text-white/70">{s.name.fa}</span> : null}
              </h2>
              <p className="text-[13px] text-white/55">{s.category}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <a href={`/walk/${s.slug}`} className="inline-flex min-h-[44px] items-center rounded-full border border-amber-300/50 bg-amber-300/15 px-5 text-[15px] font-bold text-amber-100">👣 Free Tour</a>
                {s.shelfTour && <a href={`/vca/tour?s=${s.slug}`} className="inline-flex min-h-[44px] items-center rounded-full border border-white/20 px-5 text-[15px] font-bold text-white/85">🛒 Shelf Tour</a>}
              </div>
              <p className="text-[12px] text-white/40">vbazaar.app/walk/{s.slug}</p>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
