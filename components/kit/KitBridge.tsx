"use client";

/**
 * FROM THE TRAY TO THE SHOP (owner, 2026-11-15: "c) a small thin arrow connects that photo - type IV - to its exact
 * location on the already stopped moving shelf on the top section d) the type IV photo gets enlarged with a nice
 * funnel from the photo connected in the original photo in the tray showing that it is this particular photo that is
 * getting enlarged - the enlarged photo move to the bottom of the top section - the enlarge rate will be 3 times").
 * Over the page: the thin arrow from the tray's photo to the section on the shelf (and the section's outline there),
 * the funnel from the tray's photo up to the enlarged one, and the enlarged photo itself: the ORIGINAL upload, whole,
 * no zooming (owner: "there is no wheel in e-commerce"). Everything here is in the page's (viewport) pixels.
 */
import { noSave } from "./noSave";
import Watermark from "./Watermark";
import { useEffect, useState } from "react";

export type Box = { left: number; top: number; width: number; height: number };
const GROW_MS = 450;
const ease = (k: number) => 1 - Math.pow(1 - k, 3);

/** The enlarged photo's place: 3× the tray's photo, its bottom on the top section's bottom, at the left, kept out of
 *  the panel (`right`: where the panel starts) and inside the top section; never bigger than 3×. */
export function bigBox(from: Box, area: Box, right: number, aspect: number): Box {
  const m = 10;
  const maxW = Math.max(60, right - area.left - 2 * m), maxH = Math.max(60, area.height - 2 * m);
  let w = from.width * 3, h = w / aspect;
  if (h > from.height * 3) { h = from.height * 3; w = h * aspect; }
  if (w > maxW) { w = maxW; h = w / aspect; }
  if (h > maxH) { h = maxH; w = h * aspect; }
  return { left: area.left + m, top: area.top + area.height - m - h, width: w, height: h };
}

export default function KitBridge({ from, area, right, url, aspect, target, onClose }: {
  /** The tapped photo in the tray. */
  from: Box;
  /** The walk's (top) section of the screen. */
  area: Box;
  /** Where the shopping panel starts (x). */
  right: number;
  url: string;
  aspect: number;
  /** The section on the stopped shelf (4 corners), or one point when only the shelf is known; null: no arrow. */
  target: Array<[number, number]> | null;
  onClose: () => void;
}) {
  const [k, setK] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let id = 0;
    const step = (now: number) => {
      const v = Math.min(1, (now - t0) / GROW_MS);
      setK(v);
      if (v < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [url]);
  const big = bigBox(from, area, right, aspect);
  const e = ease(k);
  const cur: Box = {
    left: from.left + (big.left - from.left) * e, top: from.top + (big.top - from.top) * e,
    width: from.width + (big.width - from.width) * e, height: from.height + (big.height - from.height) * e,
  };
  // The funnel: from the tray photo's top edge up to the enlarged photo's bottom edge.
  const funnel = [
    [from.left, from.top], [from.left + from.width, from.top],
    [cur.left + cur.width, cur.top + cur.height], [cur.left, cur.top + cur.height],
  ].map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
  // No arrow (owner, 2026-11-16: "remove the white thin arrow, we do not need it"): the section's thin outline on the
  // shelf and the funnel say where the photo is.
  return (
    <div className="fixed inset-0 z-[45]" onClick={onClose} onPointerDown={(ev) => ev.stopPropagation()}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity: Math.min(1, k * 1.6) }}>
        <defs>
          <linearGradient id="kit-funnel" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ffe9b0" stopOpacity="0.38" />
            <stop offset="1" stopColor="#ffe9b0" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <polygon points={funnel} fill="url(#kit-funnel)" stroke="rgba(255,233,176,0.55)" strokeWidth="1" />
        {target && target.length === 4 && (
          <polygon points={target.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")} fill="rgba(255,255,255,0.06)" stroke="white" strokeWidth="1.5" strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.9))" }} />
        )}
      </svg>
      <div className="absolute overflow-hidden rounded-xl bg-black shadow-2xl ring-2 ring-amber-200/80"
        style={{ left: cur.left, top: cur.top, width: cur.width, height: cur.height }}
        onClick={(ev) => ev.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img {...noSave} src={url} alt="" className="h-full w-full select-none object-contain" />
        <Watermark size="lg" address={false} />
      </div>
    </div>
  );
}
