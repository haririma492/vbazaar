/**
 * PUT /api/operator/splats/walk-audio?key=… — a walk's background sound,
 * relayed to R2 by this server. x-admin-token. The body is the sound; the
 * answer is `{ key }`.
 *
 * The fallback for the walk's «Sound» when the browser may not PUT to R2
 * itself — like `../sign-image`. ⚠️ STRICT: the key must be one
 * `walkAudioKey` makes, and the bytes must BE that kind of sound.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";
import { MAX_WALK_AUDIO_BYTES, audioTypeOf, isWalkAudioKey } from "@/lib/splats/keys";
import { putSignImage, r2Config } from "@/lib/splats/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

export async function PUT(req: NextRequest) {
  if (!isAdminTokenValid(req.headers.get("x-admin-token") || "")) return fail(401, "Unauthorized");
  if (!r2Config().configured) return fail(503, "R2 is not configured on this host.");
  const key = req.nextUrl.searchParams.get("key") || "";
  const type = isWalkAudioKey(key);
  if (!type) return fail(400, "Not a walk sound key.");
  if (Number(req.headers.get("content-length") || 0) > MAX_WALK_AUDIO_BYTES) return fail(413, "Sound too large.");
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > MAX_WALK_AUDIO_BYTES) return fail(400, "Empty or oversized sound.");
    if (audioTypeOf(body) !== type) return fail(400, "The file is not the .mp3 or .m4a sound its name says.");
    await putSignImage(key, type, body);
    return NextResponse.json({ ok: true, key }, { headers: NO_STORE });
  } catch (e) {
    console.error("[operator/splats/walk-audio]", e);
    // 500, not 502: a 502 is swapped for a bare page by the proxy in front.
    return fail(500, `R2 refused the sound: ${(e as Error).message}`);
  }
}
