// GET /api/radio — nikoo.tv for a walk's music (`Walk.radio`, `lib/radio.ts`, `lib/radioServer.ts`). Read here
// rather than in the browser: nikoo.tv sends no CORS headers, and one cached read serves every shopper.
//   ?ch=<id>            what that channel airs this minute (`main` or 4: the main broadcast; else nikoo.tv's id).
//       &file=1&after=n  (main only, a phone) also its next FILE programme after item `n` (`nextFileProgramme`).
//   ?m=<member>&c=<id>  the tracks of a category (`cat-…`) or group (`grp-…`) of Iranian Music / World Music.
//   ?catalogue=1        the channels and categories nikoo.tv has, for the store page's music card.
// Public; nothing private.
import { NextResponse } from "next/server";
import { MAIN_CHANNEL, isRadioId, nextFileProgramme, readChannelState } from "@/lib/radio";
import { channelState, musicTracks, radioCatalogue } from "@/lib/radioServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("catalogue") === "1") {
    try {
      return NextResponse.json({ ok: true, catalogue: await radioCatalogue() }, { headers: { "cache-control": "public, max-age=300" } });
    } catch (e) {
      return NextResponse.json({ ok: false, error: `nikoo.tv's list could not be read (${(e as Error).message}).` }, { status: 502, headers: NO_STORE });
    }
  }
  const member = q.get("m");
  if (member !== null) {
    const id = q.get("c");
    if ((member !== "iranmusic" && member !== "worldmusic") || !isRadioId(id) || !/^(cat|grp)-/.test(id)) {
      return NextResponse.json({ ok: false, error: "A category of Iranian Music or World Music." }, { status: 400, headers: NO_STORE });
    }
    try {
      return NextResponse.json({ ok: true, tracks: await musicTracks(member, id) }, { headers: NO_STORE });
    } catch (e) {
      // 200 with a reason: the walk falls back to the store's own tracks, the card says why.
      return NextResponse.json({ ok: true, tracks: [], reason: (e as Error).message }, { headers: NO_STORE });
    }
  }
  const chRaw = q.get("ch");
  const ch = chRaw === "4" || chRaw === "3" ? MAIN_CHANNEL : chRaw;
  if (!isRadioId(ch)) return NextResponse.json({ ok: false, error: "A Nikoo.tv channel." }, { status: 400, headers: NO_STORE });
  const raw = await channelState(ch);
  const radio = raw.reason ? { ...readChannelState(ch, null, raw.at), reason: raw.reason } : readChannelState(ch, raw.json, raw.at);
  const afterRaw = q.get("after");
  const after = afterRaw !== null && /^\d{1,6}$/.test(afterRaw) ? Number(afterRaw) : null;
  const file = q.get("file") === "1" && !raw.reason && ch === MAIN_CHANNEL ? nextFileProgramme(raw.json, after) : null;
  // `at` travels with the reading, so the browser adds its own elapsed time: a cached answer is never behind.
  return NextResponse.json({ ok: true, radio, file, serverTime: Date.now() }, { headers: NO_STORE });
}
