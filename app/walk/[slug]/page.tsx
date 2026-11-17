// vbazaar.app/walk/<store> — a store's walk at an address a person can read and say (owner, 2026-11-10:
// "change these URLs to one that is sensible … e.g. vbazaar.app/walk/saraye-bamdad.mp4"). It opens the store's walk
// as it is today, so the link outlives a new video; `?p=<n>` opens it at a product. `/walk/<store>.mp4` is taken
// too and sent on to the plain address. Only a store that is published, or that the operator switched onto the tours page (`onTours`): any other slug opens nothing.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { storeWalkPath } from "@/lib/stores/productLink";
import { readStore } from "@/lib/stores/bucket";
import { readTourStores } from "@/lib/stores/directory";

export const dynamic = "force-dynamic";

const slugOf = (raw: string) => decodeURIComponent(raw).toLowerCase().replace(/\.mp4$/, "");

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = (await readTourStores()).find((x) => x.slug === slugOf(params.slug));
  const name = s ? s.name.en || s.name.fa : "";
  return { title: name ? `${name} · Virtual Bazaar` : "Virtual Bazaar", robots: { index: false, follow: true } };
}

export default async function StoreWalk({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const slug = slugOf(params.slug);
  if (slug !== params.slug) {
    const q = new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
    redirect(`/walk/${slug}${q ? `?${q}` : ""}`);
  }
  // Any store with a walk (the new address has no list behind it).
  const s = await readStore(slug).catch(() => null);
  if (!s?.out.walk) notFound();
  // The store's address is now /<store>/vtour1.mp4 (owner, 2026-11-17): links already shared are sent on to it.
  const q = new URLSearchParams(Object.entries(searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  redirect(`${storeWalkPath(slug)}${q ? `?${q}` : ""}`);
}
