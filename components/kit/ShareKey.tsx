"use client";

/**
 * «SHARE» ON A SHELF, A SECTION OR A PRODUCT (owner, 2026-11-15: "while no download should be allowed, share key should
 * be almost everywhere … receivers should end up exactly on the same spot on walking tour and the same photo should be
 * made open"). The phone's own share sheet (WhatsApp, Instagram, Messages…), else the link is copied. The link opens
 * the Free Tour there (`kitShareLink`, `readKitShare` in `lib/stores/kitRules.ts`). The photo itself is never shared.
 */
import { useState } from "react";
import { kitShareLink, type KitShare } from "@/lib/stores/kitRules";
import { track } from "@/lib/visitors/track";

export default function ShareKey({ base, to, title, lang = "en", className = "" }: {
  base: string | null | undefined; to: KitShare; title: string; lang?: "fa" | "en"; className?: string;
}) {
  const [said, setSaid] = useState("");
  if (!base) return null;
  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = new URL(kitShareLink(base, to), window.location.origin).toString();
    track(to.product ? "share-product" : to.section !== undefined ? "share-section" : "share-shelf");
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
    try { await navigator.clipboard.writeText(url); setSaid(lang === "fa" ? "پیوند کپی شد" : "Link copied"); }
    catch { window.prompt(lang === "fa" ? "این پیوند را کپی کنید" : "Copy this link", url); }
    setTimeout(() => setSaid(""), 2500);
  };
  return (
    <button type="button" onClick={share} onPointerDown={(e) => e.stopPropagation()} aria-label={lang === "fa" ? "اشتراک‌گذاری" : "Share"}
      className={`inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-[12px] text-neutral-800 ${className}`}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" /></svg>
      {said || (lang === "fa" ? "اشتراک" : "Share")}
    </button>
  );
}
