"use client";

/** A store's shelf kit for shoppers (`/api/kit/<slug>`, `lib/stores/kitRules.ts` `ShopKit`): null while it loads or
 *  when the store has none yet (then its tours stay as they were). */
import { useEffect, useState } from "react";
import { kitReady, type ShopKit } from "@/lib/stores/kitRules";

export function useKit(slug: string | null | undefined): ShopKit | null {
  const [kit, setKit] = useState<ShopKit | null>(null);
  useEffect(() => {
    setKit(null);
    if (!slug) return;
    let gone = false;
    void fetch(`/api/kit/${slug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!gone && j?.ok && kitReady(j.kit)) setKit(j.kit as ShopKit); })
      .catch(() => {});
    return () => { gone = true; };
  }, [slug]);
  return kit;
}
