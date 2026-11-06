/**
 * /api/stores/<slug>/website — the Website Explorer's result for one store (`lib/stores/website.ts`), shown at
 * `/stores/<slug>/website`. The store's owner (its cookie) and the operator (x-admin-token) may look; only the
 * operator starts a run, and only the operator answers whether a path robots.txt disallows may be read.
 *
 *   GET                         → { who, run, summary, website }
 *   GET ?csv=1                  → the products as a spreadsheet (UTF-8, Excel keeps the Farsi)
 *   POST { action: "run", fresh?, readDisallowed? }   start or carry on (operator); it ends by putting the products on
 *        the store's page (its product list, which both tours read) and tagging the walk again
 *   POST { action: "rematch" }                         compare again the products found in the video that matched nothing
 *   POST { action: "integrate" }                       put them on the store's page again, without reading the site
 */
import { NextRequest, NextResponse } from "next/server";
import { SLUG_RE } from "@/lib/stores/store";
import { readStore } from "@/lib/stores/bucket";
import { whoIs } from "@/lib/stores/auth";
import { fail, ok } from "@/lib/stores/http";
import { r2Config } from "@/lib/splats/r2";
import { integrateAgain, readWebsite, startWebsite } from "@/lib/stores/website";
import { readVerdicts, rematch } from "@/lib/stores/websiteMatch";
import { readCatalogue } from "@/lib/splats/r2";
import { sceneOf } from "@/lib/stores/store";
import type { Product } from "@/lib/splats/catalogue";
import { summarize, toCsv } from "@/lib/stores/websiteRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function open(req: NextRequest, slug: string) {
  if (!SLUG_RE.test(slug)) return { error: fail(404, "No such store.") };
  if (!r2Config().configured) return { error: fail(503, "R2 is not configured on this host.") };
  const who = whoIs(req, slug);
  if (!who) return { error: fail(401, "Sign in on the store's page first. · ابتدا در صفحهٔ فروشگاه وارد شوید.") };
  const s = await readStore(slug);
  if (!s) return { error: fail(404, "No such store.") };
  return { who, s };
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const o = await open(req, params.slug);
  if ("error" in o) return o.error;
  const run = await readWebsite(o.s.slug);
  if (req.nextUrl.searchParams.get("csv")) {
    return new NextResponse(toCsv(run?.products ?? []), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${o.s.slug}-website-products.csv"`, "cache-control": "no-store" },
    });
  }
  // The last merge's copy of the site and the photo map are for the merge, not the page.
  const shown = run ? { ...run, merged: undefined, photos: undefined } : null;
  // The products found in the video, each with what was decided about its website product (operator).
  let matching: unknown = null;
  if (o.who === "operator") {
    const [verdicts, cat] = await Promise.all([readVerdicts(o.s.slug), readCatalogue(sceneOf(o.s.slug)).catch(() => null)]);
    const byN = new Map<number, Product>((cat?.products ?? []).map((p) => [p.n, p]));
    matching = Object.entries(verdicts).map(([n, v]) => {
      const p = byN.get(Number(n));
      return { n: Number(n), seen: p?.seen ?? "", photo: p?.more?.[0] ?? p?.photo ?? null, matched: Boolean(v.web), name: v.web ? p?.en ?? "" : "", confidence: v.confidence, why: v.why };
    }).sort((a, b) => Number(b.matched) - Number(a.matched) || a.n - b.n);
  }
  return ok({ who: o.who, website: o.s.website ?? null, name: o.s.name, run: shown, summary: summarize(run?.products ?? []), matching });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const o = await open(req, params.slug);
  if ("error" in o) return o.error;
  if (o.who !== "operator") return fail(403, "The operator starts the explorer.");
  const body = (await req.json().catch(() => ({}))) as { action?: string; fresh?: boolean; readDisallowed?: boolean };
  if (body.action === "integrate") return ok({ note: await integrateAgain(o.s.slug) });
  if (body.action === "rematch") return ok({ note: (await rematch(o.s.slug)) || "Nothing to compare." });
  if (body.action !== "run") return fail(400, "Unknown action.");
  const r = await startWebsite(o.s.slug, {
    fresh: body.fresh === true,
    ...(typeof body.readDisallowed === "boolean" ? { readDisallowed: body.readDisallowed } : {}),
    by: "operator",
  });
  return r.started ? ok({ note: r.note }) : fail(409, r.note);
}
