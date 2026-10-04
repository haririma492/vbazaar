/**
 * /api/operator/splats — the Virtual Bazaar's Gaussian-splat files in R2, for
 * `/operator/splats`. x-admin-token. See `lib/splats/`.
 *
 *   GET                                               → { r2, objects, tour }
 *   POST { action: "start", scene, name, size }        → { key, kind, uploadId, partSize, partCount }
 *   POST { action: "sign", key, uploadId, partNumber } → { url }      (PUT the part's bytes there)
 *   POST { action: "parts", key, uploadId }            → { parts }    (what R2 already has: resume)
 *   POST { action: "complete", key, uploadId, parts }  → { url }      (public url for a scene file)
 *   POST { action: "abort", key, uploadId }
 *   POST { action: "link", key }                       → { url }      (24 h download link)
 *   POST { action: "cors" }                            (lets this site's browser PUT to the bucket)
 *   POST { action: "tour", tour }                      → { tour }     (saves scenes/tour.json)
 *
 * The bytes go from the browser straight to R2; nothing here touches them.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";
import { isSplatKey, partPlan, splatKey } from "@/lib/splats/keys";
import {
  abortUpload, completeUpload, downloadLink, installCors, listParts, listSplats, r2Config, readTour, signPart, startUpload,
  writeTour,
} from "@/lib/splats/r2";
import { TOUR_KEY } from "@/lib/splats/tour";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}
const ok = (body: object) => NextResponse.json({ ok: true, ...body }, { headers: NO_STORE });

function guard(req: NextRequest) {
  if (!isAdminTokenValid(req.headers.get("x-admin-token") || "")) return fail(401, "Unauthorized");
  if (!r2Config().configured) {
    return fail(503, "R2 is not configured on this host: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.");
  }
  return null;
}

/** What the screen shows about the setup — never a credential. */
function r2Summary() {
  const c = r2Config();
  return {
    webBucket: c.webBucket,
    mastersBucket: c.mastersBucket,
    mastersArePrivate: c.mastersBucket !== c.webBucket,
    publicBase: c.publicBase || null,
  };
}

const publicUrl = (key: string) => {
  const base = r2Config().publicBase;
  return base ? `${base}/${key}` : null;
};

/**
 * R2's own words, with its error code. ⚠️ ANSWERED AS 500, NOT 502: Cloudflare
 * in front of the site swaps an origin's 502 for a bare page of its own, and
 * the operator saw only "HTTP 502" instead of why R2 said no.
 */
function r2Reason(e: unknown): string {
  const err = e as { name?: string; message?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = err.Code || err.name || "Error";
  const status = err.$metadata?.httpStatusCode;
  return `${code}${status ? ` (${status})` : ""}: ${err.message || "no message"}`;
}

const uploadIdOf = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length < 1024 ? v : null);

export async function GET(req: NextRequest) {
  const refused = guard(req);
  if (refused) return refused;
  try {
    const [all, tour] = await Promise.all([listSplats(), readTour()]);
    const objects = all.filter((o) => o.key !== TOUR_KEY).map((o) => ({ ...o, url: o.kind === "web" ? publicUrl(o.key) : null }));
    return ok({ r2: r2Summary(), objects, tour });
  } catch (e) {
    console.error("[operator/splats:GET]", e);
    return fail(500, `R2 refused the listing: ${r2Reason(e)}`);
  }
}

export async function POST(req: NextRequest) {
  const refused = guard(req);
  if (refused) return refused;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Body must be JSON.");
  }

  const action = body?.action;
  try {
    if (action === "start") {
      const target = splatKey(String(body.scene ?? ""), String(body.name ?? ""));
      if (!target) return fail(400, "A scene id like «hallway» or «store-01», and a .ply, .spz, .sog, .ksplat, .splat or .rad file.");
      const plan = partPlan(Number(body.size));
      if (!plan) return fail(400, "That file size cannot be uploaded.");
      const uploadId = await startUpload(target.kind, target.key);
      return ok({ ...target, uploadId, ...plan });
    }

    if (action === "cors") {
      const origin = req.headers.get("origin") || req.nextUrl.origin;
      const origins = [...new Set([origin, process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "")].filter(Boolean) as string[])];
      await installCors(origins);
      return ok({ origins });
    }

    if (action === "tour") {
      if (!body?.tour || typeof body.tour !== "object") return fail(400, "No tour.");
      return ok({ tour: await writeTour(body.tour) });
    }

    const key = typeof body?.key === "string" ? body.key : "";
    const kind = isSplatKey(key);
    if (!kind) return fail(400, "Not a splat key.");

    if (action === "link") return ok({ url: await downloadLink(kind, key) });

    const uploadId = uploadIdOf(body.uploadId);
    if (!uploadId) return fail(400, "No upload id.");

    switch (action) {
      case "sign": {
        const n = Number(body.partNumber);
        if (!Number.isInteger(n) || n < 1 || n > 10_000) return fail(400, "Part number 1–10000.");
        return ok({ url: await signPart(kind, key, uploadId, n) });
      }
      case "parts":
        return ok({ parts: await listParts(kind, key, uploadId) });
      case "complete": {
        const parts = Array.isArray(body.parts) ? body.parts : [];
        const clean = parts
          .map((p: any) => ({ partNumber: Number(p?.partNumber), etag: String(p?.etag ?? "") }))
          .filter((p: { partNumber: number; etag: string }) => Number.isInteger(p.partNumber) && p.partNumber > 0 && p.etag);
        if (!clean.length || clean.length !== parts.length) return fail(400, "Every part needs its number and ETag.");
        await completeUpload(kind, key, uploadId, clean);
        return ok({ key, url: kind === "web" ? publicUrl(key) : null });
      }
      case "abort":
        await abortUpload(kind, key, uploadId);
        return ok({});
      default:
        return fail(400, "Unknown action.");
    }
  } catch (e) {
    console.error(`[operator/splats:${action}]`, e);
    return fail(500, `R2 refused «${action}»: ${r2Reason(e)}`);
  }
}
