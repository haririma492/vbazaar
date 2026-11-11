// vbazaar.app/s/<store> — a published store's address that does not change
// when its video is re-uploaded: it opens the store's walk (/walk/<store>).
import { notFound, redirect } from "next/navigation";
import { readDirectory } from "@/lib/stores/directory";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: true } };

export default async function StoreAddress({ params }: { params: { slug: string } }) {
  const s = (await readDirectory()).stores.find((x) => x.slug === params.slug);
  if (!s) notFound();
  redirect(`/walk/${s.slug}`);
}
