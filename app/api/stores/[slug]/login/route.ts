/**
 * /api/stores/<slug>/login — the store owner signs in with the store's
 * password (no username), for this store only (`lib/stores/auth.ts`).
 *
 *   POST { password } → sets the store's cookie
 *   DELETE            → signs out
 */
import { NextRequest } from "next/server";
import { r2Config } from "@/lib/splats/r2";
import { SLUG_RE } from "@/lib/stores/store";
import { readStore } from "@/lib/stores/bucket";
import { checkPassword, cookieName, ownerCookie } from "@/lib/stores/auth";
import { fail, ok } from "@/lib/stores/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A wrong password waits a moment, so guessing is slow. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  if (!SLUG_RE.test(params.slug)) return fail(404, "No such store.");
  if (!r2Config().configured) return fail(503, "R2 is not configured on this host.");
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const s = await readStore(params.slug);
  if (!s || typeof password !== "string" || !checkPassword(password.trim(), s.passwordHash)) {
    await sleep(800);
    return fail(401, "That password is not this store's. · رمز درست نیست.");
  }
  const c = ownerCookie(s.slug);
  const res = ok();
  res.cookies.set(c.name, c.value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: c.maxAge });
  return res;
}

export async function DELETE(_req: NextRequest, { params }: { params: { slug: string } }) {
  const res = ok();
  res.cookies.set(cookieName(params.slug), "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
