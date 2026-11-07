/**
 * NIKOO RADIO IN THE BAZAAR (owner, 2026-11-06: "music will not be from a fixed audio, rather from two live
 * music channels of nikoo.tv" — channel 3, موسیقی جهان, and channel 4, نغمه‌های نوستالژیک فرانسه و ایتالیا).
 *
 * A walk tunes in to what the channel is airing THIS minute and joins it mid-programme, like a radio: the
 * channel's own state routes on nikoo.tv say what is on and how far in it is. Our server reads them
 * (`/api/radio`; nikoo.tv sends no CORS headers, and one cached read serves every shopper).
 *
 * Pure: the route and the walk's player both read this. Imports nothing, so `node --test` can load it.
 */

// Only channel 4 (owner, 2026-11-06: "only channel 4 nikoo"). Channel 3's entry stays in `RADIO` for the record.
export type RadioChannel = 4;
export const RADIO_CHANNELS: RadioChannel[] = [4];
export const DEFAULT_RADIO_CHANNEL: RadioChannel = 4;

/** The two channels, in nikoo.tv's own words, and where nikoo.tv says what each is airing. */
export const RADIO: Record<3 | 4, { fa: string; en: string; statePath: string }> = {
  3: { fa: "موسیقی جهان", en: "World Music", statePath: "/api/channels/state?id=world-greats" },
  // Channel 4 is nikoo.tv's main broadcast: it lives on the old pipeline, not in `nikoo_channel`.
  4: { fa: "نغمه‌های نوستالژیک فرانسه و ایتالیا", en: "French & Italian Nostalgic Melodies", statePath: "/api/olgoo-live/state" },
};

export function radioChannelOf(v: unknown): RadioChannel | null {
  const n = typeof v === "string" ? Number(v) : v;
  return n === 4 ? 4 : null;
}

/**
 * What the walk plays. `file` is an mp4/mp3 on our own bucket (an ordinary <audio> plays it); `youtube` needs
 * YouTube's own player; `none` is something this cannot play (a live HLS stream, nothing on air): the walk says
 * so and the shopper can switch channel.
 */
export type RadioNow = {
  ch: 3 | 4;
  kind: "file" | "youtube" | "none";
  url: string | null;
  youtubeId: string | null;
  /** Seconds into the programme at `at` (ms since epoch). */
  offsetSec: number;
  at: number;
  /** When the programme ends (ms), if the channel says; the player asks again then. */
  endsAt: number | null;
  /** What is on, and next, in nikoo.tv's words; null where it has only a placeholder ("YouTube video …"). */
  now: { fa: string | null; en: string | null } | null;
  next: { fa: string | null; en: string | null } | null;
  reason?: string;
};

/** A title that says nothing (nikoo.tv's placeholder for an untitled YouTube item) is no title. */
export function cleanTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^youtube video\s+\S+$/i.test(t)) return null;
  return t;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/** The video id of a YouTube link, or null. Host anchored, never a substring. */
export function youTubeIdOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v");
    const m = /^\/(?:embed|live|shorts|v)\/([^/?#]+)/.exec(u.pathname);
    if (!id && m) id = m[1];
  }
  return id && YT_ID.test(id) ? id : null;
}

/** A media file an <audio> element can play: https, not an HLS manifest. */
function isPlayableFile(url: unknown, playerType: unknown): url is string {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  if (/\.m3u8(\?|$)/i.test(url) || playerType === "hls") return false;
  return playerType === "video" || playerType === "audio" || /\.(mp4|m4a|mp3|aac|webm|ogg)(\?|$)/i.test(url);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pair(fa: unknown, en: unknown, artistFa?: unknown, artistEn?: unknown) {
  const join = (t: string | null, a: unknown) => (t && typeof a === "string" && a.trim() ? `${t} — ${a.trim()}` : t);
  const f = join(cleanTitle(fa), artistFa);
  const e = join(cleanTitle(en), artistEn);
  return f || e ? { fa: f, en: e } : null;
}

/**
 * One channel's state, as nikoo.tv answered it at `at`, into what the walk plays. Both routes are read here,
 * so a change to either shape is one place to fix. Never throws: a shape it cannot read is `none` with a reason.
 */
export function readChannelState(ch: 3 | 4, json: unknown, at: number): RadioNow {
  const s = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const base: RadioNow = { ch, kind: "none", url: null, youtubeId: null, offsetSec: 0, at, endsAt: null, now: null, next: null };
  if (s.ok === false) return { ...base, reason: "the channel is off air" };
  const url = s.mediaUrl;
  const offset = Math.max(0, num(s.offsetSec) ?? 0);
  let endsAt: number | null = null;
  let now: RadioNow["now"] = null;
  let next: RadioNow["next"] = null;
  if (ch === 3) {
    const e = typeof s.endsAt === "string" ? Date.parse(s.endsAt) : NaN;
    endsAt = Number.isFinite(e) ? e : null;
    now = pair(null, s.title);
    const n = Array.isArray(s.upNext) ? (s.upNext[0] as Record<string, unknown> | undefined) : undefined;
    next = n ? pair(n.titleFa, n.title) : null;
  } else {
    const item = (s.currentItem && typeof s.currentItem === "object" ? s.currentItem : {}) as Record<string, unknown>;
    const dur = num(s.currentItemDurationSec) ?? num(item.durationSec);
    endsAt = dur && dur > offset ? at + (dur - offset) * 1000 : null;
    now = pair(item.titleFa, item.titleEn ?? s.title, item.artistFa, item.artistEn);
    const n = Array.isArray(s.upcomingItems) ? (s.upcomingItems[0] as Record<string, unknown> | undefined) : undefined;
    next = n ? pair(n.titleFa, n.titleEn ?? n.title, n.artistFa, n.artistEn) : null;
  }
  const out = { ...base, offsetSec: offset, endsAt, now, next };
  const id = youTubeIdOf(url);
  if (id) return { ...out, kind: "youtube", youtubeId: id };
  if (isPlayableFile(url, s.playerType)) return { ...out, kind: "file", url };
  return { ...out, reason: typeof url === "string" && url ? "this programme cannot be played here" : "nothing is on air" };
}

/** Where the programme is now, `now` ms later than the reading. */
export function positionAt(r: Pick<RadioNow, "offsetSec" | "at">, now: number): number {
  return Math.max(0, r.offsetSec + Math.max(0, now - r.at) / 1000);
}

/**
 * A FILE PROGRAMME OF THE SAME CHANNEL, FOR A PHONE (owner, 2026-11-07: "live channel Nikoo music does not play on
 * mobile"). A phone will not start sound in a hidden YouTube player (the shopper's tap is on our page, not on it), so
 * while the channel airs a YouTube programme a phone plays the channel's own file programmes instead, in the channel's
 * order: the first file after `after` (an item index; the programme on air when none), round the playlist. Only the
 * main broadcast's state carries its playlist (`playlistItems`); null when it has no file programme.
 */
export type RadioFile = { url: string; itemIndex: number; durationSec: number | null; now: { fa: string | null; en: string | null } | null };

export function nextFileProgramme(json: unknown, after: number | null): RadioFile | null {
  const s = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const items = (Array.isArray(s.playlistItems) ? s.playlistItems : []) as Array<Record<string, unknown>>;
  const files = items
    .map((it) => ({ it, i: num(it.itemIndex) }))
    .filter((x): x is { it: Record<string, unknown>; i: number } => x.i !== null && isPlayableFile(x.it.url, x.it.mediaType === "audio" ? "audio" : "video") && !youTubeIdOf(x.it.url))
    .sort((a, b) => a.i - b.i);
  if (!files.length) return null;
  const from = after ?? num(s.currentItemIndex) ?? -1;
  const pick = files.find((x) => x.i > from) ?? files[0];
  return {
    url: pick.it.url as string,
    itemIndex: pick.i,
    durationSec: num(pick.it.durationSec),
    now: pair(pick.it.titleFa, pick.it.titleEn ?? pick.it.title),
  };
}
