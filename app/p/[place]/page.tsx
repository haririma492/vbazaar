// vbazaar.app/p/<place> — a place's address that does not change when its
// videos are re-uploaded: it opens the place's first area with a walk.
import { notFound, redirect } from "next/navigation";
import { readDirectory, walkHref } from "@/lib/stores/directory";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: true } };

export default async function PlacePage({ params }: { params: { place: string } }) {
  const p = (await readDirectory()).places.find((x) => x.id === params.place);
  if (!p) notFound();
  redirect(walkHref(p.walk));
}
