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

import { useEffect, useState } from "react";
import AddToListKey from "@/components/shopping/AddToListKey";
import { offerItemId, type ShoppingItemInput } from "@/lib/shoppingList/shoppingList";
import {
  addItem, isSiteUrl, removeItem, setTitle, sortItemPins, updateItem, walkOf,
  type ItemPin, type Walk, type WalkItem, type Walks,
} from "@/lib/splats/walks";

type Lang = "fa" | "en";

/** The minimal engine the editor drives (`Walk360.tsx`'s `Engine`). */
export type ItemEngine = {
  here: () => { key: string | null; t: number; flat: boolean };
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

/** The basket line for an item on a walk. */
export function itemLine(item: WalkItem, walkKey: string, walk: Walk | null, lang: Lang): ShoppingItemInput {
  const fa = item.label.fa;
  return {
    id: offerItemId(`walk-${sceneOf(walkKey)}-${item.id}`),
    kind: "offer",
    label: lang === "fa" && fa ? fa : item.label.en,
    ...(fa ? { sub: lang === "fa" ? item.label.en : fa } : {}),
    merchant: shopName(walkKey, walk, lang),
    ...(item.price ? { price: item.price } : {}),
    ...(item.image ? { imageUrl: item.image } : {}),
    href: `/vca/walk?v=${encodeURIComponent(walkKey)}`,
  };
}

/** The card a tap on an item's dot opens: photo, name, price, «Add to Basket». */
export function ItemCard({ item, walkKey, walk, onClose }: {
  item: WalkItem;
  walkKey: string;
  walk: Walk | null;
  onClose: () => void;
}) {
  const [lang, setLang] = useState<Lang>("fa");
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        dir={lang === "fa" ? "rtl" : "ltr"}
        className="w-full max-w-sm rounded-t-2xl border border-white/15 bg-[#14171c] p-4 text-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {item.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- hot-linked, as basket lines are
            <img src={item.image} alt="" className="h-24 w-24 shrink-0 rounded-xl bg-white object-contain" />
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[34px] text-white/60">🛒</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold leading-snug">{lang === "fa" && item.label.fa ? item.label.fa : item.label.en}</div>
            {item.label.fa && <div className="text-[14px] text-white/65">{lang === "fa" ? item.label.en : item.label.fa}</div>}
            <div className="mt-1 text-[13px] text-white/55">{shopName(walkKey, walk, lang)}</div>
            {item.price && <div className="mt-1.5 text-[20px] font-extrabold text-amber-200">{item.price}</div>}
          </div>
          <button className="rounded-full px-2 text-[20px] text-white/60" aria-label={lang === "fa" ? "بستن" : "Close"} onClick={onClose}>×</button>
        </div>
        <AddToListKey item={itemLine(item, walkKey, walk, lang)} lang={lang} variant="wide" theme="dark" className="mt-4" />
        <div className="mt-3 flex items-center justify-between text-[13px]">
          <a href="/basket" className="text-[#00B8C8] underline">{lang === "fa" ? "سبد خرید ←" : "Basket →"}</a>
          <button className="text-white/55 underline" onClick={() => setLang(lang === "fa" ? "en" : "fa")}>{lang === "fa" ? "English" : "فارسی"}</button>
        </div>
      </div>
    </div>
  );
}

type Draft = { id?: string; en: string; fa: string; price: string; image: string; pins: ItemPin[]; pinning: boolean };

const draftItem = (d: Draft): WalkItem => ({
  id: d.id ?? "__draft",
  label: d.fa.trim() ? { en: d.en.trim() || "…", fa: d.fa.trim() } : { en: d.en.trim() || "…" },
  pins: d.pins,
});

/**
 * The operator's items on this walk: the shop's name (the basket groups by
 * it), «Item here», pins tapped on the product as the video moves, and the
 * list. Saved with the doors («Save»), so it only edits `walks`.
 */
export function ItemsEditor({ engine, walks, viewKey, change, setStatus }: {
  engine: React.MutableRefObject<ItemEngine | null>;
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
  setStatus: (s: { tone: "ok" | "warn" | "bad"; text: string } | null) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const walk = walkOf(walks, viewKey);

  const pinning = Boolean(draft?.pinning);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setItemPick(pinning ? (pin) => setDraft((d) => (d ? { ...d, pins: sortItemPins([...d.pins.filter((q) => Math.abs(q.t - pin.t) >= 0.05), pin]) } : d)) : null);
    return () => e.setItemPick(null);
  }, [engine, pinning]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setItemPreview(draft && draft.pins.length ? draftItem(draft) : null);
    return () => e.setItemPreview(null);
  }, [engine, draft]);

  function itemHere() {
    if (!viewKey) return setStatus({ tone: "bad", text: "Items can only be placed on a video from the bucket (?v=…)." });
    engine.current?.video().pause();
    setDraft({ en: "", fa: "", price: "", image: "", pins: [], pinning: true });
  }

  function saveDraft() {
    if (!draft || !viewKey) return;
    if (!draft.en.trim()) return setStatus({ tone: "bad", text: "The item needs an English name." });
    if (!draft.pins.length) return setStatus({ tone: "bad", text: "Tap the item in the picture at least once (Pinning: on)." });
    const image = draft.image.trim();
    if (image && !isSiteUrl(image)) return setStatus({ tone: "bad", text: "The photo must be an https:// address (or leave it empty)." });
    const fields = {
      label: draft.fa.trim() ? { en: draft.en.trim(), fa: draft.fa.trim() } : { en: draft.en.trim() },
      ...(draft.price.trim() ? { price: draft.price.trim() } : {}),
      ...(image ? { image } : {}),
      pins: draft.pins.map((q) => ({ t: Math.round(q.t * 100) / 100, x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 })),
    };
    if (draft.id) change(updateItem(walks, viewKey, draft.id, { price: undefined, image: undefined, ...fields }));
    else change(addItem(walks, viewKey, fields));
    setDraft(null);
  }

  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const field = "w-full rounded-md border border-white/20 bg-black/50 px-2 py-1 text-[13px] text-white";
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="block text-[11px] text-white/60">Shop name (the basket lists items under it)</label>
        <div className="flex gap-1.5">
          <input className={field} placeholder="Ali's Market" defaultValue={walk?.title?.en ?? ""} key={`en-${viewKey}`}
            onBlur={(e) => viewKey && e.target.value.trim() !== (walk?.title?.en ?? "") && change(setTitle(walks, viewKey, { en: e.target.value, fa: walk?.title?.fa ?? "" }))} />
          <input className={field} dir="rtl" placeholder="بازار علی" defaultValue={walk?.title?.fa ?? ""} key={`fa-${viewKey}`}
            onBlur={(e) => viewKey && e.target.value.trim() !== (walk?.title?.fa ?? "") && change(setTitle(walks, viewKey, { en: walk?.title?.en ?? "", fa: e.target.value }))} />
        </div>
      </div>

      {!draft && (
        <button className={`${btn} w-full border-[#00B8C8]/70 bg-[#00B8C8]/20 py-2 text-[13px] font-semibold`} disabled={!viewKey} onClick={itemHere}>
          + Item here (tap it in the picture)
        </button>
      )}

      {draft && (
        <div className="space-y-1.5 rounded-lg border border-[#00B8C8]/50 p-2">
          <input className={field} placeholder="English name (e.g. Saffron 2 g)" value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} autoFocus />
          <input className={field} dir="rtl" placeholder="نام فارسی (اختیاری)" value={draft.fa} onChange={(e) => setDraft({ ...draft, fa: e.target.value })} />
          <div className="flex gap-1.5">
            <input className={field} placeholder="Price ($4.99)" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            <input className={field} type="url" inputMode="url" placeholder="Photo https://… (optional)" value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} />
          </div>
          <div className="space-y-1 rounded-md border border-white/15 p-1.5">
            <div className="flex items-center justify-between gap-2">
              <b className="text-[12px]">Dot on the item</b>
              <button className={`${btn} ${draft.pinning ? "border-[#00B8C8]/80 bg-[#00B8C8]/25" : ""}`} onClick={() => setDraft({ ...draft, pinning: !draft.pinning })}>
                {draft.pinning ? "Pinning: on" : "Pin the dot"}
              </button>
            </div>
            {draft.pinning && (
              <div className="text-[11px] leading-snug text-white/65">
                Tap the product in the picture: the dot goes there at this moment. Move on a little (wheel ▲ or W) and tap it again —
                where it comes into view, the middle, where it leaves. The dot follows it between taps and shows only while it is in view.
              </div>
            )}
            {draft.pins.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {draft.pins.map((q) => (
                  <span key={q.t} className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]">
                    {mmss(q.t)}.{Math.floor((q.t % 1) * 10)}
                    <button className="ms-1 text-white/60" title="Remove this pin" onClick={() => setDraft({ ...draft, pins: draft.pins.filter((x) => x !== q) })}>×</button>
                  </span>
                ))}
                <button className="text-[11px] text-white/50 underline" onClick={() => setDraft({ ...draft, pins: [] })}>clear</button>
              </div>
            ) : (
              <div className="text-[11px] text-white/45">No pins yet.</div>
            )}
          </div>
          <div className="flex gap-2">
            <button className={`${btn} border-[#00B8C8]/70`} onClick={saveDraft}>{draft.id ? "Apply" : "Add item"}</button>
            <button className={btn} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {(walk?.items ?? []).map((it) => (
          <li key={it.id} className="rounded-md bg-white/5 p-1.5">
            <div className="truncate">
              <span className="font-mono text-white/60">{mmss(it.pins[0].t)}</span> {it.label.en}
              {it.label.fa && <span className="text-white/60"> · {it.label.fa}</span>}
              {it.price && <span className="text-amber-200"> · {it.price}</span>}
            </div>
            <div className="mt-1 flex gap-1.5">
              <button className={btn} onClick={() => engine.current?.seek(it.pins[0].t)}>Go to</button>
              <button className={btn} onClick={() => { engine.current?.seek(it.pins[0].t); setDraft({ id: it.id, en: it.label.en, fa: it.label.fa ?? "", price: it.price ?? "", image: it.image ?? "", pins: it.pins, pinning: false }); }}>Edit</button>
              <button className={btn} onClick={() => { if (viewKey && window.confirm(`Delete the item «${it.label.en}»?`)) change(removeItem(walks, viewKey, it.id)); }}>Delete</button>
            </div>
          </li>
        ))}
        {walk && !(walk.items ?? []).length && !draft && <li className="text-white/50">No items on this walk yet.</li>}
      </ul>
    </div>
  );
}
