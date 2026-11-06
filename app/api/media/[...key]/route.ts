/**
 * GET /api/media/scenes/<scene>/<file>.mp4 — a walk video for ANY visitor
 * (owner, 2026-11-06: "everyone should be able to watch"), without a permanent
 * address (`lib/splats/media.ts`). Answers with a redirect to a signed link
 * that expires, so a link copied out of the page stops working within hours.
 *
 * HEAD answers here, without a redirect: the player asks whether a video
 * (its `-phone.mp4`, its `-reverse.mp4`) exists, and a link signed for GET
 * refuses a HEAD.
 */
import { NextRequest, NextResponse } from "next/server";
import { presignGet, r2Config, readBucket, webObjectExists } from "@/lib/splats/r2";
import { isServableVideoKey } from "@/lib/splats/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long a visitor's link works: a long walk, not a permanent address. */
const LINK_SECONDS = 6 * 60 * 60;
/** The same link is handed out for an hour, so the browser's cache of the video still works. */
const REUSE_MS = 60 * 60 * 1000;
const signed = new Map<string, { url: string; until: number }>();

const NO_STORE = { "cache-control": "no-store" };
const keyOf = (params: { key?: string[] }) => (params.key ?? []).join("/");

function refuse(key: string): NextResponse | null {
  if (!isServableVideoKey(key)) return NextResponse.json({ ok: false, error: "Not a walk video." }, { status: 404, headers: NO_STORE });
  if (!r2Config().configured) return NextResponse.json({ ok: false, error: "R2 is not configured on this host." }, { status: 503, headers: NO_STORE });
  return null;
}

/**
 * ⚠️ KEYED ON THE BUCKET TOO: a video moved into the private bucket must stop
 * being handed out as its old public link, which stops working the moment the
 * public copy is deleted.
 */
async function linkFor(key: string): Promise<string> {
  const id = `${await readBucket("web", key)}|${key}`;
  const had = signed.get(id);
  if (had && had.until > Date.now()) return had.url;
  const url = await presignGet(key, "web", LINK_SECONDS);
  signed.set(id, { url, until: Date.now() + REUSE_MS });
  if (signed.size > 5000) for (const [k, v] of signed) if (v.until <= Date.now()) signed.delete(k);
  return url;
}

export async function GET(req: NextRequest, { params }: { params: { key?: string[] } }) {
  const key = keyOf(params);
  const no = refuse(key);
  if (no) return no;
  try {
    if (!(await webObjectExists(key))) return NextResponse.json({ ok: false, error: "No such video." }, { status: 404, headers: NO_STORE });
    // `private`: a shared cache must never hand one visitor's link to another for longer than it lasts.
    return NextResponse.redirect(new URL(await linkFor(key), req.url), { status: 302, headers: { "cache-control": "private, max-age=600" } });
  } catch (e) {
    console.error("[media]", key, e);
    return NextResponse.json({ ok: false, error: `R2 refused: ${(e as Error).message}` }, { status: 500, headers: NO_STORE });
  }
}

export async function HEAD(_req: NextRequest, { params }: { params: { key?: string[] } }) {
  const key = keyOf(params);
  if (refuse(key)) return new NextResponse(null, { status: 404, headers: NO_STORE });
  try {
    return new NextResponse(null, { status: (await webObjectExists(key)) ? 200 : 404, headers: { "cache-control": "private, max-age=600" } });
  } catch {
    return new NextResponse(null, { status: 500, headers: NO_STORE });
  }
}
