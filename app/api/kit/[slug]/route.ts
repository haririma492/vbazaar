// GET /api/kit/<slug> — a store's shelf kit for shoppers (the pastry redesign, `lib/stores/kit.ts` `shopKit`): each
// shelf's quality photo, its sections' photos and where each sits in it, and each section's products with their
// names and prices as the store's list has them now. Public, like the walk; nothing private in it.
import { NextResponse } from "next/server";
import { readStore } from "@/lib/stores/bucket";
import { shopKit } from "@/lib/stores/kit";
import { offlineDir, offlineJson } from "@/lib/splats/offline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const headers = { "cache-control": "public, max-age=20" };
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return NextResponse.json({ ok: false, error: "No such store." }, { status: 404, headers });
  // The demo without internet: the kit the offline pack saved (its photos are in the folder too, `scripts/offline-pack.mjs`).
  const saved = offlineDir() ? offlineJson(`stores/${params.slug}/offline-kit.json`) : null;
  if (saved) return NextResponse.json(saved, { headers });
  const s = await readStore(params.slug).catch(() => null);
  if (!s) return NextResponse.json({ ok: false, error: "No such store." }, { status: 404, headers });
  const kit = await shopKit(s).catch(() => null);
  if (!kit) return NextResponse.json({ ok: false, error: "This store has no shelf photos yet." }, { status: 404, headers });
  return NextResponse.json({ ok: true, kit }, { headers });
}
