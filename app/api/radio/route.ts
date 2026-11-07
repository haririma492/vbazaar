// GET /api/radio?ch=4[&file=1&after=<itemIndex>] — what Nikoo.tv channel 4 is airing this minute, for a walk tuned in
// to it (`Walk.radio`, `lib/radio.ts`). Read here rather than in the browser: nikoo.tv sends no CORS headers, and one
// cached read serves every shopper. With `file=1` (a phone): also the channel's next FILE programme after `after`
// (`nextFileProgramme`), which a phone plays while the channel airs a YouTube programme. Public; nothing private.
import { NextResponse } from "next/server";
import { RADIO, nextFileProgramme, radioChannelOf, readChannelState, type RadioChannel } from "@/lib/radio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NIKOO = (process.env.NIKOO_BASE_URL || "https://nikoo.tv").replace(/\/+$/, "");
const TTL_MS = 10_000;
type Raw = { at: number; json: unknown; reason?: string };
const cache = new Map<RadioChannel, Raw>();
const flying = new Map<RadioChannel, Promise<Raw>>();

async function read(ch: RadioChannel): Promise<Raw> {
  const at = Date.now();
  try {
    const res = await fetch(`${NIKOO}${RADIO[ch].statePath}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { at, json: null, reason: `nikoo.tv answered ${res.status}` };
    return { at, json: await res.json() };
  } catch (e) {
    return { at, json: null, reason: `nikoo.tv could not be reached (${(e as Error).message})` };
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ch = radioChannelOf(q.get("ch"));
  const NO_STORE = { "cache-control": "no-store" };
  if (!ch) return NextResponse.json({ ok: false, error: "Channel 4." }, { status: 400, headers: NO_STORE });
  let raw = cache.get(ch);
  if (!raw || Date.now() - raw.at >= TTL_MS) {
    let p = flying.get(ch);
    if (!p) { p = read(ch).finally(() => flying.delete(ch)); flying.set(ch, p); }
    raw = await p;
    if (!raw.reason) cache.set(ch, raw); // a failed read is not cached: the next shopper asks again
  }
  const radio = raw.reason ? { ...readChannelState(ch, null, raw.at), reason: raw.reason } : readChannelState(ch, raw.json, raw.at);
  const afterRaw = q.get("after");
  const after = afterRaw !== null && /^\d{1,6}$/.test(afterRaw) ? Number(afterRaw) : null;
  const file = q.get("file") === "1" && !raw.reason ? nextFileProgramme(raw.json, after) : null;
  // `at` travels with the reading, so the browser adds its own elapsed time: a cached answer is never behind.
  return NextResponse.json({ ok: true, radio, file, serverTime: Date.now() }, { headers: NO_STORE });
}
