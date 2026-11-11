"use client";

/**
 * The walk's own numbers at its top left: PPD and FPS (`lib/splats/walkStats.ts`; owner, 2026-11-11). Read from
 * the video on screen: its width, and the times of the frames the browser shows. For the store's owner and the
 * operator (signed in), and for anyone who adds `?stats=1` to the walk's address; shoppers do not see it.
 */
import { useEffect, useState } from "react";
import { fpsOf, ppdOf } from "@/lib/splats/walkStats";
import type { FlatLens } from "@/lib/splats/lens";

type Rvfc = (cb: (now: number, meta: { mediaTime: number }) => void) => number;

export default function WalkStats({ video, projection, lens, className = "" }: {
  /** The video on screen now (it changes as the shopper goes through a door, or walks back). */
  video: () => HTMLVideoElement | null;
  projection: "equirect" | "eac" | "flat" | null;
  lens: FlatLens | null;
  className?: string;
}) {
  const [say, setSay] = useState<{ w: number; h: number; ppd: number | null; fps: number | null } | null>(null);
  useEffect(() => {
    let stop = false;
    let el: HTMLVideoElement | null = null, src = "", last = -1, steps: number[] = [];
    const fpsBySrc = new Map<string, number>();
    const on = (v: HTMLVideoElement) => (_: number, meta: { mediaTime: number }) => {
      if (stop || v !== el) return;
      const d = meta.mediaTime - last;
      last = meta.mediaTime;
      if (d > 0 && d < 0.5) { steps.push(d); if (steps.length > 120) steps = steps.slice(-60); }
      (v as unknown as { requestVideoFrameCallback: Rvfc }).requestVideoFrameCallback(on(v));
    };
    const tick = () => {
      const v = video();
      if (v && (v !== el || v.currentSrc !== src)) {
        el = v; src = v.currentSrc; last = -1; steps = [];
        if ("requestVideoFrameCallback" in v) (v as unknown as { requestVideoFrameCallback: Rvfc }).requestVideoFrameCallback(on(v));
      }
      if (!v || !v.videoWidth) return;
      // Once sure of a copy's frame rate it is kept: it is the file's, and does not change.
      const key = src.split("?")[0];
      const fps = fpsBySrc.get(key) ?? fpsOf(steps);
      if (fps) fpsBySrc.set(key, fps);
      setSay((p) => {
        const n = { w: v.videoWidth, h: v.videoHeight, ppd: ppdOf(v.videoWidth, projection, lens), fps: fps ?? null };
        return p && p.w === n.w && p.h === n.h && p.ppd === n.ppd && p.fps === n.fps ? p : n;
      });
    };
    const id = window.setInterval(tick, 500);
    tick();
    return () => { stop = true; window.clearInterval(id); };
  }, [video, projection, lens]);
  if (!say) return null;
  return (
    <div dir="ltr" className={`pointer-events-none rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] leading-tight text-white/90 ${className}`}>
      <div>PPD {say.ppd ?? "—"}{projection === "flat" && lens ? ` (${say.w} px ÷ ${Math.round(((lens.hfov * 180) / Math.PI) * 10) / 10}°)` : say.ppd ? ` (${say.w} px ÷ ${projection === "eac" ? 270 : 360}°)` : ""}</div>
      <div>FPS {say.fps ?? "…"} · {say.w}×{say.h}</div>
    </div>
  );
}
