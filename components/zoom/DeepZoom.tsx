"use client";

/**
 * A SHELF'S ZOOM PHOTO, FULL SCREEN (owner, 2026-11-11: "user (once switch its focus on this shelf) to be able to
 * zoom in and out and read labels"). The photo is ~100 megapixels, cut into tiles at every size (`lib/zoom/
 * pyramid.ts`, made by `scripts/stitch/stack.py`); this draws ONLY the tiles on screen at the size on screen, so a
 * phone holds a dozen small pictures, never the photo.
 *
 *   wheel / pinch / + −      zoom, about the cursor or the fingers; double tap zooms in on that spot
 *   drag                     pan; the photo's edge never comes inside the screen (`clampView`)
 *   the mini-map (corner)    the whole shelf with the part on screen outlined; tap or drag it to go there
 *   ✕ / Esc                  back to the walk, where it was left
 *
 * A level stays on screen until the sharper one over it has loaded, so zooming never flashes black. No library:
 * the tiles are plain <img>s placed by hand.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { baseLevel, baseOf, clampView, fitScale, levelFor, MAX_SCALE, parsePyramid, tileUrl, viewRect, visibleTiles, zoomAbout, type Pyramid, type Tile, type View } from "@/lib/zoom/pyramid";

type Shown = { el: HTMLImageElement; tile: Tile; loaded: boolean };
const MAP_SIDE = 132;

export default function DeepZoom({ manifest, title, onClose }: { manifest: string; title?: { en: string; fa?: string }; onClose: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const mapRect = useRef<HTMLDivElement | null>(null);
  const [pyr, setPyr] = useState<Pyramid | null>(null);
  const [error, setError] = useState("");
  const [percent, setPercent] = useState(0);
  const [hint, setHint] = useState(true);
  const api = useRef<{ zoomBy: (f: number) => void; fit: () => void; goTo: (fx: number, fy: number) => void } | null>(null);

  useEffect(() => {
    let gone = false;
    setPyr(null);
    setError("");
    void (async () => {
      try {
        const res = await fetch(manifest, { cache: "force-cache" });
        const p = res.ok ? parsePyramid(await res.json()) : null;
        if (!p) throw new Error("no manifest");
        if (!gone) setPyr(p);
      } catch {
        if (!gone) setError("This shelf's photo could not be opened. Check the connection and try again. · عکس این قفسه باز نشد.");
      }
    })();
    return () => { gone = true; };
  }, [manifest]);

  // Esc closes, whatever is loaded.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    const el = box.current, host = layer.current;
    if (!pyr || !el || !host) return;
    const base = baseOf(manifest);
    const p = pyr;
    let vw = el.clientWidth, vh = el.clientHeight;
    let view: View = clampView(p, { cx: p.w / 2, cy: p.h / 2, scale: 0 }, vw, vh);
    /** Where a wheel or a key is taking the zoom: eased toward, about a screen point. */
    let aim: { scale: number; sx: number; sy: number } | null = null;
    const shown = new Map<string, Shown>();
    let raf = 0, dead = false, lastPercent = -1;

    const put = (s: Shown, r: { x: number; y: number }) => {
      const l = Math.floor((s.tile.x - r.x) * view.scale), t = Math.floor((s.tile.y - r.y) * view.scale);
      const rr = Math.ceil((s.tile.x + s.tile.w - r.x) * view.scale), bb = Math.ceil((s.tile.y + s.tile.h - r.y) * view.scale);
      s.el.style.transform = `translate(${l}px, ${t}px)`;
      s.el.style.width = `${rr - l}px`;
      s.el.style.height = `${bb - t}px`;
    };
    function draw() {
      raf = 0;
      if (dead) return;
      if (aim) {
        const k = aim.scale / view.scale;
        const next = Math.abs(Math.log(k)) < 0.004 ? aim.scale : view.scale * k ** 0.28;
        view = zoomAbout(p, view, next, aim.sx, aim.sy, vw, vh);
        if (next === aim.scale || Math.abs(view.scale - next) > 1e-9) aim = null; // arrived, or stopped at a limit
        else ask();
      }
      const r = viewRect(view, vw, vh);
      const level = levelFor(p, view.scale, Math.min(2, window.devicePixelRatio || 1));
      // The whole shelf at its smallest is always under everything: never a black hole while tiles load.
      const want = new Map<string, Tile>();
      for (const t of visibleTiles(p, baseLevel(p), { cx: p.w / 2, cy: p.h / 2, scale: 1e-6 }, 1, 1)) want.set(`${t.level}/${t.col}_${t.row}`, t);
      for (const t of visibleTiles(p, level, view, vw, vh)) want.set(`${t.level}/${t.col}_${t.row}`, t);
      // Half way through a long zoom the levels passed on the way are not asked for: only where it settles.
      const passing = Boolean(aim && Math.abs(Math.log2(aim.scale / view.scale)) > 1);
      for (const [k, t] of want) {
        if (shown.has(k) || (passing && t.level !== baseLevel(p))) continue;
        const img = document.createElement("img");
        img.decoding = "async";
        img.draggable = false;
        img.alt = "";
        img.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;user-select:none;pointer-events:none;z-index:${t.level};opacity:0;transition:opacity .18s`;
        const s: Shown = { el: img, tile: t, loaded: false };
        img.onload = () => { s.loaded = true; img.style.opacity = "1"; ask(); };
        img.onerror = () => { img.remove(); shown.delete(k); window.setTimeout(ask, 1500); }; // asked for again
        img.src = tileUrl(base, p, t);
        shown.set(k, s);
        host!.appendChild(img);
      }
      // What the new level does not cover yet stays; the rest goes.
      const ready = !passing && [...want.keys()].every((k) => shown.get(k)?.loaded);
      for (const [k, s] of shown) {
        if (want.has(k)) { put(s, r); continue; }
        const inView = s.tile.x < r.x + r.w && s.tile.x + s.tile.w > r.x && s.tile.y < r.y + r.h && s.tile.y + s.tile.h > r.y;
        if (ready || !inView || !s.loaded || shown.size > 90) { s.el.remove(); shown.delete(k); } else put(s, r);
      }
      const m = mapRect.current;
      if (m) {
        const cl = (v: number) => Math.min(1, Math.max(0, v));
        const x0 = cl(r.x / p.w), y0 = cl(r.y / p.h), x1 = cl((r.x + r.w) / p.w), y1 = cl((r.y + r.h) / p.h);
        m.style.left = `${x0 * 100}%`; m.style.top = `${y0 * 100}%`; m.style.width = `${(x1 - x0) * 100}%`; m.style.height = `${(y1 - y0) * 100}%`;
      }
      const pc = Math.round(view.scale * 100);
      if (pc !== lastPercent) { lastPercent = pc; setPercent(pc); }
    }
    const ask = () => { if (!raf && !dead) raf = requestAnimationFrame(draw); };
    const set = (v: View) => { view = clampView(p, v, vw, vh); ask(); };

    // ── Fingers and the mouse ──
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0, lastTap = 0, downAt = 0;
    const at = (e: { clientX: number; clientY: number }) => { const b = el.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-zoom-ui]")) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, at(e));
      aim = null;
      if (pointers.size === 1) { moved = 0; downAt = performance.now(); }
      setHint(false);
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const now = at(e);
      if (pointers.size === 1) {
        moved += Math.abs(now.x - prev.x) + Math.abs(now.y - prev.y);
        set({ ...view, cx: view.cx - (now.x - prev.x) / view.scale, cy: view.cy - (now.y - prev.y) / view.scale });
      } else if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(now.x - other.x, now.y - other.y);
        const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }, m1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        // The shelf under the fingers' middle stays under it: pan by its move, zoom about it.
        const panned = { ...view, cx: view.cx - (m1.x - m0.x) / view.scale, cy: view.cy - (m1.y - m0.y) / view.scale };
        view = d0 > 8 ? zoomAbout(p, panned, view.scale * (d1 / d0), m1.x, m1.y, vw, vh) : clampView(p, panned, vw, vh);
        moved += 99;
        ask();
      }
      pointers.set(e.pointerId, now);
    };
    const onUp = (e: PointerEvent) => {
      const had = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!had || pointers.size) return;
      // A double tap (or double click): in on that spot; at the closest already, back to the whole shelf.
      if (moved < 12 && performance.now() - downAt < 350) {
        const t = performance.now();
        if (t - lastTap < 320) {
          const near = view.scale >= Math.max(MAX_SCALE, fitScale(p, vw, vh)) * 0.8;
          aim = { scale: near ? fitScale(p, vw, vh) : view.scale * 2.6, sx: had.x, sy: had.y };
          lastTap = 0;
          ask();
        } else lastTap = t;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const q = at(e);
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? vh : 1;
      const from = aim?.scale ?? view.scale;
      aim = { scale: from * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.012 : 0.0022)), sx: q.x, sy: q.y };
      setHint(false);
      ask();
    };
    const onKey = (e: KeyboardEvent) => {
      const step = 0.2 * Math.min(vw, vh) / view.scale;
      if (e.key === "+" || e.key === "=") api.current?.zoomBy(1.6);
      else if (e.key === "-" || e.key === "_") api.current?.zoomBy(1 / 1.6);
      else if (e.key === "0") api.current?.fit();
      else if (e.key === "ArrowLeft") set({ ...view, cx: view.cx - step });
      else if (e.key === "ArrowRight") set({ ...view, cx: view.cx + step });
      else if (e.key === "ArrowUp") set({ ...view, cy: view.cy - step });
      else if (e.key === "ArrowDown") set({ ...view, cy: view.cy + step });
      else return;
      e.preventDefault();
    };
    api.current = {
      zoomBy: (f) => { aim = { scale: (aim?.scale ?? view.scale) * f, sx: vw / 2, sy: vh / 2 }; ask(); },
      fit: () => { aim = { scale: fitScale(p, vw, vh), sx: vw / 2, sy: vh / 2 }; ask(); },
      goTo: (fx, fy) => { aim = null; set({ ...view, cx: fx * p.w, cy: fy * p.h }); },
    };
    const ro = new ResizeObserver(() => {
      const wasFit = view.scale <= fitScale(p, vw, vh) * 1.001;
      vw = el.clientWidth; vh = el.clientHeight;
      set(wasFit ? { cx: p.w / 2, cy: p.h / 2, scale: 0 } : view);
    });
    ro.observe(el);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    ask();
    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      for (const s of shown.values()) s.el.remove();
      api.current = null;
    };
  }, [pyr, manifest]);

  // The mini-map: a tap or a drag on it puts that part of the shelf in the middle of the screen.
  const onMap = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointermove" && !(e.buttons & 1) && e.pointerType === "mouse") return;
    const b = e.currentTarget.getBoundingClientRect();
    api.current?.goTo((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
  }, []);

  const k = pyr ? MAP_SIDE / Math.max(pyr.w, pyr.h) : 0;
  const key = "flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-[22px] font-bold text-white shadow-lg ring-1 ring-white/25 hover:bg-black/85 active:scale-95";
  return (
    <div ref={box} dir="ltr" data-deep-zoom role="dialog" aria-modal="true" aria-label={title ? `Zoom photo: ${title.en}` : "Zoom photo"}
      className="fixed inset-0 z-[90] cursor-grab touch-none select-none overflow-hidden bg-[#0b0d0f] active:cursor-grabbing">
      <div ref={layer} className="absolute inset-0 isolate z-0" />
      {!pyr && !error && <p className="absolute inset-0 flex items-center justify-center text-[15px] text-white/70">Opening the shelf… · در حال باز کردن قفسه</p>}
      {error && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[15px] text-rose-200">{error}</p>}

      <div data-zoom-ui className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto min-w-0 truncate whitespace-nowrap rounded-full bg-black/65 px-4 py-2 text-[14px] font-semibold text-white ring-1 ring-white/20">
          🔍 {title ? (title.fa ? `${title.fa} · ${title.en}` : title.en) : "Shelf"}{pyr && <span className="ml-2 font-normal text-white/60">{percent}%</span>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close and go back to the walk" className="pointer-events-auto flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 text-[14px] font-bold text-black shadow-lg active:scale-95">
          ✕ <span>بازگشت<span className="hidden sm:inline"> · Back</span></span>
        </button>
      </div>

      {pyr && (
        <>
          <div data-zoom-ui className="absolute bottom-4 right-3 z-10 flex flex-col gap-2">
            <button type="button" className={key} aria-label="Zoom in" onClick={() => api.current?.zoomBy(1.8)}>+</button>
            <button type="button" className={key} aria-label="Zoom out" onClick={() => api.current?.zoomBy(1 / 1.8)}>−</button>
            <button type="button" className={`${key} text-[13px]`} aria-label="The whole shelf" onClick={() => api.current?.fit()}>⤢</button>
          </div>
          <div data-zoom-ui onPointerDown={onMap} onPointerMove={onMap} aria-label="Where you are on the shelf"
            className="absolute bottom-4 left-3 z-10 cursor-pointer overflow-hidden rounded-md bg-black shadow-xl ring-2 ring-white/70"
            style={{ width: Math.max(28, Math.round(pyr.w * k)), height: Math.max(28, Math.round(pyr.h * k)) }}>
            {pyr.thumb && <img src={`${baseOf(manifest)}/${pyr.thumb}`} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />}
            <div ref={mapRect} className="pointer-events-none absolute box-border border-2 border-[#ffd24a] bg-[#ffd24a]/20" />
          </div>
          {hint && (
            <p className="pointer-events-none absolute inset-x-0 bottom-6 z-10 mx-auto w-fit max-w-[70%] rounded-full bg-black/70 px-4 py-2 text-center text-[13px] text-white/90">
              Pinch or scroll to zoom · drag to move · برای بزرگ‌نمایی دو انگشت را باز کنید
            </p>
          )}
        </>
      )}
    </div>
  );
}
