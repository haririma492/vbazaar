// WHAT BROKE IN A SHOPPER'S BROWSER (2026-11-06: the walk crashed on the owner's Chrome and Edge, "Application
// error: a client-side exception", and could not be made to crash anywhere else). The page sends its own
// uncaught errors here; the operator reads the last 50 with GET and the admin token. No personal data: the
// message, the stack, the page, the browser's name, the time.
//
//   POST { message, stack?, url?, kind? }   → { ok }
//   GET  (x-admin-token)                    → { ok, errors: [...] }
import { NextRequest } from "next/server";
import { readMastersText, writeMastersJson } from "@/lib/splats/r2";
import { isAdminTokenValid } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
const KEY = "client-errors/log.json";
const KEEP = 50;
type Row = { at: string; kind: string; message: string; stack: string; url: string; ua: string };

// At most 20 reports a minute per server: a page stuck in an error loop must not flood the bucket.
let windowStart = 0, inWindow = 0;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v : "").slice(0, n);

async function readLog(): Promise<Row[]> {
  try { const t = await readMastersText(KEY); const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; inWindow = 0; }
  if (++inWindow > 20) return Response.json({ ok: false, error: "Too many reports." }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const row: Row = {
    at: new Date().toISOString(), kind: clip(b.kind, 40) || "error", message: clip(b.message, 1000),
    stack: clip(b.stack, 6000), url: clip(b.url, 500), ua: clip(req.headers.get("user-agent"), 300),
  };
  if (!row.message) return Response.json({ ok: false, error: "No message." }, { status: 400 });
  try { await writeMastersJson(KEY, [row, ...(await readLog())].slice(0, KEEP)); } catch { /* reporting must never fail the page */ }
  return Response.json({ ok: true });
}

export async function GET(req: NextRequest) {
  if (!isAdminTokenValid(req.headers.get("x-admin-token") || "")) return Response.json({ ok: false, error: "The operator only." }, { status: 401 });
  return Response.json({ ok: true, errors: await readLog() });
}
