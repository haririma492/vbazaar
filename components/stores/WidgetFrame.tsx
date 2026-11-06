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
    <a href={href} target="_blank" rel="noopener" dir={lang === "fa" ? "rtl" : "ltr"}
      className="relative block h-screen w-screen overflow-hidden bg-[#0f2a1f] text-white" style={{ textDecoration: "none" }}>
      {p.kind === "video" && (
        <video ref={video} src={p.src} muted autoPlay playsInline loop preload="metadata" className="absolute inset-0 h-full w-full object-cover"
          onTimeUpdate={(e) => { if (e.currentTarget.currentTime > PREVIEW_SECONDS) e.currentTarget.currentTime = 0; }} />
      )}
      {p.kind === "photos" && p.srcs.map((src, k) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className="absolute inset-0 h-full w-full bg-white object-contain p-6 transition-opacity duration-700"
          style={{ opacity: k === i ? 1 : 0 }} loading={k < 2 ? "eager" : "lazy"} />
      ))}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/40" />
      <div dir="ltr" className="absolute left-2 top-2 flex flex-col items-center rounded-lg bg-black/55 p-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/media/brand/vbazaar-logo-v2-1000.webp" alt="Virtual Bazaar" width={52} className="rounded" style={{ height: "auto" }} />
        <span className="mt-0.5 text-[9px] font-bold tracking-wide text-[#e8f5ec]">VBAZAAR.APP</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="sk-font text-[13px] text-white/80">{lang === "fa" ? "در بازار مجازی" : "In the Virtual Bazaar"}</p>
        <p className="sk-font text-[20px] font-bold leading-tight">{name}</p>
        <span className="mt-2 inline-flex min-h-[40px] items-center rounded-full bg-amber-300 px-5 text-[15px] font-bold text-black">
          {lang === "fa" ? plan.say.fa : plan.say.en} {lang === "fa" ? "←" : "→"}
        </span>
      </div>
    </a>
  );
}
