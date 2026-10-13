/**
 * GET /api/demo/<file> — the files the pitch screen (`/demo`) shows, by a
 * fixed name, and nothing else:
 *
 *   world-on-yonge.ply   the World on Yonge point cloud, from the PRIVATE masters
 *                        bucket, passed through (same site: no CORS to set up;
 *                        the name ends in .ply so the viewer knows the format)
 *   intro                the «vca-intro» video: a short-lived link to it
 *
 * ⚠️ AN ALLOW-LIST OF ONE FILE EACH, like `/api/splats/walks/video` signing
 * only what a door names: the masters bucket stays private; only what the
 * founder chose to show on 2026-10-13 ("headed to World on Yonge to pitch one
 * or two owner") is reachable.
 */
import { NextResponse } from "next/server";
import { downloadLink, listSplats, r2Config, readMaster } from "@/lib/splats/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLY_KEY = "masters/worldonyonge-inside-1st-alley/point_cloud_last-2-.ply";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
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
    if (file === "intro") {
      const intro = await findIntro();
      if (!intro) return NextResponse.json({ ok: false, error: "No «vca-intro» video found in the buckets." }, { status: 404 });
      return NextResponse.redirect(await downloadLink(intro.kind, intro.key), 302);
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
