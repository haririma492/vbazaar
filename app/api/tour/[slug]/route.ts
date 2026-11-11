// GET /api/tour/<slug> — a store's Shelf tour for shoppers (`lib/stores/tourJob.ts`): its video, its
// shelves and every product's place on screen. Public, like the walk; nothing private in it.
import { NextResponse } from "next/server";
import { readTour } from "@/lib/stores/tourJob";
import { readWalks } from "@/lib/splats/r2";
import { readStore } from "@/lib/stores/bucket";
import { hasShortAddress } from "@/lib/stores/store";
import { toMediaUrl } from "@/lib/splats/media";
import { lensOf } from "@/lib/splats/walks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const NO_STORE = { "cache-control": "no-store" };
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return NextResponse.json({ ok: false, error: "No such store." }, { status: 404, headers: NO_STORE });
  const r = await readTour(params.slug);
  if (!r) return NextResponse.json({ ok: false, error: "This store has no Shelf tour yet." }, { status: 404, headers: NO_STORE });
  const { plan: _plan, ...tour } = r;
  void _plan;
  const walks = (await readWalks().catch(() => null))?.walks ?? {};
  const walk = walks[r.walk] ?? null;
  const store = await readStore(params.slug).catch(() => null);
  // ⚠️ A STORE NOW FILMED FLAT (2026-11-11, `lib/splats/lens.ts`): the Shelf Tour is not made from a flat video
  // yet, so a tour left from the store's earlier 360° video would show shelves the new video does not have.
  if (store?.out.walk && store.out.walk !== r.walk && lensOf(walks[store.out.walk])) {
    return NextResponse.json({ ok: false, error: "This store has no Shelf tour of its new (flat) video yet." }, { status: 404, headers: NO_STORE });
  }
  // A tour made before the videos went private names the public address: played through /api/media now.
  return NextResponse.json({ ok: true, tour: { ...tour, video: toMediaUrl(tour.video) }, title: walk?.title ?? null, live: Boolean(store && hasShortAddress(store)) }, { headers: NO_STORE });
}
