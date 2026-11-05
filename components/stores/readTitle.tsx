"use client";

/**
 * THE TITLE AS READ OFF THE SHELF, ON A BOOK'S CARD (owner, 2026-11-05: "When we click on a book let that farsi
 * text title be in the modal window in addition to cvs"). Fetched once per store (`/api/titles/<slug>`) and
 * kept for the visit. Shown beside the product's own name, labelled as read, never in its place: the owner
 * names products (2026-11-01).
 */

import { useEffect, useState } from "react";

export type ReadTitleSay = { fa: string; en: string; author: string; readable: "full" | "partial" };
const cache = new Map<string, Promise<Record<number, ReadTitleSay>>>();

function titlesOf(slug: string) {
  let p = cache.get(slug);
  if (!p) {
    p = fetch(`/api/titles/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => (j?.ok && j.titles) || {}).catch(() => ({}));
    cache.set(slug, p);
  }
  return p;
}

/** The store's slug from a walk key (`scenes/store-<slug>/…`) or a store API (`/api/stores/<slug>`). */
export function slugFrom(v: string): string {
  return /scenes\/store-([a-z0-9-]+)\//.exec(v)?.[1] ?? /\/api\/stores\/([a-z0-9-]+)/.exec(decodeURIComponent(v))?.[1] ?? "";
}

export function useReadTitle(slug: string, n: number | undefined): ReadTitleSay | null {
  const [t, setT] = useState<ReadTitleSay | null>(null);
  useEffect(() => {
    let live = true;
    setT(null);
    if (slug && n) void titlesOf(slug).then((all) => { if (live) setT(all[n] ?? null); });
    return () => { live = false; };
  }, [slug, n]);
  return t;
}

export function ReadTitleBox({ t }: { t: ReadTitleSay | null }) {
  if (!t) return null;
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
      <div className="text-[11px] text-white/50">عنوان خوانده‌شده از روی کتاب · Title as read from the book{t.readable === "partial" ? " (in part)" : ""}</div>
      {t.fa && <div dir="rtl" className="text-right text-[16px] font-bold leading-snug">{t.fa}</div>}
      {t.en && <div dir="ltr" className="text-[13px] text-white/75">{t.en}</div>}
      {t.author && <div dir="auto" className="text-[12px] text-white/60">{t.author}</div>}
    </div>
  );
}
