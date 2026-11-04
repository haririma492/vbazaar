// GET /api/tour/<slug> — a store's Shelf tour for shoppers (`lib/stores/tourJob.ts`): its video, its
// shelves and every product's place on screen. Public, like the walk; nothing private in it.
import { NextResponse } from "next/server";
import { readTour } from "@/lib/stores/tourJob";
import { readWalks } from "@/lib/splats/r2";

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
  return NextResponse.json({ ok: true, tour, title: walk?.title ?? null }, { headers: NO_STORE });
}
