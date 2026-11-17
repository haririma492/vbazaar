// vbazaar.app/<store>/vtour1.mp4 — a store's Free Tour at an address a person can read and say (owner, 2026-11-17:
// "make this link URL to be sensible https://vbazaar.app/vca/walk?v=scenes%2Fstore-nuttime%2Fwalk-20261116-053157.mp4
// e.g. https://vbazaar.app/nuttime/vtour1.mp4"). It opens the store's walk as it is today, so the link outlives a new
// video; `?p=`, `?shelf=`, `?section=`, `?product=` work as on the long address. `.mp4` may be left off. Every store with
// a walk has it (the long address opens any walk anyway). Not indexed. Any other two-part address here is a 404: the
// site's own pages (`/stores/…`, `/vca/…`, `/walk/…`) are matched before this one.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readStore } from "@/lib/stores/bucket";
import { TOUR_PATH_RE, storeWalkPath } from "@/lib/stores/productLink";

export const dynamic = "force-dynamic";

async function storeOf(params: { store: string; tour: string }) {
  const m = TOUR_PATH_RE.exec(`/${decodeURIComponent(params.store)}/${decodeURIComponent(params.tour)}`);
  if (!m) return null;
  const s = await readStore(m[1].toLowerCase()).catch(() => null);
  return s?.out.walk ? s : null;
}

export async function generateMetadata({ params }: { params: { store: string; tour: string } }): Promise<Metadata> {
  const s = await storeOf(params);
  const name = s ? s.name.en || s.name.fa : "";
  return { title: name ? `${name} · Virtual Bazaar` : "Virtual Bazaar", robots: { index: false, follow: true } };
}

// The store's page is now plain vbazaar.app/<store> (owner, 2026-11-17): this address is sent on to it.
export default async function StoreTour({ params, searchParams }: { params: { store: string; tour: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const s = await storeOf(params);
  if (!s) notFound();
  const q = new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  redirect(`${storeWalkPath(s.slug)}${q ? `?${q}` : ""}`);
}
