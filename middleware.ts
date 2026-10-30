import { NextRequest, NextResponse } from "next/server";

// One host: www.vbazaar.app answers with a single 301 to the same path on
// vbazaar.app. The home page is the demo screen itself (`app/page.tsx`).
export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  if (host.startsWith("www.")) {
    const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${host.slice(4).replace(/:\d+$/, "")}`);
    return NextResponse.redirect(url, 301);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|api/).*)"] };
