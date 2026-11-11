// GET /api/tour/<slug> — a store's Shelf tour for shoppers (`lib/stores/tourJob.ts`): its video, its
// shelves and every product's place on screen. Public, like the walk; nothing private in it.
import { NextResponse } from "next/server";
import { readTour } from "@/lib/stores/tourJob";
import { readWalks } from "@/lib/splats/r2";
import { readStore } from "@/lib/stores/bucket";
import { toMediaUrl } from "@/lib/splats/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const NO_STORE = { "cache-control": "no-store" };
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return NextResponse.json({ ok: false, error: "No such store." }, { status: 404, headers: NO_STORE });
  const r = await readTour(params.slug);
  if (!r) return NextResponse.json({ ok: false, error: "This store has no Shelf tour yet." }, { status: 404, headers: NO_STORE });
  const { plan: _plan, ...tour } = r;
  void _plan;
  const walk = (await readWalks().catch(() => null))?.walks[r.walk] ?? null;
  // A tour made before the videos went private names the public address: played through /api/media now.
  return NextResponse.json({ ok: true, tour: { ...tour, video: toMediaUrl(tour.video) }, title: walk?.title ?? null, live: Boolean((await readStore(params.slug).catch(() => null))?.live) }, { headers: NO_STORE });
}
