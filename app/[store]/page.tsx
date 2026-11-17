// vbazaar.app/<store> — EACH STORE'S OWN PAGE (owner, 2026-11-17: "/vca/walk is not good, each store deserves its own
// straight direct page after our domain e.g. vbazaar.app/nuttime"). The store's Free Tour as it is today (the address
// outlives a new video); `?p=`, `?shelf=`, `?section=`, `?product=` and the operator's `?edit=1` work as on the long
// address. Every store with a walk has it. Not indexed. The site's own pages (`/stores`, `/walk`, `/demo` …) are matched
// before this one, and no store may take their names (`RESERVED_SLUGS`).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import Walk360 from "@/components/virtual-bazaar/walk/Walk360";
import TourView from "@/components/virtual-bazaar/tour/TourPage";
import { readStore } from "@/lib/stores/bucket";
import { SLUG_RE } from "@/lib/stores/store";
import { RESERVED_SLUGS, storeWalkPath } from "@/lib/stores/productLink";

export const dynamic = "force-dynamic";

async function storeOf(raw: string) {
  const slug = decodeURIComponent(raw).toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return null;
  const s = await readStore(slug).catch(() => null);
  return s?.out.walk ? s : null;
}

export async function generateMetadata({ params }: { params: { store: string } }): Promise<Metadata> {
  const s = await storeOf(params.store);
  const name = s ? s.name.en || s.name.fa : "";
  return { title: name ? `${name} · Virtual Bazaar` : "Virtual Bazaar", robots: { index: false, follow: true } };
}

export default async function StorePage({ params, searchParams }: { params: { store: string }; searchParams: Record<string, string | string[] | undefined> }) {
  // «vbazaar.app/nuttime&edit=1» (owner, 2026-11-17: the long links used «&edit=1», so the habit stays): what comes
  // after the first «&» is the query, and the page is sent on to «/nuttime?edit=1».
  const raw = decodeURIComponent(params.store);
  const amp = raw.indexOf("&");
  if (amp > 0) {
    const s0 = await storeOf(raw.slice(0, amp));
    if (s0) redirect(`${storeWalkPath(s0.slug)}?${raw.slice(amp + 1)}`);
  }
  const s = await storeOf(params.store);
  if (!s) notFound();
  // «?shelf» with nothing after it is the store's Shelf Tour (owner, 2026-11-17: vbazaar.app/nuttime?shelf); «?shelf=<id>»
  // is a share link into the Free Tour, as before.
  if (searchParams.shelf === "") return <Suspense fallback={null}><TourView store={s.slug} /></Suspense>;
  return <Walk360 walkKey={s.out.walk!} />;
}
