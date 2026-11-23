import { NextRequest, NextResponse } from "next/server";

// One host: www.vbazaar.app answers with a single 301 to the same path on
// vbazaar.app. The home page is olgoo.com's VCA page (`app/page.tsx`); the
// demo screen is /demo.
// Short addresses of a store, shown as they are (a rewrite: the address bar keeps the short one). Owner, 2026-11-23:
// «I need -bakery dropped from URL». The store's own slug does not change: its files and records stay where they are.
const STORE_ALIASES: Record<string, string> = { oranous: "oranous-bakery" };

export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  if (host.startsWith("www.")) {
    const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${host.slice(4).replace(/:\d+$/, "")}`);
    return NextResponse.redirect(url, 301);
  }
  // /<alias>… and /stores/<alias>…, the rest of the path and the query kept.
  const m = /^\/(stores\/)?([^/]+)(\/.*)?$/.exec(req.nextUrl.pathname);
  const target = m && STORE_ALIASES[m[2]];
  if (m && target) {
    const url = req.nextUrl.clone();
    url.pathname = `/${m[1] ?? ""}${target}${m[3] ?? ""}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|api/).*)"] };
