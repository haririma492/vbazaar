import { NextRequest, NextResponse } from "next/server";

// The home page's pilot form. Leads stay olgoo.com's (its /api/lead stores
// them and emails the team), so this hands the request on, server to server,
// with the visitor's address for olgoo.com's rate limit. Only VCA pilot
// requests pass.
const OLGOO = (process.env.OLGOO_URL || "https://olgoo.com").replace(/\/+$/, "");
const OFFERS = new Set(["vca_store", "vca_street", "vca_district"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || !OFFERS.has(body.offer)) {
    return NextResponse.json({ error: "Enter your email and pick a package." }, { status: 400 });
  }
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  try {
    const r = await fetch(`${OLGOO}/api/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(ip ? { "X-Forwarded-For": ip } : {}) },
      body: JSON.stringify({ kind: "launch", email: body.email.slice(0, 254), business: String(body.business || "").slice(0, 200), offer: body.offer }),
      cache: "no-store",
    });
    const d = await r.json().catch(() => ({}));
    return NextResponse.json(d, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Could not send — please email admin@olgoo.com." }, { status: 502 });
  }
}
