// GET /api/zoom/<slug> — a store's shelf zoom photos that are ready (`lib/stores/gigapan.ts`): each one's tile
// manifest, mini-map picture and size. Public, like the walk (the tiles are public pictures); the walk's editor
// lists them under «Zoom» to pin each on its shelf.
import { NextResponse } from "next/server";
import { readZooms } from "@/lib/stores/gigapan";
import { namedShelves } from "@/lib/stores/gigapanRules";
import { readStore } from "@/lib/stores/bucket";
import { readWalks } from "@/lib/splats/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const NO_STORE = { "cache-control": "no-store" };
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return NextResponse.json({ ok: false, error: "No such store." }, { status: 404, headers: NO_STORE });
  const r = await readZooms(params.slug);
  // A shelf the operator numbered or named on the walk since it was stitched is called that.
  const walk = r?.sets.length ? (await readStore(params.slug).catch(() => null))?.out.walk : undefined;
  const named = namedShelves(walk ? (await readWalks().catch(() => null))?.walks[walk]?.zooms : undefined);
  const nameOf = (id: string, l: { en: string; fa: string }) => { const n = named.get(id); return n ? { en: n.en, fa: n.fa ?? n.en } : l; };
  const zooms = (r?.sets ?? []).filter((x) => x.state === "done" && x.manifest).map((x) => ({ id: x.id, label: nameOf(x.id, x.label), manifest: x.manifest!, thumb: x.thumb ?? null, w: x.w ?? 0, h: x.h ?? 0, mp: x.mp ?? 0 }));
  return NextResponse.json({ ok: true, zooms }, { headers: NO_STORE });
}
