"use client";

/**
 * THE SHELF TOUR, FROM THE SHELVES' OWN PHOTOS (owner, 2026-11-15: "Lets do the Shelf Tours also get re-designed based
 * on quality photos of Type IV & type V"; "No video right"). For a store with a shelf kit (`lib/stores/kitRules.ts`):
 *
 *   1  each shelf opens on its whole quality photo (Type III), its sections outlined thinly;
 *   2  after 2 s the view glides into section 1 (its place in the shelf photo), and the section's own photo (Type IV,
 *      as uploaded) fades in over it; 4 s later it glides on to the next section; after the last, back to the whole
 *      shelf, and it waits (it never moves to the next shelf by itself);
 *   3  a tap on a section (or on the section in view) stops it: the section's photo grows out of where it was, with a
 *      funnel from that place, to the bottom left, and the shopping panel (`KitPanel`) opens on the right. Closing
 *      the panel closes the photo and the tour goes on;
 *   4  «‹ Previous shelf» / «Next shelf ›», a dot per section, pause / play.
 *
 * A section whose place in the shelf photo was not found is shown by its own photo fading in, without the glide.
 * Phones are held upright: sideways, the screen says so.
 */
import { noSave } from "./noSave";
import ShareKey from "./ShareKey";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TourBazaarLink from "@/components/brand/TourBazaarLink";
import KitPanel, { type Lang } from "./KitPanel";
import type { ShopKit, ShopSection, ShopShelf } from "@/lib/stores/kitRules";

const WHOLE_MS = 2000, GLIDE_MS = 1600, HOLD_MS = 4000, GROW_MS = 450;
type Rect = { x: number; y: number; w: number; h: number };
/** Where the tour is: `k` the section in view (-1: the whole shelf), `show` its own photo faded in. */
type At = { k: number; show: boolean };

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
  const [at, setAt] = useState<At>({ k: -1, show: false });
  const [paused, setPaused] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [open, setOpen] = useState<{ section: ShopSection; from: Rect } | null>(null);
  const [grown, setGrown] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sideways = useUpright();
  /** The last section has been shown: back on the whole shelf, the tour waits. */
  const finished = useRef(false);
  const shelf = shelves[Math.min(si, shelves.length - 1)];
  const sections = shelf?.sections ?? [];

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // A new shelf starts on its whole photo; its section photos are fetched ahead.
  useEffect(() => {
    setAt({ k: -1, show: false });
    setPaused(false);
    finished.current = false;
    for (const x of shelf?.sections ?? []) { const im = new Image(); im.src = x.url; }
  }, [shelf]);

  // The tour's clock: whole shelf → glide into a section → its photo → the next … → the whole shelf, then wait.
  useEffect(() => {
    if (paused || open || !shelf || !sections.length) return;
    const ms = at.k < 0 ? WHOLE_MS : at.show ? HOLD_MS : GLIDE_MS;
    if (at.k < 0 && finished.current) { finished.current = false; setPaused(true); return; }
    const id = setTimeout(() => {
      if (at.k < 0) setAt({ k: 0, show: false });
      else if (!at.show) setAt({ k: at.k, show: true });
      else if (at.k + 1 < sections.length) setAt({ k: at.k + 1, show: false });
      else { finished.current = true; setAt({ k: -1, show: false }); }
    }, ms);
    return () => clearTimeout(id);
  }, [at, paused, open, shelf, sections.length]);

  // The shelf photo fitted in the stage, and the glide into the section in view.
  const fit = useMemo(() => {
    const pw = shelf?.photo?.w || 4, ph = shelf?.photo?.h || 3;
    const s = Math.min(size.w / pw, size.h / ph) || 0;
    const fw = pw * s, fh = ph * s;
    return { fw, fh, ox: (size.w - fw) / 2, oy: (size.h - fh) / 2 };
  }, [shelf, size]);
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
    setOpen({ section: x, from: rectOf(x) });
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
  const walkHref = kit.walk ? `/vca/walk?v=${encodeURIComponent(kit.walk)}` : null;
  const btn = "rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/20 disabled:opacity-30";

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[14px]">
        <TourBazaarLink />
        <div className="me-auto min-w-0 flex-1 truncate"><b>{name}</b>{kit.title?.fa ? <span className="text-white/60"> · {kit.title.fa}</span> : null} · <span className="text-white/60">Shelf Tour</span></div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center rounded-full border border-white/25 bg-black/70 p-1 font-semibold">
            <span className="rounded-full bg-[#00B8C8] px-3 py-1 text-[#06131c]">🛒 Shelf Tour</span>
            {walkHref && <a className="rounded-full px-3 py-1 text-white/80" href={walkHref}>👣 Free Tour</a>}
          </span>
          <a className="text-[#00B8C8] underline" href="/basket">Basket →</a>
        </div>
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
            <KitPanel share={{ base: kit.link, shelf: shelf.id }} section={open.section} title={shelf.label} merchant={kit.merchant || name} href={`/vca/tour?s=${encodeURIComponent(slug)}`}
              lang={lang} onLang={setLang} onClose={close}
              className={narrow ? "absolute inset-x-2 bottom-2 top-[44%]" : "absolute bottom-3 right-3 top-3 w-[400px] max-w-[42%]"}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2">
        <button type="button" className={btn} disabled={si === 0} onClick={() => { setOpen(null); setSi((i) => Math.max(0, i - 1)); }}>‹ {lang === "fa" ? "قفسه قبلی" : "Previous shelf"}</button>
        <button type="button" className={btn} onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play" : "Pause"}>{paused ? "▶" : "❚❚"}</button>
        <div className="flex items-center gap-1.5 px-1" aria-label="Sections">
          <button type="button" aria-label="The whole shelf" onClick={() => { setAt({ k: -1, show: false }); finished.current = false; }}
            className={`h-2.5 w-4 rounded-full ${at.k < 0 ? "bg-white" : "bg-white/30"}`} />
          {sections.map((x, k) => (
            <button key={x.id} type="button" aria-label={`Section ${x.i}`} onClick={() => { setPaused(false); setAt({ k, show: false }); }}
              className={`h-2.5 w-2.5 rounded-full ${at.k === k ? "bg-[#00B8C8]" : "bg-white/30"}`} />
          ))}
        </div>
        <span className="hidden text-[13px] text-white/70 sm:inline">{label} · {si + 1} / {shelves.length}</span>
        <button type="button" className={btn} disabled={si >= shelves.length - 1} onClick={() => { setOpen(null); setSi((i) => Math.min(shelves.length - 1, i + 1)); }}>{lang === "fa" ? "قفسه بعدی" : "Next shelf"} ›</button>
      </div>
    </div>
  );
}
