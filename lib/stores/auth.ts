/**
 * WHO MAY OPEN A STORE'S PAGE (owner, 2026-10-30: "There will be a password
 * and only the store owner can open that store … as well as V-Bazaar
 * operator. … No username needed, just a password").
 *
 *   the owner      the store's password (asked at intake), kept as an scrypt
 *                  hash; signing in sets a cookie for that store only
 *   the operator   the admin token (`x-admin-token`, the same as /operator)
 *
 * The cookie is `<slug>.<expiry>.<hmac>`, signed with STORE_SECRET (or, until
 * that is set, the admin token), so it cannot be made up and opens one store.
 * Server only.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isAdminTokenValid } from "@/lib/adminAuth";

export const cookieName = (slug: string) => `vb_store_${slug.replace(/-/g, "_")}`;
const DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

function secret(): string {
  return (process.env.STORE_SECRET || process.env.ADMIN_TOKEN || "").trim();
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function ownerCookie(slug: string, now = Date.now()): { name: string; value: string; maxAge: number } {
  const body = `${slug}.${now + DAYS * 86400_000}`;
  return { name: cookieName(slug), value: `${body}.${sign(body)}`, maxAge: DAYS * 86400 };
}

function ownerOk(slug: string, value: string | undefined, now = Date.now()): boolean {
  if (!value || !secret()) return false;
  const [s, exp, mac] = value.split(".");
  if (s !== slug || !exp || !mac || Number(exp) < now) return false;
  const want = Buffer.from(sign(`${s}.${exp}`));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type Who = "operator" | "owner" | null;

/** Who is asking about this store: the operator (admin token), its owner (its cookie), or nobody. */
export function whoIs(req: Request & { cookies?: { get(name: string): { value: string } | undefined } }, slug: string): Who {
  if (isAdminTokenValid(req.headers.get("x-admin-token") || "")) return "operator";
  const fromJar = req.cookies?.get(cookieName(slug))?.value;
  const fromHeader = /(?:^|;\s*)([^=;]+)=([^;]*)/g;
  let value = fromJar;
  if (!value) {
    for (const m of (req.headers.get("cookie") || "").matchAll(fromHeader)) if (m[1] === cookieName(slug)) value = decodeURIComponent(m[2]);
  }
  return ownerOk(slug, value) ? "owner" : null;
}

export const isOperator = (req: Request) => isAdminTokenValid(req.headers.get("x-admin-token") || "");
