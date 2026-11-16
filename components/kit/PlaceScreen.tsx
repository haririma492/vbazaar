"use client";

import { useState } from "react";
import { KEY, QUIET } from "@/components/stores/ui";
import type { KitSection } from "@/lib/stores/kitRules";

/** Four taps on the shelf's photo: a section's place, drawn by hand when the finder could not see it. */
export default function PlaceScreen({ shelf, section, onSave, onClose }: { shelf: string; section: KitSection; onSave: (q: number[]) => void; onClose: () => void }) {
  const [taps, setTaps] = useState<Array<[number, number]>>([]);
  return (
    <div dir="ltr" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-left text-white">
      <p className="text-[15px] font-bold">Where is section {section.i}? · جای بخش {section.i}</p>
      <p className="text-[13px] text-white/70">Tap its 4 corners on the shelf&apos;s photo: top-left, top-right, bottom-right, bottom-left. ({taps.length} of 4)</p>
      <div className="flex max-h-[70vh] max-w-full items-start gap-3">
        <div className="relative max-h-[70vh] select-none" onClick={(e) => {
          if (taps.length >= 4) return;
          const r = e.currentTarget.getBoundingClientRect();
          setTaps((t) => [...t, [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]]);
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shelf} alt="" draggable={false} className="block max-h-[70vh] max-w-[70vw]" />
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
            {taps.length > 1 && <polyline points={taps.map((p) => p.join(",")).join(" ") + (taps.length === 4 ? ` ${taps[0].join(",")}` : "")} fill="none" stroke="#6ee7b7" strokeWidth={0.004} />}
            {taps.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={0.008} fill="#6ee7b7" />)}
          </svg>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {section.photo.thumb && <img src={section.photo.thumb} alt="" className="w-40 rounded border border-white/20" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={QUIET} onClick={() => (taps.length ? setTaps((t) => t.slice(0, -1)) : onClose())}>← Back</button>
        <button type="button" className={KEY} disabled={taps.length !== 4} onClick={() => onSave(taps.flat())}>✓ Save its place · ذخیره</button>
      </div>
    </div>
  );
}

