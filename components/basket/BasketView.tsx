"use client";

/**
 * The basket page (owner, 2026-11-03: "create a vbazaar.app basket"): what the
 * shopper picked up on the walks, by store, each store with its total, and
 * how many of each. No payment yet (CLAUDE.md: the basket is the end of the
 * cycle), and the page says so rather than offering a key that does nothing.
 */

import { useState } from "react";
import { byStore, countOf, money, priceCents } from "@/lib/basket";
import { useBasket } from "./useBasket";

type Lang = "fa" | "en";
const T = {
  title: { fa: "سبد خرید", en: "Basket" },
  items: { fa: (n: number) => `${n} قلم`, en: (n: number) => `${n} item${n === 1 ? "" : "s"}` },
  empty: { fa: "سبد خرید خالی است.", en: "Your basket is empty." },
  walk: { fa: "قدم زدن در بازار ←", en: "Walk the bazaar →" },
  back: { fa: "← بازگشت", en: "← Back" },
  subtotal: { fa: "جمع این فروشگاه", en: "Store total" },
  total: { fa: "جمع کل", en: "Total" },
  priceAtStore: { fa: (n: number) => `${n} قلم بدون قیمت: قیمت را فروشگاه می‌گوید`, en: (n: number) => `${n} without a price: the store gives it` },
  remove: { fa: "حذف", en: "Remove" },
  each: { fa: "هر عدد", en: "each" },
  clear: { fa: "خالی کردن سبد", en: "Empty the basket" },
  sure: { fa: "همه را از سبد بردارم؟", en: "Take everything out of the basket?" },
  noPay: {
    fa: "پرداخت آنلاین هنوز باز نیست. این فهرست روی همین دستگاه نگه داشته می‌شود؛ آن را در فروشگاه نشان دهید یا با فروشگاه تماس بگیرید.",
    en: "Online payment isn't open yet. This list is kept on this device: show it at the store, or call the store.",
  },
  seen: { fa: "دیدن در بازار", en: "See it in the bazaar" },
};

export default function BasketView() {
  const { lines, ready, setQty, clear } = useBasket();
  const [lang, setLang] = useState<Lang>("fa");
  const groups = byStore(lines, lang === "fa" ? "فروشگاه" : "Store");
  const total = groups.reduce((c, g) => c + g.cents, 0);
  const unpriced = groups.reduce((n, g) => n + g.unpriced, 0);

  return (
    <main dir={lang === "fa" ? "rtl" : "ltr"} className="min-h-screen bg-[#06131c] text-white">
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-5">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => (history.length > 1 ? history.back() : (window.location.href = "/vca/walk"))} className="text-[14px] text-[#00B8C8] underline">
            {T.back[lang]}
          </button>
          <button onClick={() => setLang(lang === "fa" ? "en" : "fa")} className="text-[13px] text-white/60 underline">
            {lang === "fa" ? "English" : "فارسی"}
          </button>
        </div>
        <h1 className="mt-4 text-[26px] font-extrabold">
          🛒 {T.title[lang]}
          {ready && lines.length > 0 && <span className="ms-2 text-[15px] font-normal text-white/60">{T.items[lang](countOf(lines))}</span>}
        </h1>

        {!ready ? null : lines.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <p className="text-[16px] text-white/80">{T.empty[lang]}</p>
            <a href="/vca/walk" className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-[#00B8C8] px-5 font-bold text-[#06131c]">{T.walk[lang]}</a>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.merchant} className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-3 sm:p-4">
                <h2 className="mb-2 text-[17px] font-bold text-amber-200">{g.merchant}</h2>
                <ul className="flex flex-col gap-2">
                  {g.lines.map((l) => {
                    const c = priceCents(l.price);
                    return (
                      <li key={l.id} className="flex gap-3 rounded-xl border border-white/10 bg-black p-2.5">
                        {l.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.imageUrl} alt="" className="h-[72px] w-[72px] shrink-0 rounded-lg bg-white object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
                        ) : (
                          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg bg-white/10 text-[26px] text-white/50">🛒</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div dir="auto" className="line-clamp-2 text-[15px] font-semibold leading-snug" style={{ textAlign: lang === "fa" ? "right" : "left" }}>{l.label}</div>
                          {l.sub && <div dir="auto" className="truncate text-[13px] text-white/55" style={{ textAlign: lang === "fa" ? "right" : "left" }}>{l.sub}</div>}
                          {c !== null && (
                            <div className="mt-0.5 text-[15px] font-black text-amber-200">
                              {money(c * l.qty)}
                              {l.qty > 1 && <span className="ms-1.5 text-[12px] font-normal text-white/50">({l.price} {T.each[lang]})</span>}
                            </div>
                          )}
                          <div className="mt-1.5 flex items-center gap-3">
                            <div dir="ltr" className="inline-flex items-center rounded-full border border-white/25">
                              <button aria-label="−" className="h-9 w-9 text-[18px]" onClick={() => setQty(l.id, l.qty - 1)}>{l.qty === 1 ? "🗑" : "−"}</button>
                              <span className="min-w-[2ch] text-center text-[15px] font-bold">{l.qty}</span>
                              <button aria-label="+" className="h-9 w-9 text-[18px]" onClick={() => setQty(l.id, l.qty + 1)}>+</button>
                            </div>
                            {l.qty > 1 && <button className="text-[13px] text-white/55 underline" onClick={() => setQty(l.id, 0)}>{T.remove[lang]}</button>}
                            {l.href && <a href={l.href} className="ms-auto text-[12px] text-[#00B8C8] underline">{T.seen[lang]}</a>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2.5 flex items-baseline justify-between border-t border-white/10 pt-2 text-[14px]">
                  <span className="text-white/70">{T.subtotal[lang]}</span>
                  <b className="text-[16px] text-amber-200">{g.cents === 0 && g.unpriced > 0 ? "—" : money(g.cents)}</b>
                </div>
                {g.unpriced > 0 && <div className="mt-1 text-[12px] text-white/50">{T.priceAtStore[lang](g.unpriced)}</div>}
              </section>
            ))}

            {groups.length > 1 && (
              <div className="mt-5 flex items-baseline justify-between rounded-2xl border border-amber-200/30 bg-black/40 px-4 py-3">
                <span className="text-[16px] font-bold">{T.total[lang]}</span>
                <b className="text-[20px] text-amber-200">{money(total)}{unpriced > 0 ? " +" : ""}</b>
              </div>
            )}
            <p className="mt-5 rounded-xl bg-white/[0.05] p-3 text-[13px] leading-relaxed text-white/70">{T.noPay[lang]}</p>
            <button className="mt-4 text-[13px] text-white/50 underline" onClick={() => { if (window.confirm(T.sure[lang])) clear(); }}>{T.clear[lang]}</button>
          </>
        )}
      </div>
    </main>
  );
}
