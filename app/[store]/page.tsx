// vbazaar.app/<store> — EACH STORE'S OWN PAGE (owner, 2026-11-17: "/vca/walk is not good, each store deserves its own
// straight direct page after our domain e.g. vbazaar.app/nuttime"). The store's Free Tour as it is today (the address
// outlives a new video); `?p=`, `?shelf=`, `?section=`, `?product=` and the operator's `?edit=1` work as on the long
// address. Every store with a walk has it. Not indexed. The site's own pages (`/stores`, `/walk`, `/demo` …) are matched
// before this one, and no store may take their names (`RESERVED_SLUGS`).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Walk360 from "@/components/virtual-bazaar/walk/Walk360";
import { readStore } from "@/lib/stores/bucket";
import { SLUG_RE } from "@/lib/stores/store";
import { RESERVED_SLUGS } from "@/lib/stores/productLink";

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

export default async function StorePage({ params }: { params: { store: string } }) {
  const s = await storeOf(params.store);
  if (!s) notFound();
  return <Walk360 walkKey={s.out.walk!} />;
}
