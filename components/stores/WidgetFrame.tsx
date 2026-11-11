"use client";

/**
 * The widget as the store's website shows it (`/w/<slug>`, framed by `/widget.js`): a short silent preview, the
 * store's name, the Virtual Bazaar's mark, and one key that opens the visit on vbazaar.app in a new tab. Nothing
 * here plays the store itself: the walk, the tours and the basket stay on vbazaar.app.
 */

import { useEffect, useRef, useState } from "react";
import { PREVIEW_SECONDS, type WidgetPlan } from "@/lib/stores/widgetRules";

export default function WidgetFrame({ slug, plan }: { slug: string; plan: WidgetPlan & { name: { en: string; fa: string } } }) {
  const [lang, setLang] = useState<"fa" | "en">("fa");
  const [from, setFrom] = useState("");
  const [i, setI] = useState(0);
  const [muted, setMuted] = useState(true);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("lang") === "en") setLang("en");
    const site = q.get("from") || document.referrer || "";
    setFrom(site);
    // Counted once a load; the operator's own preview on the store's page says so and is not counted.
    if (q.get("preview") !== "1") void fetch(`/api/w/${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site }), keepalive: true }).catch(() => undefined);
  }, [slug]);

  useEffect(() => {
    if (plan.preview.kind !== "photos" || plan.preview.srcs.length < 2) return;
    const n = plan.preview.srcs.length;
    const id = setInterval(() => setI((x) => (x + 1) % n), 2600);
    return () => clearInterval(id);
  }, [plan.preview]);

  const name = lang === "fa" ? plan.name.fa || plan.name.en : plan.name.en || plan.name.fa;
  const href = `/w/${slug}/go${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  const p = plan.preview;

  return (
    <div dir={lang === "fa" ? "rtl" : "ltr"} className="relative h-screen w-screen overflow-hidden bg-[#0f2a1f] text-white">
      <a href={href} target="_blank" rel="noopener" aria-label={lang === "fa" ? plan.say.fa : plan.say.en} className="absolute inset-0 z-10" />
      {p.kind === "video" && (
        <video key={p.src} ref={video} src={p.src} muted={muted} autoPlay playsInline loop preload="metadata" className="absolute inset-0 h-full w-full object-cover"
          onTimeUpdate={(e) => { if (e.currentTarget.currentTime > PREVIEW_SECONDS) e.currentTarget.currentTime = 0; }} />
      )}
      {p.kind === "photos" && p.srcs.map((src, k) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className="absolute inset-0 h-full w-full bg-white object-contain p-6 transition-opacity duration-700"
          style={{ opacity: k === i ? 1 : 0 }} loading={k < 2 ? "eager" : "lazy"} />
      ))}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/40" />
      {/* The bazaar's sign, small: the arch alone on its warm-white tile (owner, 2026-11-11: "replace the big logo on
          the widget with small (just arch)"). The same arch as `components/brand/TourBazaarLink.tsx`. */}
      <span className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-[#FFF9EE] px-[3px] py-px shadow">
        <svg width="32" height="22" viewBox="0 0 44 30" role="img" aria-label="Virtual Bazaar" className="block">
          <path fill="#214E3F" fillRule="evenodd" d="M8 2 H36 V28 H8 Z M13.5 28 V15 Q13.5 9.4 22 5.6 Q30.5 9.4 30.5 15 V28 Z" />
          <path d="M4 28 H40" stroke="#214E3F" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      {p.kind === "video" && p.sound && (
        // Browsers start a frame's video silent; the music plays once the visitor taps here.
        <button type="button" onClick={() => { setMuted(!muted); if (video.current) { video.current.muted = !muted; void video.current.play().catch(() => undefined); } }}
          aria-label={muted ? "Sound on" : "Sound off"} className="absolute right-2 top-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-[18px]">
          {muted ? "🔇" : "🔊"}
        </button>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4">
        <p className="sk-font text-[13px] text-white/80">{lang === "fa" ? "در بازار مجازی" : "In the Virtual Bazaar"}</p>
        <p className="sk-font text-[20px] font-bold leading-tight">{name}</p>
        <span className="mt-2 inline-flex min-h-[40px] items-center rounded-full bg-amber-300 px-5 text-[15px] font-bold text-black">
          {lang === "fa" ? plan.say.fa : plan.say.en} {lang === "fa" ? "←" : "→"}
        </span>
      </div>
    </div>
  );
}
