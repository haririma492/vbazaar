"use client";

/**
 * THE STORE'S PRODUCTS, AS ITS OWNER FILLS THEM IN (owner, 2026-11-01: "show
 * all products photos (extracted from the video) for owner to add info":
 * unit, price, item #, description). Each product is its photo; a tap opens a
 * card that asks one thing at a time, with «← Back» and «Skip», and saves each
 * answer by itself. A photo that is not a product, or the same product found
 * twice, is put right from the same card. What is saved here is what shoppers
 * see on the product's tag and card in the walk.
 */

import { useState } from "react";
import { UNITS, UNIT_SAY, formatCents, type Product, type Unit } from "@/lib/splats/catalogue";
import { postJson } from "./upload";
import PhotoZoom from "@/components/common/PhotoZoom";
import { Bi, Card, FIELD, KEY, QUIET, Said } from "./ui";

type Step = "unit" | "price" | "sku" | "note" | "done";
const ORDER: Step[] = ["unit", "price", "sku", "note", "done"];
const UNIT_LABEL: Record<Unit, string> = { piece: "the piece", set: "the set", pack: "the pack", box: "the box", kg: "weight (kg)", g: "weight (g)", lb: "weight (lb)" };

/** A product still waiting for the owner: no price yet. */
const needsInfo = (p: Product) => p.priceCents === null;

export default function Products({ api, products, reload }: { api: string; products: Product[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<number | null>(null);
  const waiting = products.filter(needsInfo).length;
  const fromVideo = products.some((p) => p.by === "video");
  const current = products.find((p) => p.n === open) ?? null;
  return (
    <Card>
      <Bi fa="محصولات" en={`Products — ${products.length}${waiting ? `, ${waiting} waiting for a price` : ""}`} className="text-[15px] font-bold text-amber-100" />
      <p dir="ltr" className="mt-1 text-left text-[12px] text-white/50">
        {fromVideo ? "Found in the store's video. " : ""}Tap a product to give its unit, price, item # and description. Shoppers see them on its tag in the walk.
      </p>
      {current && <ProductCard key={current.n} api={api} product={current} others={products.filter((p) => p.n !== current.n)} close={() => setOpen(null)} reload={reload} />}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {products.map((p) => (
          <button key={p.n} type="button" onClick={() => setOpen(p.n)}
            className={`flex flex-col gap-1 rounded-xl border p-1.5 text-start ${open === p.n ? "border-amber-300 bg-amber-300/10" : needsInfo(p) ? "border-rose-300/40" : "border-white/10 hover:border-white/30"}`}>
            {p.photo
              // eslint-disable-next-line @next/next/no-img-element -- cut from the walk
              ? <img src={p.photo} alt="" loading="lazy" className="aspect-square w-full rounded-lg bg-white object-contain" />
              : <span className="flex aspect-square w-full items-center justify-center rounded-lg bg-white/5 text-[28px]">🛒</span>}
            <span dir="auto" className="truncate text-[13px] font-bold">#{p.n} · {p.fa || p.en}</span>
            <span dir="ltr" className={`text-left text-[12px] ${needsInfo(p) ? "text-rose-200" : "text-amber-200"}`}>
              {needsInfo(p) ? "needs a price · قیمت؟" : `${formatCents(p.priceCents!)} / ${UNIT_SAY[p.unit].en}`}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ProductCard({ api, product, others, close, reload }: { api: string; product: Product; others: Product[]; close: () => void; reload: () => Promise<void> }) {
  const [step, setStep] = useState<Step>("unit");
  const [price, setPrice] = useState(product.priceCents === null ? "" : (product.priceCents / 100).toFixed(2));
  const [sku, setSku] = useState(product.sku ?? "");
  const [note, setNote] = useState(product.note ?? "");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [fix, setFix] = useState<"" | "same">("");
  const [busy, setBusy] = useState(false);
  const i = ORDER.indexOf(step);
  const go = (s: Step) => { setSaid(null); setStep(s); };
  async function save(fields: Record<string, unknown>, then: Step) {
    setBusy(true);
    try {
      await postJson(api, { action: "product", n: product.n, ...fields });
      setSaid({ ok: true, text: "✓ Saved · ذخیره شد" });
      await reload();
      setStep(then);
    } catch (e) {
      setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }
  async function remove(body: Record<string, unknown>, sure: string) {
    if (!window.confirm(sure)) return;
    try { await postJson(api, body); close(); await reload(); }
    catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }
  const back = i > 0 && step !== "done" ? <button type="button" className={QUIET} onClick={() => go(ORDER[i - 1])}>← Back · قبلی</button> : null;
  const next = ORDER[i + 1] ?? "done";

  return (
    <div className="mt-3 rounded-2xl border border-amber-300/50 bg-black/40 p-3">
      <div className="flex items-start gap-3">
        {product.photo
          ? <PhotoZoom src={product.photo} className="h-28 w-28 rounded-xl bg-white object-contain" />
          : <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[32px]">🛒</span>}
        <div className="min-w-0 flex-1">
          <div dir="auto" className="text-[16px] font-bold">#{product.n} · {product.fa || product.en}</div>
          {product.fa && product.en && <div dir="ltr" className="text-left text-[13px] text-white/60">{product.en}</div>}
          <div className="mt-1 text-[12px] text-white/45">{step === "done" ? "All saved." : `Question ${i + 1} of 4`}</div>
        </div>
        <button type="button" aria-label="Close" className="text-[20px] text-white/60" onClick={close}>✕</button>
      </div>

      <div className="mt-3 space-y-2">
        {step === "unit" && (<>
          <Bi fa="به چه صورت فروخته می‌شود؟" en="Sold by…?" className="text-[15px] font-bold" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {UNITS.map((u) => (
              <button key={u} type="button" disabled={busy} onClick={() => void save({ unit: u }, next)}
                className={`rounded-xl border px-2 py-2.5 text-[14px] ${product.unit === u ? "border-amber-300 bg-amber-300/20 font-bold" : "border-white/25"}`}>
                {UNIT_LABEL[u]} <span className="text-white/50">· {UNIT_SAY[u].fa}</span>
              </button>
            ))}
          </div>
        </>)}
        {step === "price" && (<>
          <Bi fa={`قیمت هر ${UNIT_SAY[product.unit].fa}؟`} en={`Its price per ${UNIT_SAY[product.unit].en}? (CAD)`} className="text-[15px] font-bold" />
          <input autoFocus dir="ltr" inputMode="decimal" placeholder="e.g. 12.99" value={price} onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && price.trim()) void save({ price }, next); }} className={`${FIELD} text-[18px]`} />
          <div className="flex flex-wrap gap-2">{back}<button type="button" className={KEY} disabled={busy || !price.trim()} onClick={() => void save({ price }, next)}>Next · بعدی</button></div>
        </>)}
        {step === "sku" && (<>
          <Bi fa="کد کالا (اختیاری)" en="Item # (optional) — the store's own number" className="text-[15px] font-bold" />
          <input autoFocus dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save({ sku }, next); }} className={FIELD} />
          <div className="flex flex-wrap gap-2">{back}<button type="button" className={QUIET} onClick={() => go(next)}>Skip · رد شدن</button><button type="button" className={KEY} disabled={busy} onClick={() => void save({ sku }, next)}>Next · بعدی</button></div>
        </>)}
        {step === "note" && (<>
          <Bi fa="توضیح (اختیاری)" en="Description (optional) — shoppers read it on the product's card" className="text-[15px] font-bold" />
          <textarea autoFocus dir="auto" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} />
          <div className="flex flex-wrap gap-2">{back}<button type="button" className={QUIET} onClick={() => go("done")}>Skip · رد شدن</button><button type="button" className={KEY} disabled={busy} onClick={() => void save({ note }, "done")}>Save · ذخیره</button></div>
        </>)}
        {step === "done" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={QUIET} onClick={() => go("unit")}>Change again · تغییر</button>
            <button type="button" className={KEY} onClick={close}>Done · تمام</button>
          </div>
        )}
        {said && <Said ok={said.ok} text={said.text} />}
      </div>

      <div className="mt-4 border-t border-white/10 pt-3 text-[13px]">
        {fix === "same" ? (
          <div className="space-y-2">
            <Bi fa="همان محصولِ…" en="It is the same product as…" className="text-[14px] font-bold" />
            <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
              {others.map((o) => (
                <button key={o.n} type="button" className="flex flex-col gap-1 rounded-lg border border-white/15 p-1 text-start hover:border-amber-300"
                  onClick={() => void remove({ action: "productSame", n: product.n, into: o.n }, `#${product.n} is the same as #${o.n} «${o.fa || o.en}»? Its tags move to #${o.n}.`)}>
                  {o.photo
                    // eslint-disable-next-line @next/next/no-img-element -- cut from the walk
                    ? <img src={o.photo} alt="" className="aspect-square w-full rounded-md bg-white/5 object-contain" />
                    : <span className="flex aspect-square w-full items-center justify-center rounded-md bg-white/5">🛒</span>}
                  <span dir="auto" className="truncate text-[11px]">#{o.n} {o.fa || o.en}</span>
                </button>
              ))}
            </div>
            <button type="button" className={QUIET} onClick={() => setFix("")}>← Back · قبلی</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {others.length > 0 && <button type="button" className="text-amber-200/80 underline" onClick={() => setFix("same")}>Same as another product · تکراری</button>}
            <button type="button" className="text-rose-200/80 underline"
              onClick={() => void remove({ action: "productDrop", n: product.n }, `#${product.n} is not a product? It leaves the list and the walk.`)}>Not a product · محصول نیست</button>
          </div>
        )}
      </div>
    </div>
  );
}
