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
import { followProduct } from "./followProduct";
import AddToListKey from "@/components/shopping/AddToListKey";
import { offerItemId, type ShoppingItemInput } from "@/lib/shoppingList/shoppingList";
import {
  addItem, isSiteUrl, itemTime, removeItem, setTitle, sortItemPins, updateItem, walkOf,
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

/**
 * TAGGING A PRODUCT, ONE QUESTION AT A TIME (founder, 2026-10-12: "this
 * interface … needs to be much more intuitive and much simpler and also like a
 * canvas: first ask if this is a product, then start asking other questions
 * ONE by ONE (with back option)").
 *
 * The operator taps the picture; a card asks «Is this a product?», then its
 * name, its Farsi name, its price, its photo — each on its own, with «Back»
 * and, where it may be left out, «Skip» — and last asks them to follow it: move
 * the video on and tap it again, so the dot stays on it. «Done» saves (the
 * editor saves by itself).
 */
type Step = "product" | "en" | "fa" | "price" | "photo" | "follow";
const STEPS: Step[] = ["product", "en", "fa", "price", "photo", "follow"];
const mmssTenth = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;

type Draft = { id?: string; en: string; fa: string; price: string; image: string; pins: ItemPin[]; step: Step };

const draftItem = (d: Draft): WalkItem => ({
  id: d.id ?? "__draft",
  label: d.fa.trim() ? { en: d.en.trim() || "Product", fa: d.fa.trim() } : { en: d.en.trim() || "Product" },
  pins: d.pins,
});

/** Taps on the picture are pins only on these steps (and before a product is started). */
const TAPS_ON: Step[] = ["product", "follow"];

/**
 * The operator's products on this walk: «tap a product», the one-question card,
 * and the list of what is tagged. It only edits `walks`; the editor saves.
 */
export function ItemsEditor({ engine, walks, viewKey, change, setStatus }: {
  engine: React.MutableRefObject<ItemEngine | null>;
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
  setStatus: (s: { tone: "ok" | "warn" | "bad"; text: string } | null) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const walk = walkOf(walks, viewKey);

  // ⚠️ THE DOT FOLLOWS THE PRODUCT BY ITSELF (founder, 2026-10-12: "the dot
  // moves with shopper, instead of being pinned to the product … the single
  // most important issue"). On a flat phone video each tap starts a follow
  // (`followProduct`): the first places the dot for every step the product is
  // in view; a later tap re-follows from there and replaces that stretch.
  const [follow, setFollow] = useState<Follow | null>(null);
  const run = useRef<{ cancelled: boolean } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  function startFollow(pin: ItemPin, replace: boolean) {
    const e = engine.current;
    if (run.current) run.current.cancelled = true;
    run.current = null;
    if (!e || !e.here().flat || !e.video().currentSrc) { setFollow(null); return; } // a 360° walk: taps by hand
    const sig = { cancelled: false };
    run.current = sig;
    setFollow({ running: true, done: 0, total: 1 });
    followProduct(e.video().currentSrc, pin, (p) => { if (!sig.cancelled) setFollow({ running: true, ...p }); }, sig)
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
  // tap moves its dot; on «Follow it» each tap is one more place along the way.
  const tapsOn = !draft || TAPS_ON.includes(draft.step);
  useEffect(() => {
    const e = engine.current;
    if (!e || !viewKey) return;
    e.setItemPick(tapsOn ? (pin) => {
      e.video().pause();
      const d = draftRef.current;
      const fresh = !d || d.step === "product";
      setDraft((cur) => {
        if (!cur) return { en: "", fa: "", price: "", image: "", pins: [pin], step: "product" };
        if (cur.step === "product") return { ...cur, pins: [pin] };
        return { ...cur, pins: sortItemPins([...cur.pins.filter((q) => Math.abs(q.t - pin.t) >= 0.05), pin]) };
      });
      startFollow(pin, fresh);
    } : null);
    return () => e.setItemPick(null);
  }, [engine, tapsOn, viewKey]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setItemPreview(draft && draft.pins.length ? draftItem(draft) : null);
    return () => e.setItemPreview(null);
  }, [engine, draft]);

  function finish() {
    if (!draft || !viewKey) return;
    const image = draft.image.trim();
    const fields = {
      label: draft.fa.trim() ? { en: draft.en.trim(), fa: draft.fa.trim() } : { en: draft.en.trim() },
      ...(draft.price.trim() ? { price: draft.price.trim() } : {}),
      ...(image ? { image } : {}),
      pins: draft.pins.map((q) => ({ t: Math.round(q.t * 100) / 100, x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 })),
    };
    if (draft.id) change(updateItem(walks, viewKey, draft.id, { price: undefined, image: undefined, ...fields }));
    else change(addItem(walks, viewKey, fields));
    setStatus({ tone: "ok", text: `«${fields.label.en}» tagged — saving…` });
    setDraft(null);
  }

  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const field = "w-full rounded-md border border-white/20 bg-black/50 px-2 py-1 text-[13px] text-white";
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <div className="space-y-2">
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

      {!draft && (
        <div className="rounded-lg border border-[#00B8C8]/60 bg-[#00B8C8]/15 p-2.5 text-[13px] leading-snug">
          <b>Tap a product in the picture</b> to tag it.
          <div className="mt-0.5 text-[12px] text-white/65">Move the video (wheel ▲, or the time bar) until the product is in view, then tap it.</div>
        </div>
      )}

      <ul className="space-y-1">
        {(walk?.items ?? []).map((it) => (
          <li key={it.id} className="rounded-md bg-white/5 p-1.5">
            <div className="truncate">
              <span className="font-mono text-white/60">{mmss(itemTime(it))}</span> {it.label.en}
              {it.label.fa && <span className="text-white/60"> · {it.label.fa}</span>}
              {it.price && <span className="text-amber-200"> · {it.price}</span>}
              {!it.pins.length && <span className="text-rose-300"> · no dot</span>}
            </div>
            <div className="mt-1 flex gap-1.5">
              <button className={btn} onClick={() => engine.current?.seek(itemTime(it))}>Go to</button>
              <button className={btn} disabled={Boolean(draft)} onClick={() => { engine.current?.seek(itemTime(it)); setDraft({ id: it.id, en: it.label.en, fa: it.label.fa ?? "", price: it.price ?? "", image: it.image ?? "", pins: it.pins, step: "en" }); }}>Edit</button>
              <button className={btn} onClick={() => { if (viewKey && window.confirm(`Delete «${it.label.en}»?`)) change(removeItem(walks, viewKey, it.id)); }}>Delete</button>
            </div>
          </li>
        ))}
        {walk && !(walk.items ?? []).length && !draft && <li className="text-white/50">No products tagged on this video yet.</li>}
      </ul>

      {draft && <TagCard draft={draft} setDraft={setDraft} onDone={finish} follow={follow} />}
    </div>
  );
}

/**
 * The one-question card, over the bottom of the picture (where the operator is
 * looking), not in the side panel.
 */
type Follow = { running: boolean; done: number; total: number; error?: string };

function TagCard({ draft, setDraft, onDone, follow }: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  onDone: () => void;
  follow: Follow | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const i = STEPS.indexOf(draft.step);
  const go = (step: Step) => { setError(null); setDraft({ ...draft, step }); };
  const back = () => (i === 0 || (draft.id && draft.step === "en") ? setDraft(null) : go(STEPS[i - 1]));
  const next = () => go(STEPS[i + 1]);

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
    case "en":
      title = "What is it called?";
      body = <input autoFocus className={big} placeholder="e.g. Saffron 2 g" value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} onKeyDown={onEnter(Boolean(draft.en.trim()), next)} />;
      actions = <button className={primary} disabled={!draft.en.trim()} onClick={next}>Next</button>;
      break;
    case "fa":
      title = "Its name in Farsi?";
      body = <input autoFocus dir="rtl" className={big} placeholder="مثلاً زعفران ۲ گرمی" value={draft.fa} onChange={(e) => setDraft({ ...draft, fa: e.target.value })} onKeyDown={onEnter(true, next)} />;
      actions = (<>
        <button className={quiet} onClick={() => { setDraft({ ...draft, fa: "", step: "price" }); }}>Skip</button>
        <button className={primary} onClick={next}>Next</button>
      </>);
      break;
    case "price":
      title = "Its price?";
      body = <input autoFocus inputMode="decimal" className={big} placeholder="e.g. $12.99" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} onKeyDown={onEnter(true, next)} />;
      actions = (<>
        <button className={quiet} onClick={() => { setDraft({ ...draft, price: "", step: "photo" }); }}>Skip</button>
        <button className={primary} onClick={next}>Next</button>
      </>);
      break;
    case "photo": {
      title = "A photo of it? (a link)";
      const ok = !draft.image.trim() || isSiteUrl(draft.image.trim());
      body = (<>
        <input autoFocus type="url" inputMode="url" className={big} placeholder="https://…" value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} onKeyDown={onEnter(ok, next)} />
        <p className="text-[12px] text-white/55">Right-click a photo on the web → «Copy image address», then paste it here.</p>
      </>);
      actions = (<>
        <button className={quiet} onClick={() => { setDraft({ ...draft, image: "", step: "follow" }); }}>Skip</button>
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

  return (
    <div dir="ltr" className="fixed bottom-24 left-1/2 z-40 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-[#00B8C8]/60 bg-[#0f1418]/95 p-4 text-white shadow-2xl">
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/45">
        <span>{draft.id ? "Editing" : "New product"}{draft.en.trim() && draft.step !== "en" ? ` · ${draft.en.trim()}` : ""}</span>
        <span>{i + 1} / {STEPS.length}</span>
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
