/**
 * PUT /api/operator/splats/sign-image?key=… — a replaced sign's image,
 * relayed to R2 by this server. x-admin-token. The body is the image; the
 * answer is `{ key }`.
 *
 * The fallback for the viewer's «Replace a sign» when the browser may not PUT
 * to R2 itself (the bucket's CORS, a proxy) — like `../part` for scene files.
 * ⚠️ STRICT: the key must be one `signImageKey` makes, and the bytes must BE
 * that kind of image (their first bytes), whatever the browser says.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";
import { MAX_SIGN_IMAGE_BYTES, imageTypeOf, isSignImageKey } from "@/lib/splats/keys";
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
  const type = isSignImageKey(key);
  if (!type) return fail(400, "Not a sign image key.");
  if (Number(req.headers.get("content-length") || 0) > MAX_SIGN_IMAGE_BYTES) return fail(413, "Image too large.");
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > MAX_SIGN_IMAGE_BYTES) return fail(400, "Empty or oversized image.");
    if (imageTypeOf(body) !== type) return fail(400, "The file is not the PNG, JPEG or WebP image its name says.");
    await putSignImage(key, type, body);
    return NextResponse.json({ ok: true, key }, { headers: NO_STORE });
  } catch (e) {
    console.error("[operator/splats/sign-image]", e);
    // 500, not 502: a 502 is swapped for a bare page by the proxy in front.
    return fail(500, `R2 refused the image: ${(e as Error).message}`);
  }
}
