"use client";

import { useState } from "react";

/**
 * The pitch screen: three big keys, nothing else. The intro plays right here;
 * the walk and the 3D store open full screen («← Demo» is the browser's back).
 */
const KEYS = [
  {
    id: "intro",
    icon: "▶",
    fa: "معرفی سرکوچه",
    en: "Sarekooche — the idea",
    note: "The short intro video",
  },
  {
    id: "walk",
    icon: "🚶",
    fa: "قدم زدن در بازار",
    en: "Walk the bazaar",
    note: "The real street in 360°: walk, look around, step into a shop",
    href: "/vca/walk",
  },
  {
    id: "shop",
    icon: "🛒",
    fa: "خرید از داخل فروشگاه",
    en: "Shop inside a store",
    note: "Walk the aisle, tap a product, add it to the basket",
    href: "/vca/walk?v=scenes%2Fchinastoreyoutube%2FBillstra-119-Hamburg-20539-Qm7OVO4braI-.mp4",
  },
  {
    id: "store",
    icon: "🏬",
    fa: "داخل فروشگاه — ورلد آن یانگ",
    en: "Inside World on Yonge (3D)",
    note: "The first alley, scanned in 3D — move through it",
    href: "/vca/splat?src=%2Fapi%2Fdemo%2Fworld-on-yonge.ply&big=1",
  },
] as const;

export default function DemoScreen() {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <main className="min-h-dvh bg-[#0b0f12] px-4 py-8 text-white">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <header className="mb-2 text-center">
          <div className="sk-font text-[34px] font-extrabold text-[#00B8C8]">سرکوچه</div>
          <div className="text-[15px] text-white/70">Sarekooche · the Virtual Bazaar</div>
        </header>
        {KEYS.map((k) => {
          const inner = (
            <>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#00B8C8]/20 text-[28px]">{k.icon}</span>
              <span className="min-w-0 flex-1 text-left">
                <span className="sk-font block text-[20px] font-bold leading-tight" dir="rtl">{k.fa}</span>
                <span className="block text-[17px] font-semibold text-white/90">{k.en}</span>
                <span className="mt-0.5 block text-[13px] text-white/55">{k.note}</span>
              </span>
              <span className="text-[26px] text-white/40">›</span>
            </>
          );
          const cls = "flex w-full items-center gap-4 rounded-3xl border border-white/15 bg-white/[0.06] p-4 text-white no-underline shadow-lg transition active:scale-[0.99] hover:border-[#00B8C8]/60 hover:bg-white/[0.1]";
          return "href" in k ? (
            <a key={k.id} href={k.href} className={cls}>{inner}</a>
          ) : (
            <button key={k.id} className={cls} onClick={() => { setFailed(false); setPlaying(true); }}>{inner}</button>
          );
        })}
        <p className="mt-2 text-center text-[12px] text-white/35">sarekooche.com</p>
      </div>

      {playing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <button onClick={() => setPlaying(false)} className="absolute right-3 top-3 z-10 rounded-full bg-white/15 px-4 py-2 text-[15px] font-semibold">
            ✕ Close
          </button>
          {failed ? (
            <div className="m-auto max-w-sm p-6 text-center text-[15px] text-rose-200">
              The intro video could not be found or played. Upload it with «vca-intro» in its name at /operator/splats.
            </div>
          ) : (
            <video src="/api/demo/intro" className="h-full w-full object-contain" controls autoPlay playsInline onError={() => setFailed(true)} />
          )}
        </div>
      )}
    </main>
  );
}
