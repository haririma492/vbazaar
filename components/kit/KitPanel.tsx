"use client";

/**
 * THE SHOPPING PANEL (owner, 2026-11-15: "a list of prices and names appear on a rectangle on the top section on the
 * right and make them ready for adding to the basket, this panel is the e-commerce style shopping panel … we have
 * already transitioned from virtual tour … to e-commerce and can add to basket or close the panel and continue").
 * The products of ONE section (Type IV): each with its own photo (the operator's) and, when matched to the store's
 * website, the site's photo, name and price; a weight to choose for what is sold by the kilo; «Add to basket».
 * A product not matched yet shows its photo with «Price coming soon» and cannot be added. Farsi or English.
 * No zooming, no wheel: an ordinary shop's list. Placed by the screen that opens it (`className`).
 */
import { noSave } from "./noSave";
import Watermark from "./Watermark";
import { useEffect, useRef, useState } from "react";
import { addToBasket } from "@/components/basket/useBasket";
import { byWeight, formatCents, UNIT_SAY, weightChoices } from "@/lib/splats/catalogue";
import type { ShopProduct, ShopSection } from "@/lib/stores/kitRules";
import ShareKey from "./ShareKey";

export type Lang = "fa" | "en";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const fa = (s: string) => s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

function amountSay(a: number, unit: ShopProduct["unit"], lang: Lang) {
  const u = UNIT_SAY[unit][lang];
  if (unit === "kg" && a < 1) return lang === "fa" ? `${fa(String(a * 1000))} گرم` : `${a * 1000} g`;
  return lang === "fa" ? `${fa(String(a))} ${u}` : `${a} ${u}`;
}

function Row({ p, lang, merchant, href, share, lit }: { p: ShopProduct; lang: Lang; merchant: string; href?: string; share?: { base: string | null | undefined; shelf: string }; lit?: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (lit) ref.current?.scrollIntoView({ block: "center" }); }, [lit]);
  const weighed = byWeight(p.unit);
  const choices = weighed ? weightChoices(p.unit) : [1];
  const [amount, setAmount] = useState(() => (p.unit === "kg" ? 0.5 : choices.includes(1) ? 1 : choices[0]));
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(0);
  const [shown, setShown] = useState(0);
  const photos = [p.photo, ...p.more].filter(Boolean);
  const name = (lang === "fa" ? p.fa || p.en : p.en || p.fa) || (lang === "fa" ? "محصول" : "Product");
  const other = lang === "fa" ? p.en : p.fa;
  const priced = p.priceCents !== null;
  const unitSay = p.unit === "piece" ? (lang === "fa" ? "عدد" : "each") : UNIT_SAY[p.unit][lang];
  const total = priced ? Math.round(p.priceCents! * (weighed ? amount : 1)) * qty : null;
  // Every product can go in the basket, priced or not (owner, 2026-11-16: "let all products to be able to be added …
  // even those with no price (for proof of concept)"); the basket line then has no price.
  const add = () => {
    addToBasket({
      id: `kit:${p.id}${weighed ? `:${amount}` : ""}`,
      label: p.en || p.fa || "Product",
      sub: [p.fa && p.fa !== p.en ? p.fa : "", weighed ? amountSay(amount, p.unit, "en") : ""].filter(Boolean).join(" · ") || undefined,
      merchant,
      ...(priced ? { price: formatCents(Math.round(p.priceCents! * (weighed ? amount : 1))) } : {}),
      imageUrl: p.thumb || p.photo,
      href,
    }, qty);
    setAdded((n) => n + qty);
  };
  return (
    <li ref={ref} className={`flex gap-3 border-b border-black/10 py-3 last:border-0 ${lit ? "-mx-2 rounded-lg bg-amber-50 px-2 ring-2 ring-amber-400" : ""}`}>
      <div className="w-20 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="relative h-20 w-20 overflow-hidden rounded-lg">
          {photos.length
            ? <img {...noSave} src={photos[Math.min(shown, photos.length - 1)]} alt="" className="h-20 w-20 rounded-lg bg-white object-contain ring-1 ring-black/10" />
            : <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-neutral-100 text-[28px]">🛍️</div>}
          {photos.length > 0 && <Watermark size="xs" />}
        </div>
        {photos.length > 1 && (
          <div className="mt-1 flex gap-1">
            {photos.slice(0, 4).map((u, i) => (
              <button key={u} type="button" aria-label={`Photo ${i + 1}`} onClick={() => setShown(i)}
                className={`h-[18px] w-[18px] overflow-hidden rounded bg-white ${i === shown ? "ring-2 ring-amber-500" : "opacity-60 ring-1 ring-black/10"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img {...noSave} src={u} alt="" loading="lazy" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-snug text-neutral-900">{name}</p>
        {other && other !== name && <p className="text-[12px] text-neutral-500">{other}</p>}
        {priced
          ? <p className="mt-0.5 text-[15px] font-extrabold text-emerald-700">{lang === "fa" ? fa(formatCents(p.priceCents!)) : formatCents(p.priceCents!)} <span className="text-[12px] font-normal text-neutral-500">/ {unitSay}</span></p>
          : <p className="mt-0.5 text-[13px] font-semibold text-neutral-500">{lang === "fa" ? "قیمت به‌زودی" : "Price coming soon"}</p>}
        {share && <ShareKey base={share.base} to={{ shelf: share.shelf, product: p.id }} title={name} lang={lang} className="mt-1" />}
        {p.note && <p dir="auto" className="mt-1 line-clamp-2 text-[12px] leading-snug text-neutral-600">{p.note}</p>}
        {(
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {weighed && (
              <select value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label={lang === "fa" ? "مقدار" : "Amount"}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[13px] text-neutral-900">
                {choices.map((a) => <option key={a} value={a}>{amountSay(a, p.unit, lang)}</option>)}
              </select>
            )}
            <div className="flex items-center rounded-md border border-neutral-300 text-[14px] text-neutral-900">
              <button type="button" className="px-2 py-0.5" aria-label="−" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="min-w-[1.5rem] text-center">{lang === "fa" ? fa(String(qty)) : qty}</span>
              <button type="button" className="px-2 py-0.5" aria-label="+" onClick={() => setQty((q) => Math.min(99, q + 1))}>+</button>
            </div>
            <button type="button" onClick={add} className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-bold text-white shadow hover:bg-emerald-700">
              {lang === "fa" ? "افزودن به سبد" : "Add to basket"}{total !== null ? ` · ${lang === "fa" ? fa(formatCents(total)) : formatCents(total)}` : ""}
            </button>
            {added > 0 && <span className="text-[12px] font-semibold text-emerald-700">✓ {lang === "fa" ? `${fa(String(added))} در سبد` : `${added} in basket`}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

export default function KitPanel({ section, title, merchant, href, lang, onLang, onClose, className = "", share, highlight }: {
  section: ShopSection;
  /** The shelf's name, shown at the top. */
  title: { en: string; fa: string };
  merchant: string;
  href?: string;
  lang: Lang;
  onLang: (l: Lang) => void;
  onClose: () => void;
  className?: string;
  /** Share keys: the walk's address (`ShopKit.link`) and the section's shelf id. None: no share keys. */
  share?: { base: string | null | undefined; shelf: string };
  /** A product opened from a shared link: shown lit, scrolled to. */
  highlight?: string;
}) {
  const products = section.products;
  return (
    <div dir={lang === "fa" ? "rtl" : "ltr"} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      className={`flex flex-col overflow-hidden rounded-2xl bg-white text-neutral-900 shadow-2xl ring-1 ring-black/10 ${className}`}>
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold">{lang === "fa" ? title.fa : title.en}</p>
          <p className="truncate text-[12px] text-neutral-500">{merchant} · {section.i > 0 ? (lang === "fa" ? `بخش ${fa(String(section.i))}` : `Section ${section.i}`) : (lang === "fa" ? "همهٔ بخش‌ها" : "All sections")}</p>
        </div>
        {share && <ShareKey base={share.base} to={section.i > 0 ? { shelf: share.shelf, section: section.i } : { shelf: share.shelf }} title={lang === "fa" ? title.fa : title.en} lang={lang} />}
        <button type="button" onClick={() => onLang(lang === "fa" ? "en" : "fa")} className="rounded-md border border-neutral-300 px-2 py-1 text-[12px]">{lang === "fa" ? "English" : "فارسی"}</button>
        <a href="/basket" className="rounded-md border border-neutral-300 px-2 py-1 text-[12px]">🧺 {lang === "fa" ? "سبد" : "Basket"}</a>
        <button type="button" onClick={onClose} aria-label={lang === "fa" ? "بستن" : "Close"} className="rounded-full px-2 text-[22px] leading-none text-neutral-500 hover:text-neutral-900">×</button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        {products.map((p) => <Row key={p.id} p={p} lang={lang} merchant={merchant} href={href} share={share} lit={p.id === highlight} />)}
        {!products.length && <li className="py-6 text-center text-[13px] text-neutral-500">{lang === "fa" ? "محصولات این بخش به‌زودی." : "This section's products are coming soon."}</li>}
      </ul>
    </div>
  );
}
