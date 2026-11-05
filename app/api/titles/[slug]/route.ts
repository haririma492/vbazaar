// GET /api/titles/<slug> — the titles the title reader read off a store's video (`lib/stores/titles.ts`), for
// the book's card (owner, 2026-11-05: "When we click on a book let that farsi text title be in the modal window
// in addition to cvs"). Public, like the walk: only what is printed on the books (title, author, how sure),
// never a photo, a price or anything private. Unreadable ones are left out.
import { NextResponse } from "next/server";
import { readTitleList } from "@/lib/stores/titles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const NO_STORE = { "cache-control": "no-store" };
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return NextResponse.json({ ok: false, error: "No such store." }, { status: 404, headers: NO_STORE });
  const list = await readTitleList(params.slug);
  const titles: Record<number, { fa: string; en: string; author: string; readable: "full" | "partial" }> = {};
  for (const r of list?.rows ?? []) if (r.readable !== "no" && (r.title_fa.trim() || r.title_en.trim())) titles[r.n] = { fa: r.title_fa, en: r.title_en, author: r.author, readable: r.readable };
  return NextResponse.json({ ok: true, titles }, { headers: NO_STORE });
}
