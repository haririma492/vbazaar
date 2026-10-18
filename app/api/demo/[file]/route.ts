/**
 * GET /api/demo/<file> — the files the pitch screen (`/demo`) shows, by a
 * fixed name, and nothing else:
 *
 *   world-on-yonge.ply   the World on Yonge point cloud, from the PRIVATE masters
 *                        bucket, passed through (same site: no CORS to set up;
 *                        the name ends in .ply so the viewer knows the format)
 *   intro                the «vca-intro» video: a short-lived link to it
 *   store-3d             the same point cloud as a STREAMED copy (.rad) in the
 *                        public bucket, made on first ask (~a minute): JSON
 *                        { state, step, url }. The .ply alone took "forever"
 *                        (founder, 2026-10-13) — all of it through this server
 *                        before the first picture.
 *
 * ⚠️ AN ALLOW-LIST OF ONE FILE EACH, like `/api/splats/walks/video` signing
 * only what a door names: the masters bucket stays private; only what the
 * founder chose to show on 2026-10-13 ("headed to World on Yonge to pitch one
 * or two owner") is reachable.
 */
import { NextResponse } from "next/server";
import { downloadLink, listSplats, r2Config, readMaster } from "@/lib/splats/r2";
import { startMasterStreamJob } from "@/lib/splats/stream-job";
import { OFFLINE_BASE, offlinePath } from "@/lib/splats/offline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLY_KEY = "masters/worldonyonge-inside-1st-alley/point_cloud_last-2-.ply";
/** Its streamed copy, in the public bucket — the /demo page is public too. */
const RAD_KEY = "scenes/demo/world-on-yonge-lod.rad";

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!r2Config().configured) return NextResponse.json({ ok: false, error: "R2 is not configured on this host." }, { status: 503 });
  try {
    if (file === "world-on-yonge.ply") {
      const obj = await readMaster(PLY_KEY);
      if (!obj) return NextResponse.json({ ok: false, error: `${PLY_KEY} is not in the masters bucket.` }, { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": "application/octet-stream",
          ...(obj.size ? { "content-length": String(obj.size) } : {}),
          "cache-control": "private, max-age=3600",
        },
      });
    }
    if (file === "store-3d") {
      // Offline (`offline.ts`): the streamed copy brought along, or say it was not.
      if (r2Config().offline) {
        const here = offlinePath(RAD_KEY);
        return NextResponse.json(here
          ? { ok: true, state: "done", url: `${OFFLINE_BASE}/${RAD_KEY}` }
          : { ok: false, state: "failed", error: "The 3D store is not in the offline folder (run «npm run offline:pack» with internet first)." },
          { headers: { "cache-control": "no-store" } });
      }
      const job = startMasterStreamJob(PLY_KEY, RAD_KEY);
      const base = r2Config().publicBase;
      if (job.state === "done" && !base) {
        return NextResponse.json({ ok: false, state: "failed", error: "NEXT_PUBLIC_SPLAT_BASE_URL is not set on this host." }, { status: 503 });
      }
      return NextResponse.json(
        { ok: job.state !== "failed", state: job.state, step: job.step, error: job.error, url: job.state === "done" ? `${base}/${RAD_KEY}` : null },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (file === "intro") {
      const intro = await findIntro();
      if (!intro) return NextResponse.json({ ok: false, error: "No «vca-intro» video found in the buckets." }, { status: 404 });
      return NextResponse.redirect(new URL(await downloadLink(intro.kind, intro.key), req.url), 302);
    }
    return NextResponse.json({ ok: false, error: "Not a demo file." }, { status: 404 });
  } catch (e) {
    console.error("[demo]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** The intro video: the first video whose key names «vca-intro». */
async function findIntro() {
  const all = await listSplats();
  return all.filter((o) => /vca-intro/i.test(o.key) && /\.(mp4|mov|m4v|webm)$/i.test(o.key)).sort((a, b) => a.key.localeCompare(b.key))[0] ?? null;
}
