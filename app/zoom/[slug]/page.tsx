// /zoom/<slug> — a store's shelf zoom photos by themselves (owner, 2026-11-12: "provide the link where I can see
// them directly"). One address to open or send: the shelves that are stitched, each opening full screen in the
// zoom viewer; `?shelf=<n>` (1, 2, …) opens that one at once, and a store with a single shelf opens it at once.
// Public like the tiles themselves; not indexed (the layout's default).
import ZoomPage from "@/components/zoom/ZoomPage";

export const dynamic = "force-dynamic";

export default function Page({ params, searchParams }: { params: { slug: string }; searchParams: { shelf?: string } }) {
  const n = Number(searchParams.shelf);
  return <ZoomPage slug={params.slug} shelf={Number.isInteger(n) && n > 0 ? n : null} />;
}
