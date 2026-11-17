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
 * ⚠️ THE SCREEN IN TWO (owner, 2026-11-17: "divide the screen to two vertical section on the left always keep photo of
 * the shelf (type III) on the right make two parts the shelf level on top and the product (item) below"; "add the قفسه
 * دوم with the name on top of the type III photo"): the left half is the shelf's photo, always, «قفسه دوم · its name»
 * above it and the section in view outlined in it (no glide any more); the right half is the section's photo (IV) on
 * top and the product (V) below.
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
import MusicPicker, { NO_MUSIC } from "./MusicPicker";
import { radioSourceOf, type RadioSource } from "@/lib/radio";
import { faShelfOrdinal, sectionLabel, type ShopKit, type ShopProduct, type ShopSection, type ShopShelf } from "@/lib/stores/kitRules";
import { formatCents } from "@/lib/splats/catalogue";

/** Room under the shelf's photo for its title. */
const TITLE_H = 64;
const WHOLE_MS = 2500, SECTION_MS = 3000, PRODUCT_MS = 2400, GROW_MS = 450;
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
  // The shopper's music choice for this visit, as in the Free Tour's tray (owner, 2026-11-17: "in the shelf tour add
  // the same music choice dropdown and volume as well"); null: the walk's default.
  const [music, setMusic] = useState<RadioSource | typeof NO_MUSIC | null>(null);
  const channels = useMemo(() => {
    const list = (kit.sound?.radios ?? []).map(radioSourceOf).filter((x): x is RadioSource => Boolean(x));
    const def = radioSourceOf(kit.sound?.radio);
    return list.length ? list : def ? [def] : [];
  }, [kit]);
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

  // ‹ › on the level (IV) and the product (V) (owner, 2026-11-17: "put < and > on both side of photos so shoppers can go
  // back one product or one level back or forth"): to the step's start; past the shelf's end, the next shelf.
  const nextShelf = () => setSi((i) => (i + 1 < shelves.length ? i + 1 : 0));
  const goSection = (d: 1 | -1) => {
    const k = (steps[si2]?.k ?? -1) < 0 ? (d > 0 ? 0 : -1) : steps[si2].k + d;
    if (k >= sections.length) return nextShelf();
    if (k < 0) return seek(0);
    seek(steps.find((q) => q.kind === "section" && q.k === k)?.from ?? 0);
  };
  const goProduct = (d: 1 | -1) => {
    let i = si2 + d;
    while (i >= 0 && i < steps.length && steps[i].kind !== "product") i += d;
    if (i >= steps.length || i < 0) return d > 0 ? nextShelf() : seek(0);
    seek(steps[i].from);
  };
  /** ‹ › close beside a photo (owner, 2026-11-17: "attached (with a bit of distance) to the object"): `x` is where the
   *  photo's side is; the key sits GAP px outside it, never off the box. */
  const ARROW = 40, GAP = 6;
  const arrowRow = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/60 text-[26px] font-bold leading-none text-white shadow ring-1 ring-white/30 hover:bg-black/80";
  const arrow = "absolute z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-[26px] font-bold leading-none text-white shadow ring-1 ring-white/30 hover:bg-black/80";

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
      // The shelf done: on to the next by itself, after the last the first again (owner, 2026-11-17: "automatically go
      // to the next shelf do not wait for shopper").
      if (clock.current >= total) { setSi((i) => (i + 1 < shelves.length ? i + 1 : 0)); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, open, shelf, sections.length, steps, total, shelves.length]);

  // The shelf photo (Type III) fitted in the left half (owner, 2026-11-17: "divide the screen to two vertical section on
  // the left always keep photo of the shelf (type III) on the right make two parts the shelf level on top and the
  // product (item) below").
  const left = useRef<HTMLDivElement>(null);
  const [lsize, setLsize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = left.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLsize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setLsize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fit = useMemo(() => {
    const pw = shelf?.photo?.w || 4, ph = shelf?.photo?.h || 3;
    const s = Math.min(lsize.w / pw, Math.max(0, lsize.h - TITLE_H) / ph) || 0;
    return { fw: pw * s, fh: ph * s };
  }, [shelf, lsize]);
  const sec = at.k >= 0 ? sections[at.k] : null;
  // Before the first section, the right shows section 1 faintly (the shelf on the left is what is on show).
  const shownSec = sec ?? sections[0] ?? null;
  const secBox = useRef<HTMLDivElement>(null);
  const [sb, setSb] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = secBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSb({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSb({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  /** How far in from each side the level's photo starts (object-contain), so its ‹ › sit close to it. */
  const secIn = (() => {
    const a = shownSec && shownSec.w && shownSec.h ? shownSec.w / shownSec.h : 4 / 3;
    return Math.max(0, (sb.w - Math.min(sb.w, sb.h * a)) / 2);
  })();
  /** The section photo's place on screen (stage pixels), where the grown photo starts from. */
  const rectOf = useCallback((): Rect => {
    const st = stage.current?.getBoundingClientRect(), r = secBox.current?.getBoundingClientRect();
    if (!st || !r) return { x: size.w * 0.5, y: 0, w: size.w * 0.5, h: size.h * 0.5 };
    return { x: r.left - st.left, y: r.top - st.top, w: r.width, h: r.height };
  }, [size]);

  const openSection = (x: ShopSection) => {
    setOpen({ section: x, from: rectOf(), ...(product && sec?.id === x.id ? { highlight: product.id } : {}) });
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
  const faName = shelf.label.fa.replace(/^[\d۰-۹]+\s*·\s*/, "").trim();
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
        <div className="me-auto min-w-0 flex-1 truncate xl:max-w-[calc(50%-15rem)]"><b>{name}</b>{kit.title?.fa ? <span className="text-white/60"> · {kit.title.fa}</span> : null} · <span className="text-white/60">Shelf Tour</span></div>
        <div className="flex shrink-0 items-center gap-2 text-[13px]">
          <span className="flex items-center rounded-full border border-white/25 bg-black/70 p-1 font-semibold">
            <span className="rounded-full bg-[#00B8C8] px-2.5 py-1 text-[#06131c]">🛒 Shelf Tour</span>
            {walkHref && <a className="rounded-full px-2.5 py-1 text-white/80" href={walkHref}>👣 Free Tour</a>}
          </span>
          <a className="text-[#00B8C8] underline" href="/basket">Basket →</a>
        </div>
        {/* The music, at the top, in the middle (owner, 2026-11-17: "move the music drop down on top section and centered
            (both tours)"). */}
        {(channels.length > 0 || (kit.sound?.keys.length ?? 0) > 0) && (
          <div className="z-30 order-last mx-auto w-full max-w-[20rem] basis-full rounded-2xl bg-black/70 p-1 xl:absolute xl:left-1/2 xl:top-2 xl:w-[16rem] xl:-translate-x-1/2 xl:basis-auto">
            <MusicPicker channels={channels} lang={lang} onPick={setMusic}
              current={music === NO_MUSIC ? NO_MUSIC : (music ?? radioSourceOf(kit.sound?.radio))?.id ?? null} />
          </div>
        )}
        <TourBazaarLink overlay className="absolute right-3 top-2 z-40" />
        {/* The same music as the store's Free Tour (owner: "same music source and a speaker on top same place"). */}
{music !== NO_MUSIC && <WalkSound place="right-[5.5rem] top-3" label={false} audioKeys={kit.sound?.keys ?? []} srcOf={soundSrc}
          radio={(music ?? kit.sound?.radio ?? null) as Parameters<typeof WalkSound>[0]["radio"]} />}
      </div>

      <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden"
        onClick={() => { if (open) return; setPaused((p) => !p); }}>
        <div className="absolute inset-0 flex">
          {/* LEFT: the shelf (Type III), always; «قفسه دوم · its name» on top; the section in view outlined. */}
          <div className="flex w-1/2 min-w-0 flex-col border-r border-white/10 p-2">
            <div ref={left} className="relative min-h-0 flex-1">
              {/* The photo at the top, its title right under it (owner, 2026-11-17: "bring the type III photo higher and
                  bring the title to be underneath the photo"). */}
              <div className="absolute left-1/2 top-0 -translate-x-1/2" style={{ width: fit.fw, height: fit.fh }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img {...noSave} src={shelf.photo!.url} alt={label} className="absolute inset-0 h-full w-full select-none rounded"
                  style={{ backgroundImage: shelf.photo?.thumb ? `url(${shelf.photo.thumb})` : undefined, backgroundSize: "100% 100%" }} />
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                  {sections.map((x) => x.quad && (
                    <polygon key={x.id} points={[0, 1, 2, 3].map((k) => `${x.quad![k * 2]},${x.quad![k * 2 + 1]}`).join(" ")}
                      fill={sec?.id === x.id ? "rgba(0,184,200,0.18)" : "rgba(255,255,255,0.001)"}
                      stroke={sec?.id === x.id ? "#00B8C8" : "rgba(255,255,255,0.55)"} strokeWidth={sec?.id === x.id ? 3 : 1}
                      vectorEffect="non-scaling-stroke" style={{ transition: "all 400ms" }} />
                  ))}
                </svg>
                <Watermark size="sm" sparse />
              </div>
              {/* ‹ › beside the shelf's photo: the shelf before / after (owner, 2026-11-17: "add two also on the sides of
                  TYPE III (shelf) so shopper can quickly maneuver though shelves"). */}
              <button type="button" aria-label="Previous shelf" className={arrow} style={{ top: fit.fh / 2, left: Math.max(0, (lsize.w - fit.fw) / 2 - ARROW - GAP) }}
                onClick={(e) => { e.stopPropagation(); setOpen(null); setSi((i) => (i > 0 ? i - 1 : shelves.length - 1)); }}>‹</button>
              <button type="button" aria-label="Next shelf" className={arrow} style={{ top: fit.fh / 2, right: Math.max(0, (lsize.w - fit.fw) / 2 - ARROW - GAP) }}
                onClick={(e) => { e.stopPropagation(); setOpen(null); nextShelf(); }}>›</button>
              <div className="absolute inset-x-0 text-center" style={{ top: fit.fh + 6 }}>
                <p dir="rtl" className="text-[clamp(17px,2.6vw,26px)] font-extrabold leading-tight text-amber-100">
                  {faShelfOrdinal(shelf.n ?? si + 1)}{faName ? ` · ${faName}` : ""}
                </p>
                <p className="text-[clamp(11px,1.4vw,14px)] text-white/60">{shelf.label.en}</p>
              </div>
            </div>
          </div>

          {/* RIGHT: the shelf level (Type IV) on top, the product (Type V) below. */}
          <div className="flex w-1/2 min-w-0 flex-col">
            <div className="relative min-h-0 flex-1 border-b border-white/10 p-2">
              <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-black/65 px-3 py-1 text-[13px] font-semibold text-white">
                {at.k < 0
                  ? (lang === "fa" ? "کل قفسه" : "The whole shelf")
                  : `${sections[at.k].name ? `${sectionLabel(sections[at.k], lang)} · ` : ""}${lang === "fa" ? "بخش" : "Section"} ${at.k + 1} ${lang === "fa" ? "از" : "of"} ${sections.length}${product ? ` · ${lang === "fa" ? "محصول" : "Product"} ${step.j + 1} ${lang === "fa" ? "از" : "of"} ${Math.min(MAX_SHOWN, sections[at.k].products.length)}` : ""}`}
              </div>
              <div ref={secBox} className="relative h-full w-full">
                {sections.map((x) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img {...noSave} key={x.id} src={x.url} alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                    style={{ opacity: shownSec?.id === x.id ? (sec ? 1 : 0.35) : 0, transition: "opacity 500ms" }} />
                ))}
                <Watermark size="sm" address={false} sparse />
                <button type="button" aria-label="Previous level" className={`${arrow} top-1/2`} style={{ left: Math.max(0, secIn - ARROW - GAP) }} onClick={(e) => { e.stopPropagation(); goSection(-1); }}>‹</button>
                <button type="button" aria-label="Next level" className={`${arrow} top-1/2`} style={{ right: Math.max(0, secIn - ARROW - GAP) }} onClick={(e) => { e.stopPropagation(); goSection(1); }}>›</button>
              </div>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center gap-1.5 px-2 py-2">
              <button type="button" aria-label="Previous product" className={arrowRow} onClick={(e) => { e.stopPropagation(); goProduct(-1); }}>‹</button>
              {product ? (
                <div key={product.id} className="flex max-h-full min-w-0 max-w-[420px] flex-1 flex-col items-center gap-1.5 rounded-2xl bg-white p-2.5 text-neutral-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  {product.photo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <div className="relative min-h-0"><img {...noSave} src={product.photo} alt="" className="max-h-[22vh] max-w-full rounded-lg object-contain" /><Watermark size="sm" address={false} sparse /></div>
                    : <div className="flex h-24 w-24 items-center justify-center text-[40px]">🛍️</div>}
                  <p className="text-center text-[clamp(13px,1.6vw,17px)] font-bold leading-snug">{(lang === "fa" ? product.fa || product.en : product.en || product.fa) || "Product"}</p>
                  {product.priceCents !== null && product.priceCents > 0 && <p className="text-[15px] font-extrabold text-emerald-700">{formatCents(product.priceCents)}</p>}
                  <button type="button" onClick={() => sec && openSection(sec)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-bold text-white shadow">🛒 {lang === "fa" ? "خرید" : "Buy"}</button>
                </div>
              ) : sec && sec.products.length > 0 ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); openSection(sec); }}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-[14px] font-bold text-white shadow-lg">
                  🛒 {lang === "fa" ? "خرید از این بخش" : "Shop this section"} · {sec.products.length}
                </button>
              ) : (
                <p className="text-center text-[13px] text-white/50">{lang === "fa" ? "محصولات هر بخش اینجا می‌آیند" : "Each section's products show here"}</p>
              )}
              <button type="button" aria-label="Next product" className={arrowRow} onClick={(e) => { e.stopPropagation(); goProduct(1); }}>›</button>
            </div>
          </div>
        </div>
        {paused && !open && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="rounded-full bg-black/60 px-4 py-2 text-[15px] font-semibold text-white">❚❚ {lang === "fa" ? "برای ادامه بزنید" : "Tap to go on"}</span>
          </div>
        )}
        {/* Share (owner, 2026-11-15): the whole shelf, or the section in view; the receiver lands there in the Free Tour.
            In the corner, never over the photo's middle; a tap on it neither pauses nor opens the panel. */}
        {!open && (
          <div className="absolute right-3 top-3 z-10" onClick={(e) => e.stopPropagation()}>
            <ShareKey base={kit.link} lang={lang}
              to={sec ? { shelf: shelf.id, section: sec.i } : { shelf: shelf.id }}
              title={sec ? `${label} · ${sectionLabel(sec, lang)}` : label}
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
        {steps.filter((q) => q.kind === "section").filter((q, i, a) => a.findIndex((r) => r.k === q.k) === i).map((q) => (
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
