"use client";

/**
 * ITEMS YOU CAN PICK UP — the card a shopper opens from an item's dot, and the
 * operator's editor that puts the dots there (founder, 2026-10-12: "add hot
 * spot in this test .mp4 video to pick up some items to add to basket").
 *
 * The dots themselves are drawn by the walk's engine (`Walk360.tsx`); the
 * items live with the doors in `scenes/walks.json` (`lib/splats/walks.ts`).
 *
 * ⚠️ THE SAME BASKET AS THE REST OF THE SITE: the card's key is
 * `AddToListKey`, so a walk's item obeys the basket's own rules (meat first,
 * the toggle, the limit) and shows up on /basket under the shop's name.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { followProduct, followProduct360 } from "./followProduct";
import { basketAddHref, offerItemId, sarekoocheHref, type BasketLine } from "@/lib/sarekooche";
import {
  addItem, isPinned, isSiteUrl, itemTime, removeItem, setTitle, sortItemPins, updateItem, walkOf,
  type ItemPin, type Walk, type WalkItem, type Walks,
} from "@/lib/splats/walks";
import {
  UNITS, UNIT_SAY, byWeight, formatCents, nextNumber, parseSheet, priceOf, productName, productOf, readPrice,
  unitPriceSay, weightChoices, type Catalogue, type Product, type Unit,
} from "@/lib/splats/catalogue";
import { readXlsx } from "@/lib/splats/xlsx";

type Lang = "fa" | "en";

/** The minimal engine the editor drives (`Walk360.tsx`'s `Engine`). */
export type ItemEngine = {
  here: () => { key: string | null; t: number; flat: boolean; projection?: "equirect" | "eac" | "flat" | null };
  setItemPick: (f: ((pin: ItemPin) => void) | null) => void;
  setItemPreview: (item: WalkItem | null) => void;
  seek: (t: number) => void;
  video: () => HTMLVideoElement;
};

/** The scene id of a walk key: `scenes/<scene>/<file>.mp4` → `<scene>`. */
const sceneOf = (key: string) => key.split("/")[1] ?? key;

/** The shop a walk's items are from, in this language. */
function shopName(walkKey: string, walk: Walk | null, lang: Lang): string {
  const t = walk?.title;
  if (!t) return sceneOf(walkKey);
  return lang === "fa" && t.fa ? t.fa : t.en;
}

/** «1.5» → «1.5», 0.25 → «0.25»: a weight as written on a line. */
const amountSay = (a: number) => String(Math.round(a * 1000) / 1000);

/**
 * The basket line for an item on a walk. With its product in the store's list,
 * the list's name, price and photo; a weighed product is a line of that weight
 * at that weight's price («پسته · 1.5 lb — $19.49»), so the basket needs no
 * notion of weight. Without the list, what the item was tagged with.
 */
export function itemLine(item: WalkItem, walkKey: string, walk: Walk | null, lang: Lang, product?: Product, amount = 1): BasketLine {
  const href = `/vca/walk?v=${encodeURIComponent(walkKey)}`;
  const merchant = shopName(walkKey, walk, lang);
  if (product) {
    const weighed = byWeight(product.unit);
    const name = productName(product, lang);
    const other = productName(product, lang === "fa" ? "en" : "fa");
    // On special: the special price (per unit, so a weighed one times the weight).
    const specialCents = item.special ? readPrice(item.special.now) : null;
    const cents = specialCents !== null ? Math.round(specialCents * (weighed ? amount : 1)) : priceOf(product, weighed ? amount : 1);
    const unit = UNIT_SAY[product.unit][lang];
    return {
      id: offerItemId(`walk-${sceneOf(walkKey)}-n${product.n}${weighed ? `-${amountSay(amount)}${product.unit}` : ""}`),
      kind: "offer",
      label: weighed ? `${name} · ${amountSay(amount)} ${unit}` : name,
      ...(other !== name ? { sub: `${other}${product.sku ? ` · #${product.sku}` : ""}` } : product.sku ? { sub: `#${product.sku}` } : {}),
      merchant,
      ...(cents !== null ? { price: formatCents(cents) } : {}),
      ...(product.photo ? { imageUrl: product.photo } : {}),
      href,
    };
  }
  const fa = item.label.fa;
  return {
    id: offerItemId(`walk-${sceneOf(walkKey)}-${item.id}`),
    kind: "offer",
    label: lang === "fa" && fa ? fa : item.label.en,
    ...(fa ? { sub: lang === "fa" ? item.label.en : fa } : {}),
    merchant,
    ...(item.special ? { price: item.special.now } : item.price ? { price: item.price } : {}),
    ...(item.image ? { imageUrl: item.image } : {}),
    href,
  };
}

/** The demo without internet (`npm run offline` builds with it): the basket is kept on this device. */
const OFFLINE = process.env.NEXT_PUBLIC_OFFLINE === "1";

/** A line added to the offline basket; how many lines it now holds. */
function addOfflineLine(line: BasketLine): number {
  try {
    const all = JSON.parse(window.localStorage.getItem("offline-basket") ?? "[]") as BasketLine[];
    all.push(line);
    window.localStorage.setItem("offline-basket", JSON.stringify(all));
    return all.length;
  } catch {
    return 1;
  }
}

/** The card a tap on an item's dot opens: photo, name, price — a weight to choose for weighed goods — and «Add to Basket». */
export function ItemCard({ item, walkKey, walk, catalogue, onClose }: {
  item: WalkItem;
  walkKey: string;
  walk: Walk | null;
  catalogue: Catalogue | null;
  onClose: () => void;
}) {
  const [added, setAdded] = useState(0);
  // Opens in English (founder, 2026-10-18: «افزودن به سبد سرکوچه» → "make this label english"); «فارسی» switches.
  const [lang, setLang] = useState<Lang>("en");
  const product = productOf(catalogue, item.n);
  const weighed = Boolean(product && byWeight(product.unit));
  const choices = product ? weightChoices(product.unit) : [1];
  const [amount, setAmount] = useState(() => (choices.includes(1) ? 1 : choices[Math.floor(choices.length / 2)]));
  const name = product ? productName(product, lang) : lang === "fa" && item.label.fa ? item.label.fa : item.label.en;
  const other = product ? productName(product, lang === "fa" ? "en" : "fa") : item.label.fa ? (lang === "fa" ? item.label.en : item.label.fa) : "";
  const photo = product ? product.photo : item.image;
  const specialCents = item.special ? readPrice(item.special.now) : null;
  const total = product ? (specialCents !== null ? Math.round(specialCents * (weighed ? amount : 1)) : priceOf(product, weighed ? amount : 1)) : null;
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        dir={lang === "fa" ? "rtl" : "ltr"}
        className="w-full max-w-sm rounded-t-2xl border border-white/15 bg-[#14171c] p-4 text-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- hot-linked, as basket lines are
            <img src={photo} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className="h-24 w-24 shrink-0 rounded-xl bg-white object-contain" />
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[34px] text-white/60">🛒</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold leading-snug">{name}</div>
            {other && other !== name && <div className="text-[14px] text-white/65">{other}</div>}
            <div className="mt-1 text-[13px] text-white/55">
              {shopName(walkKey, walk, lang)}{product?.sku ? ` · ${lang === "fa" ? "کد" : "No."} ${product.sku}` : ""}
            </div>
            {item.special ? (
              // On special: English only (founder).
              <div dir="ltr" className="mt-1.5 inline-flex flex-col rounded-xl bg-[#d61424] px-3 py-1.5 text-white">
                <span className="text-[13px] font-black tracking-wide text-[#ffe14d]">SPECIAL</span>
                <span className="text-[14px] text-white/80 line-through">{item.special.was}</span>
                <span className="text-[24px] font-black leading-tight">{item.special.now}{product && byWeight(product.unit) ? ` / ${product.unit}` : ""}</span>
              </div>
            ) : product ? (
              <div className="mt-1.5 text-[17px] font-bold text-amber-200">{unitPriceSay(product, lang)}</div>
            ) : item.price ? (
              <div className="mt-1.5 text-[20px] font-extrabold text-amber-200">{item.price}</div>
            ) : null}
          </div>
          <button className="rounded-full px-2 text-[20px] text-white/60" aria-label={lang === "fa" ? "بستن" : "Close"} onClick={onClose}>×</button>
        </div>
        {product && weighed && (
          <div className="mt-3">
            <div className="mb-1.5 text-[13px] text-white/65">{lang === "fa" ? "چقدر؟" : "How much?"}</div>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((a) => (
                <button key={a} onClick={() => setAmount(a)}
                  className={`rounded-full border px-3 py-1.5 text-[14px] ${a === amount ? "border-[#00B8C8] bg-[#00B8C8]/25 font-bold" : "border-white/25"}`}>
                  {amountSay(a)} {UNIT_SAY[product.unit][lang]}
                </button>
              ))}
            </div>
            {total !== null && (
              <div className="mt-2 text-[15px]">
                {amountSay(amount)} {UNIT_SAY[product.unit][lang]} = <b className="text-amber-200">{formatCents(total)}</b>
              </div>
            )}
          </div>
        )}
        {/* The basket is Sarekooche's, on its own site (`lib/sarekooche.ts`): a new
            tab, so the walk stays where the shopper stood. Offline (the demo
            without internet, `npm run offline`) there is no site to reach: the
            line is kept on this device and the card says so. */}
        {OFFLINE ? (
          <button
            onClick={() => setAdded(addOfflineLine(itemLine(item, walkKey, walk, lang, product, amount)))}
            className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-full bg-[#00B8C8] px-4 text-[15px] font-bold text-[#06131c]"
          >
            {added ? `✓ Added — ${added} in the basket` : lang === "fa" ? "افزودن به سبد" : "Add to basket"}
          </button>
        ) : (
        <a
          href={basketAddHref(itemLine(item, walkKey, walk, lang, product, amount), typeof window !== "undefined" ? window.location.origin : "https://olgoo.com")}
          target="_blank"
          rel="noopener"
          className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-full bg-[#00B8C8] px-4 text-[15px] font-bold text-[#06131c]"
        >
          {lang === "fa" ? "افزودن به سبد" : "Add to basket"}
        </a>
        )}
        <div className="mt-3 flex items-center justify-between text-[13px]">
          {OFFLINE ? <span /> : <a href={sarekoocheHref("/basket")} target="_blank" rel="noopener" className="text-[#00B8C8] underline">{lang === "fa" ? "سبد خرید ←" : "Basket →"}</a>}
          <button className="text-white/55 underline" onClick={() => setLang(lang === "fa" ? "en" : "fa")}>{lang === "fa" ? "English" : "فارسی"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * TAGGING A PRODUCT, ONE QUESTION AT A TIME (founder, 2026-10-12: "first ask
 * if this is a product, then start asking other questions ONE by ONE (with
 * back option)"), and with the store's product list, ONLY ITS NUMBER (founder,
 * 2026-10-12: "enter ONLY ONLY one information (the temp sarekooche number
 * 1-999) … the code get all the rest of info from our uploaded sheet").
 *
 *   with the list:   Is this a product? → Its number? (shows that product) → the dot follows it → Done
 *   by hand:         … → name → Farsi name → sold by → price → photo → the dot → Done
 *
 * A product added by hand joins the store's list with the next free number
 * (founder: "the option to add single item (in addition to bulk item) will
 * also exist"), so both live in one list.
 */
type Step = "product" | "number" | "en" | "fa" | "unit" | "price" | "photo" | "follow";
const LIST_STEPS: Step[] = ["product", "number", "follow"];
const HAND_STEPS: Step[] = ["product", "en", "fa", "unit", "price", "photo", "follow"];
const mmssTenth = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;

type Draft = {
  id?: string;
  /** «list»: by its number in the store's list; «hand»: typed in here. */
  path: "list" | "hand";
  num: string;
  en: string; fa: string; unit: Unit | ""; price: string; image: string;
  pins: ItemPin[];
  step: Step;
};

const draftItem = (d: Draft, catalogue: Catalogue | null): WalkItem => {
  const p = d.path === "list" ? productOf(catalogue, Number(d.num)) : undefined;
  const en = p ? productName(p, "en") : d.en.trim() || "Product";
  const fa = p ? p.fa : d.fa.trim();
  return { id: d.id ?? "__draft", label: fa ? { en, fa } : { en }, pins: d.pins };
};

/** Taps on the picture are pins only on these steps (and before a product is started). */
const TAPS_ON: Step[] = ["product", "follow"];

/**
 * The operator's products on this walk: the store's list (upload the sheet),
 * «tap a product», the one-question card, and the list of what is tagged. It
 * edits `walks` (the editor saves) and saves the store's list itself.
 */
export function ItemsEditor({ engine, walks, viewKey, change, setStatus, store, catalogue, saveCatalogue }: {
  engine: React.MutableRefObject<ItemEngine | null>;
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
  setStatus: (s: { tone: "ok" | "warn" | "bad"; text: string } | null) => void;
  /** The store this video belongs to (`storeOfScene`). */
  store: string;
  catalogue: Catalogue | null;
  /** Saves the store's list; resolves to null when saved, or why not. */
  saveCatalogue: (c: Catalogue) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  /** A product picked on the left panel before tapping: the next tap in the picture is it. */
  const [armed, setArmed] = useState<number | null>(null);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const [shopOpen, setShopOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetImport | null>(null);
  /** A tagged product being pinned to itself (its one tap followed through the video), and how far. */
  const [pinning, setPinning] = useState<{ id: string; done: number; total: number } | null>(null);
  const walksRef = useRef(walks);
  walksRef.current = walks;
  /**
   * 📌 PIN TO THE PRODUCT (founder, 2026-10-18: "the special tag moves with
   * us … why it follows us"): a product tagged with one tap — before
   * following came to 360° walks, or when it failed — is followed from that
   * tap and saved, without going through «Edit».
   */
  async function pinToProduct(it: WalkItem) {
    const e = engine.current;
    if (!e || !viewKey || pinning) return;
    const src = e.video().currentSrc;
    if (!src) return setStatus({ tone: "bad", text: "The video is not loaded yet: wait a moment and try again." });
    const here = e.here();
    const start = it.pins[it.pins.length >> 1];
    const sig = { cancelled: false };
    setPinning({ id: it.id, done: 0, total: 1 });
    try {
      const onProgress = (p: { done: number; total: number }) => setPinning({ id: it.id, ...p });
      const pins = here.flat
        ? await followProduct(src, start, onProgress, sig)
        : await followProduct360(src, start, here.projection === "eac" ? "eac" : "equirect", onProgress, sig);
      if (pins.length < 3) throw new Error("it was lost at once — tap it again where it is clearer, with «Edit»");
      change(updateItem(walksRef.current, viewKey, it.id, { pins }));
      setStatus({ tone: "ok", text: `📌 «${it.label.en}» is pinned to the product from ${mmss(pins[0].t)} to ${mmss(pins[pins.length - 1].t)} — saving…` });
    } catch (err) {
      setStatus({ tone: "bad", text: `Not pinned: ${(err as Error).message}. Use «Edit» and tap the product two or three times as the video moves.` });
    } finally {
      setPinning(null);
    }
  }
  /** The product being put on special: its two questions, one card each. */
  const [special, setSpecial] = useState<SpecialDraft | null>(null);
  const walk = walkOf(walks, viewKey);
  const hasList = Boolean(catalogue?.products.length);

  // ⚠️ THE DOT FOLLOWS THE PRODUCT BY ITSELF (founder, 2026-10-12: "the dot
  // moves with shopper, instead of being pinned to the product … the single
  // most important issue"). Each tap starts a follow — `followProduct` on a
  // flat phone video, `followProduct360` on a 360° walk (2026-10-18: "the label
  // need to be pined on the product … not moved with shoppers"): the first
  // places the dot for every step the product is in view; a later tap
  // re-follows from there and replaces that stretch.
  const [follow, setFollow] = useState<Follow | null>(null);
  const run = useRef<{ cancelled: boolean } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  function startFollow(pin: ItemPin, replace: boolean) {
    const e = engine.current;
    if (run.current) run.current.cancelled = true;
    run.current = null;
    if (!e || !e.video().currentSrc) { setFollow(null); return; }
    const here = e.here();
    const sig = { cancelled: false };
    run.current = sig;
    setFollow({ running: true, done: 0, total: 1 });
    const onProgress = (p: { done: number; total: number }) => { if (!sig.cancelled) setFollow({ running: true, ...p }); };
    // A flat phone video: the patch in the frame; a 360° walk: the patch in a view cut around the product (2026-10-18).
    (here.flat
      ? followProduct(e.video().currentSrc, pin, onProgress, sig)
      : followProduct360(e.video().currentSrc, pin, here.projection === "eac" ? "eac" : "equirect", onProgress, sig))
      .then((pins) => {
        if (sig.cancelled) return;
        const lo = pins[0].t - 0.05, hi = pins[pins.length - 1].t + 0.05;
        setDraft((d) => (d ? { ...d, pins: replace ? pins : sortItemPins([...d.pins.filter((q) => q.t < lo || q.t > hi), ...pins]) } : d));
        setFollow({ running: false, done: 1, total: 1 });
      })
      .catch((err: Error) => {
        if (sig.cancelled) return;
        setFollow({ running: false, done: 0, total: 0, error: err.message || "It could not be followed." });
      });
  }
  // A product put away (Done, No, Back out): stop following it.
  useEffect(() => {
    if (!draft && run.current) { run.current.cancelled = true; run.current = null; setFollow(null); }
  }, [draft]);

  // Taps on the picture: the first starts a product; on «Is this a product?» a
  // tap moves its dot; on the last step a tap re-follows from there.
  const tapsOn = !sheet && (!draft || TAPS_ON.includes(draft.step));
  const listRef = useRef(hasList);
  listRef.current = hasList;
  useEffect(() => {
    const e = engine.current;
    if (!e || !viewKey) return;
    e.setItemPick(tapsOn ? (pin) => {
      e.video().pause();
      const d = draftRef.current;
      const fresh = !d || d.step === "product";
      setDraft((cur) => {
        const n = armedRef.current;
        if (!cur && n !== null) return { path: "list", num: String(n), en: "", fa: "", unit: "", price: "", image: "", pins: [pin], step: "follow" };
        if (!cur) return { path: listRef.current ? "list" : "hand", num: "", en: "", fa: "", unit: "", price: "", image: "", pins: [pin], step: "product" };
        if (cur.step === "product") return { ...cur, pins: [pin] };
        return { ...cur, pins: sortItemPins([...cur.pins.filter((q) => Math.abs(q.t - pin.t) >= 0.05), pin]) };
      });
      if (!d && armedRef.current !== null) setArmed(null);
      startFollow(pin, fresh);
    } : null);
    return () => e.setItemPick(null);
  }, [engine, tapsOn, viewKey]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setItemPreview(draft && draft.pins.length ? draftItem(draft, catalogue) : null);
    return () => e.setItemPreview(null);
  }, [engine, draft, catalogue]);

  async function finish() {
    if (!draft || !viewKey) return;
    const pins = draft.pins.map((q) => ({ t: Math.round(q.t * 100) / 100, x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 }));
    const put = (fields: Omit<WalkItem, "id">) => {
      if (draft.id) change(updateItem(walks, viewKey, draft.id, { price: undefined, image: undefined, n: undefined, ...fields }));
      else change(addItem(walks, viewKey, fields));
    };
    if (draft.path === "list") {
      const p = productOf(catalogue, Number(draft.num));
      if (!p) return;
      put({ label: p.fa ? { en: productName(p, "en"), fa: p.fa } : { en: productName(p, "en") }, n: p.n, pins });
      setStatus({ tone: "ok", text: `#${p.n} ${productName(p, "en")} tagged — saving…` });
      setDraft(null);
      return;
    }
    // By hand: the product joins the store's list (its number kept when editing one).
    const en = draft.en.trim(), fa = draft.fa.trim(), image = draft.image.trim();
    const label = fa ? { en, fa } : { en };
    const editing = draft.id ? walk?.items?.find((i) => i.id === draft.id) : undefined;
    const n = editing?.n && productOf(catalogue, editing.n)?.by === "hand" ? editing.n : nextNumber(catalogue);
    const snapshot = { label, pins, ...(draft.price.trim() ? { price: draft.price.trim() } : {}), ...(image ? { image } : {}) };
    if (n === null) {
      put(snapshot);
      setStatus({ tone: "warn", text: `«${en}» tagged, but the store's list is full (999 numbers) — it is not in the list.` });
      setDraft(null);
      return;
    }
    const product: Product = {
      n, unit: (draft.unit || "piece") as Unit, priceCents: readPrice(draft.price), by: "hand",
      en, ...(fa ? { fa } : {}), ...(image ? { photo: image } : {}),
    };
    const products = [...(catalogue?.products ?? []).filter((p) => p.n !== n), product].sort((a, b) => a.n - b.n);
    setDraft(null);
    const why = await saveCatalogue({ store, products });
    if (why) {
      put(snapshot);
      setStatus({ tone: "bad", text: `«${en}» tagged on the walk, but not added to the store's list: ${why}` });
      return;
    }
    put({ label, n, pins });
    setStatus({ tone: "ok", text: `«${en}» added to the store's list as #${n} and tagged — saving…` });
  }

  async function onSheet(file: File) {
    try {
      const rows = readXlsx(new Uint8Array(await file.arrayBuffer()));
      const { products, problems } = parseSheet(rows);
      setSheet({ file: file.name, products, problems });
    } catch (e) {
      setSheet({ file: file.name, products: [], problems: [(e as Error).message] });
    }
  }

  async function useSheet() {
    if (!sheet) return;
    const numbers = new Set(sheet.products.map((p) => p.n));
    const hand = (catalogue?.products ?? []).filter((p) => p.by === "hand" && !numbers.has(p.n));
    const products = [...sheet.products, ...hand].sort((a, b) => a.n - b.n);
    setStatus({ tone: "ok", text: "Saving the product list…" });
    const why = await saveCatalogue({ store, products });
    if (why) return setStatus({ tone: "bad", text: `The product list was not saved: ${why}` });
    setSheet(null);
    setStatus({ tone: "ok", text: `✓ ${sheet.products.length} products from «${sheet.file}»${hand.length ? ` (and ${hand.length} added by hand)` : ""} — tag them by number now.` });
  }

  /** A product chosen on the left panel: names the product being tagged, or the next tap's. */
  function pickFromPanel(n: number) {
    const d = draftRef.current;
    if (d && d.path === "list" && (d.step === "product" || d.step === "number")) {
      setDraft({ ...d, num: String(n), step: "follow" });
      return;
    }
    if (d) return setStatus({ tone: "warn", text: "Finish or close the product being tagged first." });
    setArmed((a) => (a === n ? null : n));
  }
  const counts = new Map<number, number>();
  for (const it of walk?.items ?? []) if (it.n !== undefined) counts.set(it.n, (counts.get(it.n) ?? 0) + 1);
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(anchor.current?.closest<HTMLElement>("[data-walk-editor]")?.parentElement ?? null); }, []);
  const armedProduct = armed !== null ? productOf(catalogue, armed) : undefined;

  const fileInput = useRef<HTMLInputElement>(null);
  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const field = "w-full rounded-md border border-white/20 bg-black/50 px-2 py-1 text-[13px] text-white";
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <div className="space-y-2">
      <span ref={anchor} hidden />
      {host && hasList && createPortal(
        <ProductsPanel catalogue={catalogue!} counts={counts}
          chosen={draft?.path === "list" && draft.num ? Number(draft.num) : armed} onPick={pickFromPanel} />, host)}
      {armedProduct && !draft && (
        <div className="flex items-center gap-2 rounded-lg border border-[#00B8C8] bg-[#00B8C8]/20 p-2 text-[13px]">
          <span className="min-w-0 flex-1"><b>Now tap #{armedProduct.n} {productName(armedProduct, "en")}</b> in the picture.</span>
          <button className={btn} onClick={() => setArmed(null)}>Cancel</button>
        </div>
      )}
      {/* The store's product list: the merchant's sheet. */}
      <div className="rounded-md bg-white/5 p-1.5 text-[12px]">
        <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onSheet(f); }} />
        {hasList ? (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">Product list: <b>{catalogue!.products.length}</b> products · <span className="text-white/55">{store}</span></span>
            <button className={btn} onClick={() => fileInput.current?.click()}>Replace sheet</button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-white/70">No product list for <b>{store}</b> yet. With the merchant&apos;s sheet you tag each product by its number only.</div>
            <button className={`${btn} w-full py-1.5`} onClick={() => fileInput.current?.click()}>Upload the store&apos;s sheet (.xlsx)</button>
          </div>
        )}
      </div>

      {/* The shop's name: the basket lists its products under it. Folded away once set. */}
      <div className="rounded-md bg-white/5 p-1.5 text-[12px]">
        {!shopOpen && walk?.title ? (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">Shop: <b>{walk.title.en}</b>{walk.title.fa ? ` · ${walk.title.fa}` : ""}</span>
            <button className={btn} onClick={() => setShopOpen(true)}>Change</button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-white/60">Shop name (the basket lists its products under it)</div>
            <div className="flex gap-1.5">
              <input className={field} placeholder="Ali's Market" defaultValue={walk?.title?.en ?? ""} key={`en-${viewKey}`}
                onBlur={(e) => viewKey && e.target.value.trim() !== (walk?.title?.en ?? "") && change(setTitle(walks, viewKey, { en: e.target.value, fa: walk?.title?.fa ?? "" }))} />
              <input className={field} dir="rtl" placeholder="بازار علی" defaultValue={walk?.title?.fa ?? ""} key={`fa-${viewKey}`}
                onBlur={(e) => viewKey && e.target.value.trim() !== (walk?.title?.fa ?? "") && change(setTitle(walks, viewKey, { en: walk?.title?.en ?? "", fa: e.target.value }))} />
            </div>
            {walk?.title && <button className={btn} onClick={() => setShopOpen(false)}>Done</button>}
          </div>
        )}
      </div>

      {!draft && !armedProduct && (
        <div className="rounded-lg border border-[#00B8C8]/60 bg-[#00B8C8]/15 p-2.5 text-[13px] leading-snug">
          <b>Tap a product in the picture</b> to tag it{hasList ? <>, or <b>pick its photo on the left</b> first, then tap it</> : null}.
          <div className="mt-0.5 text-[12px] text-white/65">Move the video (wheel ▲, or the time bar) until the product is in view, then tap it.</div>
        </div>
      )}

      <ul className="space-y-1">
        {(walk?.items ?? []).map((it) => {
          const p = productOf(catalogue, it.n);
          return (
            <li key={it.id} className="rounded-md bg-white/5 p-1.5">
              <div className="truncate">
                <span className="font-mono text-white/60">{mmss(itemTime(it))}</span>{" "}
                {it.n !== undefined && <b className="text-[#00B8C8]">#{it.n} </b>}
                {p ? productName(p, "en") : it.label.en}
                {(p?.fa ?? it.label.fa) && <span className="text-white/60"> · {p?.fa ?? it.label.fa}</span>}
                {p ? <span className="text-amber-200"> · {unitPriceSay(p, "en")}</span> : it.price && <span className="text-amber-200"> · {it.price}</span>}
                {it.special && <span className="ms-1 rounded bg-[#d61424] px-1 text-[11px] font-bold text-white">SPECIAL {it.special.now}</span>}
                {it.n !== undefined && !p && <span className="text-rose-300"> · not in the list</span>}
                {!it.pins.length && <span className="text-rose-300"> · no dot</span>}
                {it.pins.length > 0 && !isPinned(it) && <span className="text-amber-300"> · not pinned to the product</span>}
              </div>
              <div className="mt-1 flex gap-1.5">
                <button className={btn} onClick={() => engine.current?.seek(itemTime(it))}>Go to</button>
                {it.pins.length > 0 && !isPinned(it) && (
                  <button className={`${btn} border-amber-300/70`} disabled={Boolean(pinning || draft)} onClick={() => void pinToProduct(it)}>
                    {pinning?.id === it.id ? `Pinning… ${Math.round((100 * pinning.done) / Math.max(1, pinning.total))}%` : "📌 Pin to the product"}
                  </button>
                )}
                <button className={btn} disabled={Boolean(draft)} onClick={() => {
                  engine.current?.seek(itemTime(it));
                  const hand = !p || p.by === "hand" || !hasList;
                  setDraft({
                    id: it.id, path: hand ? "hand" : "list", num: it.n !== undefined ? String(it.n) : "",
                    en: p?.en ?? it.label.en, fa: p?.fa ?? it.label.fa ?? "", unit: p?.unit ?? "",
                    price: p && p.priceCents !== null ? (p.priceCents / 100).toFixed(2) : it.price ?? "", image: p?.photo ?? it.image ?? "",
                    pins: it.pins, step: hand ? "en" : "number",
                  });
                }}>Edit</button>
                <button className={btn} disabled={Boolean(draft)} onClick={() => setSpecial({
                  id: it.id, name: p ? productName(p, "en") : it.label.en, step: "was",
                  was: it.special?.was ?? (p && p.priceCents !== null ? formatCents(p.priceCents) : it.price ?? ""), now: it.special?.now ?? "",
                  on: Boolean(it.special),
                })}>{it.special ? "★ Special" : "☆ Put on special"}</button>
                <button className={btn} onClick={() => { if (viewKey && window.confirm(`Delete «${it.label.en}» from this video?`)) change(removeItem(walks, viewKey, it.id)); }}>Delete</button>
              </div>
            </li>
          );
        })}
        {walk && !(walk.items ?? []).length && !draft && <li className="text-white/50">No products tagged on this video yet.</li>}
      </ul>

      {special && viewKey && (
        <SpecialCard draft={special} setDraft={setSpecial} onDone={(sp) => {
          change(updateItem(walks, viewKey, special.id, { special: sp ?? undefined }));
          setStatus({ tone: "ok", text: sp ? `«${special.name}» is on special: ${sp.was} → ${sp.now}.` : `«${special.name}» is no longer on special.` });
          setSpecial(null);
        }} />
      )}
      {draft && !sheet && <TagCard draft={draft} setDraft={setDraft} onDone={() => void finish()} follow={follow} catalogue={catalogue} />}
      {sheet && <SheetCard sheet={sheet} kept={(catalogue?.products ?? []).filter((p) => p.by === "hand" && !sheet.products.some((q) => q.n === p.n)).length} onUse={() => void useSheet()} onCancel={() => setSheet(null)} />}
    </div>
  );
}

type SpecialDraft = { id: string; name: string; step: "was" | "now"; was: string; now: string; on: boolean };

/**
 * PUTTING A PRODUCT ON SPECIAL, ONE QUESTION AT A TIME (founder, 2026-10-18):
 * its price before the special → the special price → saved by the editor.
 * Shoppers then see a big red SPECIAL badge with the old price crossed out,
 * and hear it said in English as they pass (`specialSay`).
 */
function SpecialCard({ draft, setDraft, onDone }: {
  draft: SpecialDraft;
  setDraft: (d: SpecialDraft | null) => void;
  onDone: (special: { was: string; now: string } | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const primary = "rounded-xl bg-[#00B8C8] px-5 py-2.5 text-[15px] font-bold text-black";
  const quiet = "rounded-xl border border-white/25 px-4 py-2.5 text-[14px] text-white/85";
  const big = "w-full rounded-xl border border-white/25 bg-black/60 px-3 py-2.5 text-[18px] text-white";
  // «12.99» → «$12.99»; «2/$5» as written.
  const money = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? `$${Number(v.trim()).toFixed(2)}` : v.trim());
  const isWas = draft.step === "was";
  const value = isWas ? draft.was : draft.now;
  const next = () => {
    const v = value.trim();
    if (!v) return setError(isWas ? "Type the price before the special (e.g. 15.99)." : "Type the special price (e.g. 12.99).");
    if (v.length > 24) return setError("Shorter, please (e.g. 12.99 or 2/$5).");
    setError(null);
    if (isWas) setDraft({ ...draft, was: money(v), step: "now" });
    else onDone({ was: money(draft.was), now: money(v) });
  };
  return (
    <div dir="ltr" className="space-y-2 rounded-xl border border-[#d61424]/70 bg-[#d61424]/15 p-3">
      <div className="text-[11px] text-white/55">{draft.name} · on special · {isWas ? "1" : "2"} of 2</div>
      <div className="text-[17px] font-bold">{isWas ? "Its price before the special?" : "The special price now?"}</div>
      {!isWas && <div className="text-[13px] text-white/65">Before: <span className="line-through">{draft.was}</span></div>}
      <input key={draft.step} autoFocus className={big} inputMode="decimal" placeholder={isWas ? "e.g. 15.99" : "e.g. 12.99"} value={value}
        onChange={(e) => setDraft(isWas ? { ...draft, was: e.target.value } : { ...draft, now: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") next(); }} />
      {error && <p className="text-[13px] text-amber-200">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className={quiet} onClick={() => (isWas ? setDraft(null) : setDraft({ ...draft, step: "was" }))}>← Back</button>
        {draft.on && isWas && <button className="text-[13px] text-white/70 underline" onClick={() => onDone(null)}>No longer on special</button>}
        <button className={`${primary} ms-auto`} onClick={next}>{isWas ? "Next" : "Put on special"}</button>
      </div>
    </div>
  );
}

type SheetImport = { file: string; products: Product[]; problems: string[] };

/** What a sheet held, before it becomes the store's list: how many products, and every problem, row by row. */
function SheetCard({ sheet, kept, onUse, onCancel }: { sheet: SheetImport; kept: number; onUse: () => void; onCancel: () => void }) {
  const primary = "rounded-xl bg-[#00B8C8] px-5 py-2.5 text-[15px] font-bold text-black disabled:opacity-40";
  const quiet = "rounded-xl border border-white/25 px-4 py-2.5 text-[14px] text-white/85";
  const sample = sheet.products.slice(0, 3);
  return (
    <div dir="ltr" className="fixed bottom-24 left-1/2 z-40 w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-[#00B8C8]/60 bg-[#0f1418]/95 p-4 text-white shadow-2xl">
      <div className="mb-1 text-[11px] text-white/45">The store&apos;s sheet · {sheet.file}</div>
      <div className="mb-2 text-[19px] font-bold">
        {sheet.products.length ? `${sheet.products.length} products read` : "No products could be read"}
      </div>
      {sample.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-[13px] text-white/80">
          {sample.map((p) => (
            <li key={p.n} className="truncate"><b className="text-[#00B8C8]">#{p.n}</b> {productName(p, "en")}{p.fa && p.en ? ` · ${p.fa}` : ""} — {unitPriceSay(p, "en")}</li>
          ))}
          {sheet.products.length > sample.length && <li className="text-white/45">…and {sheet.products.length - sample.length} more</li>}
        </ul>
      )}
      {kept > 0 && <p className="mb-2 text-[13px] text-white/70">{kept} product{kept === 1 ? "" : "s"} added by hand on the walk will be kept.</p>}
      {sheet.problems.length > 0 && (
        <div className="mb-1 max-h-40 overflow-y-auto rounded-lg bg-black/40 p-2 text-[12px] leading-snug text-amber-100">
          <b>{sheet.problems.length} to check:</b>
          {sheet.problems.map((p, i) => <div key={i}>• {p}</div>)}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button className={`${quiet} me-auto`} onClick={onCancel}>Cancel</button>
        <button className={primary} disabled={!sheet.products.length} onClick={onUse}>Use this list</button>
      </div>
    </div>
  );
}

/**
 * The one-question card, over the bottom of the picture (where the operator is
 * looking), not in the side panel.
 */
type Follow = { running: boolean; done: number; total: number; error?: string };

/** Where the editor panel moves when the products panel takes the left edge (wide screens only). */
export const PRODUCTS_PANEL_SHIFT = "sm:left-[15.5rem]";

/**
 * THE STORE'S PRODUCTS DOWN THE LEFT EDGE (owner, 2026-11-01: "lets have all
 * products appear on a left panel so it is easy to connect points in shelves
 * to photos"). Every product of the store's list as its photo, number and
 * name, with a search box and how many dots it already has on this video.
 * A click names the product being tagged, or — before any tap — the product
 * the next tap in the picture is. Wide screens only; a phone keeps the list
 * inside the card.
 */
function ProductsPanel({ catalogue, counts, chosen, onPick }: {
  catalogue: Catalogue;
  counts: Map<number, number>;
  chosen: number | null;
  onPick: (n: number) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? catalogue.products.filter((p) => String(p.n) === needle || String(p.sku ?? "").toLowerCase().includes(needle)
      || (p.en ?? "").toLowerCase().includes(needle) || (p.fa ?? "").includes(q.trim()))
    : catalogue.products;
  const tagged = catalogue.products.filter((p) => counts.has(p.n)).length;
  return (
    <div dir="ltr" className="absolute bottom-3 left-3 top-3 z-30 hidden w-[14rem] flex-col rounded-xl border border-white/20 bg-black/85 p-2 text-white shadow-xl sm:flex">
      <div className="px-1 text-[13px] font-bold">Products <span className="font-normal text-white/55">· {tagged} of {catalogue.products.length} tagged here</span></div>
      <input className="my-1.5 w-full rounded-lg border border-white/20 bg-black/50 px-2 py-1.5 text-[13px] text-white outline-none focus:border-[#00B8C8]"
        placeholder="Search name or number…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pe-1">
        {shown.map((p) => {
          const c = counts.get(p.n) ?? 0;
          return (
            <button key={p.n} type="button" onClick={() => onPick(p.n)} title={productName(p, "en")}
              className={`flex w-full items-center gap-2 rounded-lg border p-1 text-left ${chosen === p.n ? "border-[#00B8C8] bg-[#00B8C8]/25" : "border-white/10 hover:border-white/40"}`}>
              {p.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- hot-linked
                <img src={p.photo} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-md bg-white object-contain" />
              ) : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-white/10 text-[20px]">🛒</div>}
              <span className="min-w-0 flex-1 text-[12px] leading-tight">
                <span className="block truncate"><b className="text-[#00B8C8]">#{p.n}</b> {productName(p, "en")}</span>
                {p.fa && p.en && <span dir="rtl" className="block truncate text-white/60">{p.fa}</span>}
                <span className={`block ${c ? "text-emerald-300" : "text-white/40"}`}>{c ? `✓ ${c} on this video` : "not tagged yet"}</span>
              </span>
            </button>
          );
        })}
        {!shown.length && <p className="py-3 text-center text-[12px] text-white/55">Nothing matches «{q}».</p>}
      </div>
    </div>
  );
}

/**
 * THE STORE'S PRODUCTS AS PHOTOS (owner, 2026-11-01: "all photos in the store
 * folder … in a dropdown list so for operator is easy to match the photo to
 * the video when video is moving"). A list that opens under its key: each
 * product's photo, number and name; a search box narrows it by name or
 * number; a tap picks it (the number box follows). Products with no photo
 * are listed too, with a 🛒, so none is unreachable.
 */
function ProductPicker({ catalogue, chosen, onPick }: {
  catalogue: Catalogue | null;
  chosen: number | null;
  onPick: (n: number) => void;
}) {
  const products = catalogue?.products ?? [];
  const [open, setOpen] = useState(products.length > 0);
  const [q, setQ] = useState("");
  if (!products.length) return null;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? products.filter((p) => String(p.n) === needle || String(p.sku ?? "").toLowerCase().includes(needle)
      || (p.en ?? "").toLowerCase().includes(needle) || (p.fa ?? "").includes(q.trim()))
    : products;
  const withPhoto = products.filter((p) => p.photo).length;
  return (
    <div className="rounded-xl border border-white/20 bg-black/40">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-[14px] font-bold">
        <span>Pick from the store&apos;s photos <span className="font-normal text-white/55">· {products.length} products, {withPhoto} with a photo</span></span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-white/15 p-2">
          <input className="mb-2 w-full rounded-lg border border-white/20 bg-black/50 px-2 py-1.5 text-[14px] text-white outline-none focus:border-[#00B8C8]"
            placeholder="Search name or number…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid max-h-[40vh] grid-cols-3 gap-2 overflow-y-auto pe-1 sm:grid-cols-4">
            {shown.map((p) => (
              <button key={p.n} type="button" onClick={() => onPick(p.n)} title={productName(p, "en")}
                className={`flex flex-col items-center gap-1 rounded-lg border p-1 text-center ${chosen === p.n ? "border-[#00B8C8] bg-[#00B8C8]/25" : "border-white/15 hover:border-white/40"}`}>
                {p.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- hot-linked
                  <img src={p.photo} alt="" loading="lazy" className="aspect-square w-full rounded-md bg-white object-contain" />
                ) : <div className="flex aspect-square w-full items-center justify-center rounded-md bg-white/10 text-[22px]">🛒</div>}
                <span className="w-full truncate text-[11px] leading-tight"><b>#{p.n}</b> {productName(p, "en")}</span>
              </button>
            ))}
            {!shown.length && <p className="col-span-full py-3 text-center text-[13px] text-white/55">Nothing matches «{q}».</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function TagCard({ draft, setDraft, onDone, follow, catalogue }: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  onDone: () => void;
  follow: Follow | null;
  catalogue: Catalogue | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const steps = draft.path === "list" ? LIST_STEPS : HAND_STEPS;
  const i = steps.indexOf(draft.step);
  const go = (step: Step, patch: Partial<Draft> = {}) => { setError(null); setDraft({ ...draft, ...patch, step }); };
  const back = () => {
    if (draft.path === "hand" && draft.step === "en" && catalogue?.products.length) return go("number", { path: "list" });
    if (i === 0 || (draft.id && i === 1)) return setDraft(null);
    go(steps[i - 1]);
  };
  const next = () => go(steps[i + 1]);
  const product = draft.path === "list" ? productOf(catalogue, Number(draft.num)) : undefined;

  const big = "w-full rounded-xl border border-white/25 bg-black/50 px-3 py-2.5 text-[17px] text-white outline-none focus:border-[#00B8C8]";
  const primary = "rounded-xl bg-[#00B8C8] px-5 py-2.5 text-[15px] font-bold text-black disabled:opacity-40";
  const quiet = "rounded-xl border border-white/25 px-4 py-2.5 text-[14px] text-white/85";

  let title = "";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;
  const onEnter = (ok: boolean, then: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" && ok) then(); };

  switch (draft.step) {
    case "product":
      title = "Is this a product?";
      body = <p className="text-[13px] text-white/65">The dot is where you tapped. Tap again to move it.</p>;
      actions = (<>
        <button className={quiet} onClick={() => setDraft(null)}>No</button>
        <button className={primary} onClick={next}>Yes, a product</button>
      </>);
      break;
    case "number":
      title = "Which product is it?";
      body = (<>
        <div className="sm:hidden"><ProductPicker catalogue={catalogue} chosen={product?.n ?? null} onPick={(n) => setDraft({ ...draft, num: String(n) })} /></div>
        <p className="hidden text-[13px] text-white/65 sm:block">Pick its photo on the left, or type its number:</p>
        <input inputMode="numeric" className={`${big} text-center text-[26px] font-bold tracking-wider`} placeholder="or type its number, 1 – 999" value={draft.num}
          onChange={(e) => setDraft({ ...draft, num: e.target.value.replace(/\D/g, "").slice(0, 3) })} onKeyDown={onEnter(Boolean(product), next)} />
        {product ? (
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2">
            {product.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- hot-linked
              <img src={product.photo} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain" />
            ) : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[22px]">🛒</div>}
            <div className="min-w-0 text-[14px]">
              <div className="truncate font-bold">{productName(product, "en")}</div>
              {product.fa && product.en && <div dir="rtl" className="truncate text-white/70">{product.fa}</div>}
              <div className="text-amber-200">{unitPriceSay(product, "en")}{product.sku ? <span className="text-white/45"> · no. {product.sku}</span> : null}</div>
            </div>
          </div>
        ) : draft.num ? (
          <p className="text-[13px] text-rose-200">No product #{draft.num} in the store&apos;s list.</p>
        ) : null}
        <button className="text-[13px] text-white/60 underline" onClick={() => go("en", { path: "hand" })}>Not on the list? Add it by hand</button>
      </>);
      actions = <button className={primary} disabled={!product} onClick={next}>That&apos;s it</button>;
      break;
    case "en":
      title = "What is it called?";
      body = <input autoFocus className={big} placeholder="e.g. Saffron 2 g" value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} onKeyDown={onEnter(Boolean(draft.en.trim()), next)} />;
      actions = <button className={primary} disabled={!draft.en.trim()} onClick={next}>Next</button>;
      break;
    case "fa":
      title = "Its name in Farsi?";
      body = <input autoFocus dir="rtl" className={big} placeholder="مثلاً زعفران ۲ گرمی" value={draft.fa} onChange={(e) => setDraft({ ...draft, fa: e.target.value })} onKeyDown={onEnter(true, next)} />;
      actions = (<>
        <button className={quiet} onClick={() => go("unit", { fa: "" })}>Skip</button>
        <button className={primary} onClick={next}>Next</button>
      </>);
      break;
    case "unit":
      title = "Sold by…?";
      body = (
        <div className="grid grid-cols-3 gap-2">
          {UNITS.map((u) => (
            <button key={u} onClick={() => go("price", { unit: u })}
              className={`rounded-xl border px-2 py-2.5 text-[15px] ${draft.unit === u ? "border-[#00B8C8] bg-[#00B8C8]/25 font-bold" : "border-white/25"}`}>
              {u === "piece" ? "the piece" : u === "box" || u === "pack" ? `the ${u}` : `weight (${u})`}
            </button>
          ))}
        </div>
      );
      actions = null;
      break;
    case "price": {
      const per = draft.unit && draft.unit !== "piece" ? ` per ${UNIT_SAY[draft.unit as Unit].en}` : draft.unit === "piece" ? " each" : "";
      title = `Its price${per}?`;
      const ok = !draft.price.trim() || readPrice(draft.price) !== null;
      body = <input autoFocus inputMode="decimal" className={big} placeholder="e.g. 12.99" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} onKeyDown={onEnter(ok, next)} />;
      actions = (<>
        <button className={quiet} onClick={() => go("photo", { price: "" })}>Skip</button>
        <button className={primary} onClick={() => (ok ? next() : setError("That is not a price (e.g. 12.99)."))}>Next</button>
      </>);
      break;
    }
    case "photo": {
      title = "A photo of it? (a link)";
      const ok = !draft.image.trim() || isSiteUrl(draft.image.trim());
      body = (<>
        <input autoFocus type="url" inputMode="url" className={big} placeholder="https://…" value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} onKeyDown={onEnter(ok, next)} />
        <p className="text-[12px] text-white/55">Right-click a photo on the web → «Copy image address», then paste it here.</p>
      </>);
      actions = (<>
        <button className={quiet} onClick={() => go("follow", { image: "" })}>Skip</button>
        <button className={primary} onClick={() => (ok ? next() : setError("That is not an https:// link to a picture."))}>Next</button>
      </>);
      break;
    }
    case "follow": {
      const span = draft.pins.length > 1 ? `${mmssTenth(draft.pins[0].t)} to ${mmssTenth(draft.pins[draft.pins.length - 1].t)}` : "";
      title = follow ? "The dot follows it" : "Keep the dot on it";
      body = follow ? (<>
        {follow.running ? (
          <>
            <p className="text-[13px] text-white/75">Following the product through the video…</p>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-[#00B8C8] transition-all" style={{ width: `${Math.round((100 * follow.done) / Math.max(1, follow.total))}%` }} />
            </div>
          </>
        ) : follow.error ? (
          <p className="text-[13px] text-rose-200">
            It could not be followed by itself ({follow.error}). Move the video on a little and tap the product again, two or three times.
          </p>
        ) : (
          <p className="text-[13px] leading-snug text-white/80">
            ✓ The dot stays on it from <b>{span}</b>. Play the video (wheel ▲) to check. If it slips somewhere, <b>tap the product there</b> — it follows again from that point.
          </p>
        )}
      </>) : (<>
        <p className="text-[13px] leading-snug text-white/75">
          Move the video on a little (wheel ▲ or the time bar) and <b>tap the product again</b>. Do it two or three times while it is in
          view — the dot follows it. Or press Done if it hardly moves.
        </p>
        <p className="text-[13px] font-semibold text-[#00B8C8]">{draft.pins.length} {draft.pins.length === 1 ? "tap" : "taps"} so far</p>
      </>);
      actions = <button className={primary} disabled={!draft.pins.length || Boolean(follow?.running)} onClick={onDone}>{follow?.running ? "Following…" : "Done ✓"}</button>;
      break;
    }
  }

  const named = product ? `#${product.n} ${productName(product, "en")}` : draft.en.trim();
  return (
    <div dir="ltr" className="fixed bottom-24 left-1/2 z-40 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-[#00B8C8]/60 bg-[#0f1418]/95 p-4 text-white shadow-2xl">
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/45">
        <span>{draft.id ? "Editing" : draft.path === "hand" ? "New product, by hand" : "New product"}{named && !["number", "en"].includes(draft.step) ? ` · ${named}` : ""}</span>
        <span>{i + 1} / {steps.length}</span>
      </div>
      <div className="mb-2 text-[19px] font-bold">{title}</div>
      {/* Keyed by the step: each question's box is new, so it takes the cursor (autoFocus) — a reused one kept it on «Back». */}
      <div key={draft.step} className="space-y-2">{body}</div>
      {error && <div className="mt-2 text-[13px] text-rose-300">{error}</div>}
      <div className="mt-3 flex items-center gap-2">
        <button className="me-auto text-[14px] text-white/70 underline-offset-2 hover:underline" onClick={back}>← Back</button>
        {actions}
      </div>
    </div>
  );
}
