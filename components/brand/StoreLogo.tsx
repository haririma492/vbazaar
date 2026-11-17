"use client";

/**
 * THE STORE'S OWN LOGO, AT THE TOP LEFT OF ITS TOURS (owner, 2026-11-06: "on the new store registration canvas
 * lets add store logo also and accept a paste from clipboard and place that on the top left of the virtual tour").
 * 15% smaller than it was (owner, 2026-11-16: "make the store logo 15% smaller"). The bazaar's logo is on the right (`BrandBadge`). On a light backing, since most logos are drawn on white.
 *
 * With the store's website (`site`), a tap asks first, in a small card (owner, 2026-11-17: "make the store logo active
 * when user click on it a small modal asks do you want to leave virtual <name> store and visit the web site?"):
 * «Visit the website» goes there, «Stay» closes the card.
 */
import { useState } from "react";

export default function StoreLogo({ src, className = "", site, name, small = false }: { src: string; className?: string; site?: string | null; name?: { en: string; fa?: string } | null; /** A sideways phone's short header (2026-11-17). */ small?: boolean }) {
  const [ask, setAsk] = useState(false);
  const img = <img src={src} alt="" className={small ? "block h-9 w-auto max-w-[6rem] object-contain" : "block h-12 w-auto max-w-[7.65rem] object-contain sm:h-[3.4rem]"} />;
  if (!site) return <div className={`pointer-events-none rounded-xl bg-white/90 p-1 shadow-lg ${className}`}>{img}</div>;
  const en = name?.en || "this", fa = name?.fa || name?.en || "";
  return (
    <>
      <button type="button" data-track="store-logo" aria-label={`${en} website`} onClick={(e) => { e.stopPropagation(); setAsk(true); }}
        className={`cursor-pointer rounded-xl bg-white/90 p-1 shadow-lg transition-transform duration-200 hover:-translate-y-0.5 hover:scale-[1.04] ${className}`}>
        {img}
      </button>
      {ask && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4" onClick={(e) => { e.stopPropagation(); setAsk(false); }}
          onPointerDown={(e) => e.stopPropagation()}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 text-center text-neutral-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <img src={src} alt="" className="mx-auto h-14 w-auto max-w-[10rem] object-contain" />
            <p dir="rtl" className="text-[16px] font-bold leading-snug">آیا می‌خواهید فروشگاه مجازی {fa} را ترک کنید و به وبسایت آن بروید؟</p>
            <p className="text-[14px] leading-snug text-neutral-600">Do you want to leave the virtual {en} store and visit its website?</p>
            <div className="flex justify-center gap-2 pt-1">
              <button type="button" onClick={() => setAsk(false)} className="rounded-full border border-neutral-300 px-4 py-2 text-[14px] font-semibold">Stay · بمانم</button>
              <a href={site} rel="noopener" className="rounded-full bg-emerald-600 px-4 py-2 text-[14px] font-bold text-white">Visit the website · بله</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
