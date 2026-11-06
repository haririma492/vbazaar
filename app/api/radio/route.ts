// GET /api/radio?ch=3|4 — what Nikoo.tv channel 3 or 4 is airing this minute, for a walk tuned in to it
// (`Walk.radio`, `lib/radio.ts`). Read here rather than in the browser: nikoo.tv sends no CORS headers, and one
// cached read serves every shopper instead of each one polling nikoo.tv. Public; nothing private in it.
import { NextResponse } from "next/server";
import { RADIO, radioChannelOf, readChannelState, type RadioChannel, type RadioNow } from "@/lib/radio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NIKOO = (process.env.NIKOO_BASE_URL || "https://nikoo.tv").replace(/\/+$/, "");
const TTL_MS = 10_000;
const cache = new Map<RadioChannel, { at: number; value: RadioNow }>();
const flying = new Map<RadioChannel, Promise<RadioNow>>();

async function read(ch: RadioChannel): Promise<RadioNow> {
  const at = Date.now();
  try {
    const res = await fetch(`${NIKOO}${RADIO[ch].statePath}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ...readChannelState(ch, null, at), reason: `nikoo.tv answered ${res.status}` };
    return readChannelState(ch, await res.json(), at);
  } catch (e) {
    return { ...readChannelState(ch, null, at), reason: `nikoo.tv could not be reached (${(e as Error).message})` };
  }
}

export async function GET(req: Request) {
  const ch = radioChannelOf(new URL(req.url).searchParams.get("ch"));
  const NO_STORE = { "cache-control": "no-store" };
  if (!ch) return NextResponse.json({ ok: false, error: "Channel 3 or 4." }, { status: 400, headers: NO_STORE });
  const hit = cache.get(ch);
  let value: RadioNow;
  if (hit && Date.now() - hit.at < TTL_MS) value = hit.value;
  else {
    let p = flying.get(ch);
    if (!p) {
      p = read(ch).finally(() => flying.delete(ch));
      flying.set(ch, p);
    }
    value = await p;
    // A failed read is not cached: the next shopper asks again.
    if (value.kind !== "none" || !value.reason?.startsWith("nikoo.tv")) cache.set(ch, { at: Date.now(), value });
  }
  // `at` travels with the reading, so the browser adds its own elapsed time: a cached answer is never behind.
  return NextResponse.json({ ok: true, radio: value, serverTime: Date.now() }, { headers: NO_STORE });
}
