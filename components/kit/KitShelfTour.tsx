"use client";

/**
 * THE SHELF TOUR, FROM THE SHELVES' OWN PHOTOS (owner, 2026-11-15: "Lets do the Shelf Tours also get re-designed based
 * on quality photos of Type IV & type V"; "No video right"). For a store with a shelf kit (`lib/stores/kitRules.ts`):
 *
 *   1  each shelf opens on its whole quality photo (Type III), its sections outlined thinly;
 *   2  ⚠️ ONE ORDER, ALWAYS (owner, 2026-11-17: "the transition between type III, IV & V is not straight forward and it
 *      is arbitrary there has to be some sensible order in that"): the shelf (III) → section 1: the glide into its place,
 *      its own photo (IV) → each of section 1's products (V), one card at a time → section 2 … → the whole shelf again,
 *      and it waits (it never moves to the next shelf by itself). A chip says where it is («Section 2 of 4 · Product
 *      3 of 5»). A clock per shelf (`plan`) drives it, and a bar under the picture shows it moving (owner: "let a video
 *      bar below so viewers know that things are moving"); a tap on the bar goes there;
 *   3  a tap on a section (or on the section in view) stops it: the section's photo grows out of where it was, with a
 *      funnel from that place, to the bottom left, and the shopping panel (`KitPanel`) opens on the right. Closing
 *      the panel closes the photo and the tour goes on;
 *   4  «‹ Previous shelf» / «Next shelf ›», a dot per section, pause / play.
 *
 * A section whose place in the shelf photo was not found is shown by its own photo fading in, without the glide.
 * Phones are held upright: sideways, the screen says so.
 */
import { noSave } from "./noSave";
import Watermark from "./Watermark";
import ShareKey from "./ShareKey";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TourBazaarLink from "@/components/brand/TourBazaarLink";
import StoreLogo from "@/components/brand/StoreLogo";
import { WalkSound } from "@/components/virtual-bazaar/walk/WalkSound";
import KitPanel, { type Lang } from "./KitPanel";
import type { ShopKit, ShopProduct, ShopSection, ShopShelf } from "@/lib/stores/kitRules";
import { formatCents } from "@/lib/splats/catalogue";

const WHOLE_MS = 2500, GLIDE_MS = 1600, SECTION_MS = 3000, PRODUCT_MS = 2400, GROW_MS = 450;
/** At most this many products a section are shown one by one (the panel lists them all). */
const MAX_SHOWN = 8;
type Rect = { x: number; y: number; w: number; h: number };
/** One step of a shelf's tour: the whole shelf, the glide into a section, its photo, one of its products, the end. */
type Step = { kind: "shelf" | "glide" | "section" | "product" | "end"; k: number; j: number; from: number; ms: number };
/** The shelf's steps in their one order, each with its start on the shelf's clock (ms). */
function plan(sections: ShopSection[]): { steps: Step[]; total: number } {
  const steps: Step[] = [];
  let t = 0;
  const add = (kind: Step["kind"], k: number, j: number, ms: number) => { steps.push({ kind, k, j, from: t, ms }); t += ms; };
  add("shelf", -1, -1, WHOLE_MS);
  sections.forEach((x, k) => {
    if (x.quad) add("glide", k, -1, GLIDE_MS);
    add("section", k, -1, SECTION_MS);
    x.products.slice(0, MAX_SHOWN).forEach((_, j) => add("product", k, j, PRODUCT_MS));
  });
  add("end", -1, -1, 0);
  return { steps, total: t };
}
const stepAt = (steps: Step[], t: number) => { let i = 0; while (i + 1 < steps.length && steps[i + 1].from <= t) i++; return i; };
/** Where the tour is: `k` the section in view (-1: the whole shelf), `show` its own photo faded in. */
type At = { k: number; show: boolean };
let soundBase: Promise<string | null> | null = null;
/** The music's address (the walk's own tracks, in the public bucket), as the Free Tour finds it. */
async function soundSrc(key: string): Promise<string | null> {
  soundBase ??= fetch("/api/splats/config", { cache: "no-store" }).then((r) => r.json() as Promise<{ base: string | null }>)
    .then(({ base }) => (base ? base.replace(/\/+$/, "") : null)).catch(() => null);
  const b = await soundBase;
  return b ? `${b}/${key}` : null;
}

const boxOf = (q: number[]) => {
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
  const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys)), x1 = Math.min(1, Math.max(...xs)), y1 = Math.min(1, Math.max(...ys));
  return { x: x0, y: y0, w: Math.max(0.01, x1 - x0), h: Math.max(0.01, y1 - y0) };
};

/** The convex hull of some points (the funnel between the place tapped and the grown photo). */
function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [], up: Array<[number, number]> = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
const corners = (r: Rect): Array<[number, number]> => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];

function useUpright(): boolean {
  const [sideways, setSideways] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(orientation: landscape) and (max-height: 500px) and (pointer: coarse)");
    const on = () => setSideways(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return sideways;
}

export function HoldUpright() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
      <div className="text-[44px]" aria-hidden>📱</div>
      <p className="text-[17px] font-bold">Please hold your phone upright</p>
      <p dir="rtl" className="text-[17px] font-bold">لطفاً گوشی را عمودی نگه دارید</p>
    </div>
  );
}

export default function KitShelfTour({ slug, kit }: { slug: string; kit: ShopKit }) {
  const shelves = useMemo<ShopShelf[]>(() => kit.shelves.filter((s) => s.photo).sort((a, b) =>
    (a.outline[0]?.t ?? Infinity) - (b.outline[0]?.t ?? Infinity) || (a.n ?? 1000) - (b.n ?? 1000)), [kit]);
  const [si, setSi] = useState(0);
  const [paused, setPaused] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [open, setOpen] = useState<{ section: ShopSection; from: Rect; highlight?: string } | null>(null);
  const [grown, setGrown] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sideways = useUpright();
  const shelf = shelves[Math.min(si, shelves.length - 1)];
  const sections = useMemo(() => [...(shelf?.sections ?? [])].sort((a, b) => a.i - b.i), [shelf]);
  const { steps, total } = useMemo(() => plan(sections), [sections]);
  /** The shelf's clock (ms), moved by the frames while playing; the step on screen follows it. */
  const clock = useRef(0);
  const [si2, setStep] = useState(0);
  const step = steps[Math.min(si2, steps.length - 1)];
  const at: At = { k: step?.k ?? -1, show: step?.kind === "section" || step?.kind === "product" };
  const product: ShopProduct | null = step?.kind === "product" ? sections[step.k]?.products[step.j] ?? null : null;
  const bar = useRef<HTMLDivElement>(null);
  const seek = useCallback((t: number) => {
    clock.current = Math.max(0, Math.min(total, t));
    setStep(stepAt(steps, clock.current));
    if (bar.current) bar.current.style.width = `${total ? (clock.current / total) * 100 : 0}%`;
  }, [steps, total]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // A new shelf starts on its whole photo; its section and product photos are fetched ahead.
  useEffect(() => {
    seek(0);
    setPaused(false);
    for (const x of sections) { const im = new Image(); im.src = x.url; for (const p of x.products.slice(0, MAX_SHOWN)) if (p.photo) { const q = new Image(); q.src = p.photo; } }
  }, [sections, seek]);

  // The clock runs while playing (not while the panel is open); at the end of the shelf it stops on the whole shelf.
  useEffect(() => {
    if (paused || open || !shelf || !sections.length) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      clock.current = Math.min(total, clock.current + (now - last));
      last = now;
      const i = stepAt(steps, clock.current);
      setStep((cur) => (cur === i ? cur : i));
      if (bar.current) bar.current.style.width = `${total ? (clock.current / total) * 100 : 0}%`;
      if (clock.current >= total) { setPaused(true); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, open, shelf, sections.length, steps, total]);

  // The shelf photo fitted in the stage, and the glide into the section in view.
  const fit = useMemo(() => {
    const pw = shelf?.photo?.w || 4, ph = shelf?.photo?.h || 3;
    const s = Math.min(size.w / pw, size.h / ph) || 0;
    const fw = pw * s, fh = ph * s;
    return { fw, fh, ox: (size.w - fw) / 2, oy: (size.h - fh) / 2 };
  }, [shelf, size]);
  // The glide holds through the section's photo and its products (the place in the shelf stays the same).
  const sec = at.k >= 0 ? sections[at.k] : null;
  const zoom = useMemo(() => {
    if (!sec?.quad || !fit.fw) return { s: 1, tx: 0, ty: 0 };
    const b = boxOf(sec.quad);
    const s = Math.max(1, Math.min(size.w / (b.w * fit.fw), size.h / (b.h * fit.fh)) * 0.94);
    const cx = (b.x + b.w / 2) * fit.fw, cy = (b.y + b.h / 2) * fit.fh;
    return { s, tx: size.w / 2 - fit.ox - s * cx, ty: size.h / 2 - fit.oy - s * cy };
  }, [sec, fit, size]);

  /** A section's place on screen now (stage pixels): in the whole view, its outline's box; in its own view, the photo. */
  const rectOf = useCallback((x: ShopSection): Rect => {
    if (sec && x.id === sec.id && at.show) {
      const a = (x.w || 4) / (x.h || 3), s = Math.min(size.w / a, size.h);
      return { x: (size.w - s * a) / 2, y: (size.h - s) / 2, w: s * a, h: s };
    }
    if (!x.quad) return { x: size.w * 0.3, y: size.h * 0.3, w: size.w * 0.4, h: size.h * 0.4 };
    const b = boxOf(x.quad);
    return { x: fit.ox + zoom.tx + zoom.s * b.x * fit.fw, y: fit.oy + zoom.ty + zoom.s * b.y * fit.fh, w: zoom.s * b.w * fit.fw, h: zoom.s * b.h * fit.fh };
  }, [sec, at.show, size, fit, zoom]);

  const openSection = (x: ShopSection) => {
    setOpen({ section: x, from: rectOf(x), ...(product && sec?.id === x.id ? { highlight: product.id } : {}) });
    setGrown(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
  };
  const close = () => { setOpen(null); setGrown(false); setPaused(false); };

  // The grown photo: three times the place it came from, as room allows, at the bottom left (the panel on the right).
  const narrow = size.w < 640;
  const panelW = narrow ? size.w : Math.min(400, size.w * 0.42);
  const target = useMemo<Rect | null>(() => {
    if (!open) return null;
    const a = (open.section.w || 4) / (open.section.h || 3);
    const roomW = (narrow ? size.w : size.w - panelW - 24) - 24, roomH = (narrow ? size.h * 0.42 : size.h) - 24;
    let w = Math.min(open.from.w * 3, roomW), h = w / a;
    if (h > roomH) { h = roomH; w = h * a; }
    return { x: 12, y: (narrow ? size.h * 0.42 : size.h) - 12 - h, w, h };
  }, [open, size, narrow, panelW]);
  const shown = open && target ? (grown ? target : open.from) : null;

  if (sideways) return <HoldUpright />;
  if (!shelf) return <div className="fixed inset-0 flex items-center justify-center bg-black text-white/70">This store&apos;s shelves are not ready yet.</div>;
  const name = kit.title?.en ?? kit.merchant ?? slug;
  const label = lang === "fa" ? shelf.label.fa : shelf.label.en;
  // The store's own page (vbazaar.app/<store>), not the long walk address.
  const walkHref = kit.link ?? (kit.walk ? `/vca/walk?v=${encodeURIComponent(kit.walk)}` : null);
  const btn = "rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/20 disabled:opacity-30";

  return (
    // Left to right whatever the page's language: the logo at the top left, «‹ Previous» on the left (the panel sets its own).
    <div dir="ltr" className="fixed inset-0 flex flex-col bg-black text-white">
      <div className="relative flex flex-wrap items-center justify-between gap-2 px-3 py-2 pr-[15.5rem] text-[14px]">
        {/* The store's logo at the top left, as on the Free Tour (owner, 2026-11-17: "the store logo is missing from top
            left"); the bazaar's arch at the top right, the sound key to its left (the same place as the Free Tour's). */}
        {kit.logo ? <StoreLogo src={kit.logo} /> : null}
        <div className="me-auto min-w-0 flex-1 truncate"><b>{name}</b>{kit.title?.fa ? <span className="text-white/60"> · {kit.title.fa}</span> : null} · <span className="text-white/60">Shelf Tour</span></div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center rounded-full border border-white/25 bg-black/70 p-1 font-semibold">
            <span className="rounded-full bg-[#00B8C8] px-3 py-1 text-[#06131c]">🛒 Shelf Tour</span>
            {walkHref && <a className="rounded-full px-3 py-1 text-white/80" href={walkHref}>👣 Free Tour</a>}
          </span>
          <a className="text-[#00B8C8] underline" href="/basket">Basket →</a>
        </div>
        <TourBazaarLink overlay className="absolute right-3 top-2 z-40" />
        {/* The same music as the store's Free Tour (owner: "same music source and a speaker on top same place"). */}
        <WalkSound place="right-[5.5rem] top-3" label={false} audioKeys={kit.sound?.keys ?? []} srcOf={soundSrc}
          radio={(kit.sound?.radio ?? null) as Parameters<typeof WalkSound>[0]["radio"]} />
      </div>

      <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden"
        onClick={() => { if (open) return; if (sec && at.show) openSection(sec); else setPaused((p) => !p); }}>
        {/* The whole shelf, gliding into the section in view. */}
        <div className="absolute origin-top-left"
          style={{
            left: fit.ox, top: fit.oy, width: fit.fw, height: fit.fh,
            transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`,
            transition: `transform ${GLIDE_MS}ms cubic-bezier(.45,.05,.35,1)`,
            backgroundImage: shelf.photo?.thumb ? `url(${shelf.photo.thumb})` : undefined, backgroundSize: "100% 100%",
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img {...noSave} src={shelf.photo!.url} alt={label} className="absolute inset-0 h-full w-full select-none" />
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none"
            style={{ opacity: at.k < 0 ? 1 : 0.35, transition: "opacity 600ms" }}>
            {sections.map((x) => x.quad && (
              <polygon key={x.id} points={[0, 1, 2, 3].map((k) => `${x.quad![k * 2]},${x.quad![k * 2 + 1]}`).join(" ")}
                fill={open?.section.id === x.id ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.001)"} stroke="rgba(255,255,255,0.85)" strokeWidth={1.5}
                vectorEffect="non-scaling-stroke" className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); if (!open) openSection(x); }} />
            ))}
          </svg>
        </div>
        {/* The section's own photo, as uploaded, faded in once the glide has arrived. */}
        {sections.map((x) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img {...noSave} key={x.id} src={x.url} alt=""
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
            style={{ opacity: sec?.id === x.id && at.show ? 1 : 0, transition: "opacity 500ms" }} />
        ))}
        {/* One product at a time (Type V), over its section's photo, in the section's order. */}
        {product && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 p-4" key={product.id}>
            <div className="flex max-h-full max-w-[min(90%,34rem)] flex-col items-center gap-2 rounded-2xl bg-white p-3 text-neutral-900 shadow-2xl">
              {product.photo
                // eslint-disable-next-line @next/next/no-img-element
                ? <div className="relative"><img {...noSave} src={product.photo} alt="" className="max-h-[45vh] max-w-full rounded-lg object-contain" /><Watermark size="sm" address={false} sparse /></div>
                : <div className="flex h-40 w-40 items-center justify-center text-[48px]">🛍️</div>}
              <p className="text-center text-[17px] font-bold leading-snug">{(lang === "fa" ? product.fa || product.en : product.en || product.fa) || "Product"}</p>
              {product.priceCents !== null && product.priceCents > 0 && <p className="text-[16px] font-extrabold text-emerald-700">{formatCents(product.priceCents)}</p>}
              <p className="text-[12px] text-neutral-500">{lang === "fa" ? "برای خرید روی آن بزنید" : "Tap to buy"}</p>
            </div>
          </div>
        )}
        {/* Where the tour is, in words: the shelf, the section, the product. */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/65 px-3 py-1 text-[13px] font-semibold text-white">
          {at.k < 0
            ? (lang === "fa" ? "کل قفسه" : "The whole shelf")
            : `${lang === "fa" ? "بخش" : "Section"} ${at.k + 1} ${lang === "fa" ? "از" : "of"} ${sections.length}${product ? ` · ${lang === "fa" ? "محصول" : "Product"} ${step.j + 1} ${lang === "fa" ? "از" : "of"} ${Math.min(MAX_SHOWN, sections[at.k].products.length)}` : ""}`}
        </div>
        {/* The bazaar's mark over whatever photo is showing (it stays put while the shelf glides): sparse here. */}
        <Watermark size="lg" sparse />

        {/* Share (owner, 2026-11-15): the whole shelf, or the section in view; the receiver lands there in the Free Tour.
            In the corner, never over the photo's middle; a tap on it neither pauses nor opens the panel. */}
        {!open && (
          <div className="absolute right-3 top-3 z-10" onClick={(e) => e.stopPropagation()}>
            <ShareKey base={kit.link} lang={lang}
              to={sec ? { shelf: shelf.id, section: sec.i } : { shelf: shelf.id }}
              title={sec ? `${label} · ${lang === "fa" ? "بخش" : "Section"} ${sec.i}` : label}
              className="shadow" />
          </div>
        )}
        {/* The tapped section grown out of its place, a funnel from there, and the shopping panel. */}
        {open && target && shown && (
          <div className="absolute inset-0 z-20" onClick={(e) => { e.stopPropagation(); close(); }}>
            <div className="absolute inset-0 bg-black/45" style={{ opacity: grown ? 1 : 0, transition: `opacity ${GROW_MS}ms` }} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity: grown ? 1 : 0, transition: `opacity ${GROW_MS}ms` }}>
              <defs>
                <linearGradient id="kit-funnel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.28" /><stop offset="1" stopColor="#fff" stopOpacity="0.08" /></linearGradient>
              </defs>
              <polygon points={hull([...corners(open.from), ...corners(target)]).map((p) => p.join(",")).join(" ")} fill="url(#kit-funnel)" stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
              <rect x={open.from.x} y={open.from.y} width={open.from.w} height={open.from.h} fill="none" stroke="#fff" strokeWidth={2} />
            </svg>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img {...noSave} src={open.section.url} alt="" onClick={(e) => e.stopPropagation()}
              className="absolute select-none rounded-lg bg-white object-contain shadow-2xl ring-2 ring-white"
              style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h, transition: `all ${GROW_MS}ms cubic-bezier(.2,.8,.2,1)` }} />
            <div className="pointer-events-none absolute overflow-hidden rounded-lg"
              style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h, transition: `all ${GROW_MS}ms cubic-bezier(.2,.8,.2,1)` }}>
              <Watermark size="lg" address={false} sparse />
            </div>
            <KitPanel share={{ base: kit.link, shelf: shelf.id }} section={open.section} title={shelf.label} merchant={kit.merchant || name} href={`/vca/tour?s=${encodeURIComponent(slug)}`}
              lang={lang} onLang={setLang} onClose={close} highlight={open.highlight}
              className={narrow ? "absolute inset-x-2 bottom-2 top-[44%]" : "absolute bottom-3 right-3 top-3 w-[400px] max-w-[42%]"}
            />
          </div>
        )}
      </div>

      {/* The tour's bar: it fills as the shelf's tour plays; a section's start is a tick; a tap goes there. */}
      <div className="relative mx-3 mt-1 h-2.5 cursor-pointer rounded-full bg-white/15" role="slider" aria-label="Where the shelf's tour is"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={total ? Math.round((clock.current / total) * 100) : 0}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * total); setPaused(false); }}>
        <div ref={bar} className="absolute inset-y-0 left-0 rounded-full bg-[#00B8C8]" style={{ width: 0 }} />
        {steps.filter((q) => q.kind === "section" || (q.kind === "glide")).filter((q, i, a) => a.findIndex((r) => r.k === q.k) === i).map((q) => (
          <div key={q.k} className="absolute inset-y-0 w-0.5 bg-white/60" style={{ left: `${total ? (q.from / total) * 100 : 0}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2">
        <button type="button" className={btn} disabled={si === 0} onClick={() => { setOpen(null); setSi((i) => Math.max(0, i - 1)); }}>‹ {lang === "fa" ? "قفسه قبلی" : "Previous shelf"}</button>
        <button type="button" className={btn} onClick={() => { if (paused && clock.current >= total) seek(0); setPaused((p) => !p); }} aria-label={paused ? "Play" : "Pause"}>{paused ? "▶" : "❚❚"}</button>
        <div className="flex items-center gap-1.5 px-1" aria-label="Sections">
          <button type="button" aria-label="The whole shelf" onClick={() => seek(0)}
            className={`h-2.5 w-4 rounded-full ${at.k < 0 ? "bg-white" : "bg-white/30"}`} />
          {sections.map((x, k) => (
            <button key={x.id} type="button" aria-label={`Section ${x.i}`} onClick={() => { setPaused(false); seek(steps.find((q) => q.k === k)?.from ?? 0); }}
              className={`h-2.5 w-2.5 rounded-full ${at.k === k ? "bg-[#00B8C8]" : "bg-white/30"}`} />
          ))}
        </div>
        <span className="hidden text-[13px] text-white/70 sm:inline">{label} · {si + 1} / {shelves.length}</span>
        <button type="button" className={btn} disabled={si >= shelves.length - 1} onClick={() => { setOpen(null); setSi((i) => Math.min(shelves.length - 1, i + 1)); }}>{lang === "fa" ? "قفسه بعدی" : "Next shelf"} ›</button>
      </div>
    </div>
  );
}
