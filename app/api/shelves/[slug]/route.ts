// GET /api/shelves/<slug> — a store's Shelf Tour by shelf and level (`lib/stores/levelsJob.ts`): a still of
// each shelf and of each of its levels, with every product's place on each. Public, like the walk.
import { NextResponse } from "next/server";
import { readShelves } from "@/lib/stores/levelsJob";
import { readStore } from "@/lib/stores/bucket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const NO_STORE = { "cache-control": "no-store" };
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return NextResponse.json({ ok: false, error: "No such store." }, { status: 404, headers: NO_STORE });
  const m = await readShelves(params.slug);
  if (!m) return NextResponse.json({ ok: false, error: "This store's shelves are not ready yet." }, { status: 404, headers: NO_STORE });
  const s = await readStore(params.slug).catch(() => null);
  return NextResponse.json({ ok: true, shelves: m, name: s ? { en: s.name.en, fa: s.name.fa } : null, walk: s?.out.walk ?? null }, { headers: NO_STORE });
}
