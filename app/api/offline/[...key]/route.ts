/**
 * GET /api/offline/<key> — a file of the offline folder (`lib/splats/offline.ts`),
 * for the demo without internet: what the bucket's public address serves
 * online. Byte ranges are answered, so a walk video seeks and steps. Only
 * when `OFFLINE_DIR` is set; otherwise 404.
 */
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { offlinePath } from "@/lib/splats/offline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", json: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const path = offlinePath(key.map(decodeURIComponent).join("/"));
  if (!path) return new Response("Not in the offline folder.", { status: 404 });
  const size = statSync(path).size;
  const type = TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
  const head = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...head, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: { ...head, "content-length": String(size) } });
}
