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
  ch: 3 | 4 | string;
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
export function readChannelState(ch: 3 | 4 | string, json: unknown, at: number): RadioNow {
  const s = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const base: RadioNow = { ch, kind: "none", url: null, youtubeId: null, offsetSec: 0, at, endsAt: null, now: null, next: null };
  if (s.ok === false) return { ...base, reason: "the channel is off air" };
  const url = s.mediaUrl;
  // A live stream has no "second it has reached": it is joined where it is now. Not the main broadcast: its
  // `isLive` says the broadcast is on air, while it plays ordinary videos that are joined at their second.
  const live = s.isLive === true && ch !== 4 && ch !== MAIN_CHANNEL;
  const offset = live ? 0 : Math.max(0, num(s.offsetSec) ?? 0);
  let endsAt: number | null = null;
  let now: RadioNow["now"] = null;
  let next: RadioNow["next"] = null;
  if (ch !== 4 && ch !== MAIN_CHANNEL) {
    const e = typeof s.endsAt === "string" ? Date.parse(s.endsAt) : NaN;
    endsAt = Number.isFinite(e) && !live ? e : null;
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

/**
 * ANY NIKOO.TV CHANNEL, OR ANY CATEGORY OF ITS MUSIC (owner, 2026-11-13: "let the music for free store tour be
 * chosen from any of nikoo.tv live tv channels or from any category in World Music or in Iranian Music").
 * A walk's `radio` is now one of:
 *  - a CHANNEL: joined live, as channel 4 was. `main` is the main broadcast (channel 4); the others are
 *    nikoo.tv's own ids (`/api/channels`).
 *  - MUSIC: a category of nikoo.tv's «Iranian Music» or «World Music» (`cat-…`: a singer, a label), or a whole
 *    group of them (`grp-…`: Jazz, Pop). Not live: its tracks one after another, from a different one each visit.
 * The names are kept with the choice, so the store's page can say what was chosen without asking nikoo.tv.
 */
export const MAIN_CHANNEL = "main";
export type MusicMember = "iranmusic" | "worldmusic";
export const MUSIC_MEMBERS: MusicMember[] = ["iranmusic", "worldmusic"];
export type RadioSource =
  | { kind: "channel"; id: string; fa: string; en: string }
  | { kind: "music"; member: MusicMember; id: string; fa: string; en: string };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isRadioId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const label = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

/** A walk's stored `radio` (4, a 3 from before, or a choice) as a choice; null when it is none of them. */
export function radioSourceOf(v: unknown): RadioSource | null {
  if (v === 3 || v === 4 || v === "3" || v === "4") return { kind: "channel", id: MAIN_CHANNEL, fa: RADIO[4].fa, en: RADIO[4].en };
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (!isRadioId(r.id)) return null;
  if (r.kind === "channel") return { kind: "channel", id: r.id, fa: label(r.fa), en: label(r.en) };
  if (r.kind === "music" && (r.member === "iranmusic" || r.member === "worldmusic") && /^(cat|grp)-/.test(r.id)) {
    return { kind: "music", member: r.member, id: r.id, fa: label(r.fa), en: label(r.en) };
  }
  return null;
}

/** How the walk asks `/api/radio` for a choice. */
export function sourceQuery(s: RadioSource): string {
  return s.kind === "channel" ? `ch=${encodeURIComponent(s.id)}` : `m=${s.member}&c=${encodeURIComponent(s.id)}`;
}

/** What nikoo.tv offers, for the store page's music card. */
export type RadioCatalogue = {
  channels: Array<{ id: string; n: number | null; fa: string; en: string }>;
  sections: Array<{
    member: MusicMember; fa: string; en: string;
    groups: Array<{ id: string; fa: string; en: string; categories: Array<{ id: string; fa: string; en: string }> }>;
  }>;
};

const rec = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? v : []) as unknown[];

/**
 * nikoo.tv's channel list (`/api/channels`) and its music section (`/api/home-sections-type-3/list`) as the
 * catalogue. The main broadcast is not in nikoo.tv's list: it is added as channel 4. An Instagram category has
 * nothing a walk can play, and one with no name cannot be chosen: both are left out. A category in no group is
 * under «Others». Never throws.
 */
export function readCatalogue(channelsJson: unknown, musicJson: unknown): RadioCatalogue {
  const channels: RadioCatalogue["channels"] = [{ id: MAIN_CHANNEL, n: 4, fa: RADIO[4].fa, en: RADIO[4].en }];
  for (const c0 of arr(rec(channelsJson).channels)) {
    const c = rec(c0);
    if (!isRadioId(c.id) || c.id === MAIN_CHANNEL) continue;
    const fa = label(c.titleFa), en = label(c.titleEn);
    if (fa || en) channels.push({ id: c.id, n: num(c.channelNumber), fa: fa || en, en: en || fa });
  }
  channels.sort((a, b) => (a.n ?? 999) - (b.n ?? 999));
  const sections: RadioCatalogue["sections"] = [];
  for (const s0 of arr(rec(musicJson).sections)) {
    for (const m0 of arr(rec(s0).members)) {
      const m = rec(m0);
      if (m.slug !== "iranmusic" && m.slug !== "worldmusic") continue;
      if (sections.some((x) => x.member === m.slug)) continue;
      const groups = arr(m.groups).map(rec).filter((g) => isRadioId(g.id) && /^grp-/.test(g.id as string))
        .map((g) => ({ id: g.id as string, fa: label(g.labelFa) || label(g.label), en: label(g.label) || label(g.labelFa), categories: [] as Array<{ id: string; fa: string; en: string }> }));
      const others = { id: "", fa: "سایر", en: "Others", categories: [] as Array<{ id: string; fa: string; en: string }> };
      for (const c0 of arr(m.categories)) {
        const c = rec(c0);
        const fa = label(c.labelFa), en = label(c.label);
        if (!isRadioId(c.id) || !/^cat-/.test(c.id) || c.platform === "instagram" || c.hasSource === false || (!fa && !en)) continue;
        (groups.find((g) => g.id === c.groupId) ?? others).categories.push({ id: c.id, fa: fa || en, en: en || fa });
      }
      const all = [...groups, others].filter((g) => g.categories.length);
      if (all.length) sections.push({ member: m.slug, fa: label(m.titleFa), en: label(m.titleEn), groups: all });
    }
  }
  sections.sort((a, b) => MUSIC_MEMBERS.indexOf(a.member) - MUSIC_MEMBERS.indexOf(b.member));
  return { channels, sections };
}

/** A choice as the catalogue has it, with nikoo.tv's own names; null when nikoo.tv has no such thing. */
export function sourceInCatalogue(cat: RadioCatalogue, kind: unknown, id: unknown, member?: unknown): RadioSource | null {
  if (kind === "channel") {
    const c = cat.channels.find((x) => x.id === id);
    return c ? { kind: "channel", id: c.id, fa: c.fa, en: c.en } : null;
  }
  if (kind !== "music") return null;
  const s = cat.sections.find((x) => x.member === member);
  if (!s) return null;
  for (const g of s.groups) {
    if (g.id && g.id === id) return { kind: "music", member: s.member, id: g.id, fa: g.fa, en: g.en };
    const c = g.categories.find((x) => x.id === id);
    if (c) return { kind: "music", member: s.member, id: c.id, fa: c.fa, en: c.en };
  }
  return null;
}

/** The categories a music choice plays: itself, or every category of the group. */
export function categoriesOf(cat: RadioCatalogue, member: MusicMember, id: string): string[] {
  const s = cat.sections.find((x) => x.member === member);
  if (!s) return [];
  const g = s.groups.find((x) => x.id && x.id === id);
  if (g) return g.categories.map((c) => c.id);
  return s.groups.some((x) => x.categories.some((c) => c.id === id)) ? [id] : [];
}

/** One thing a music choice plays: a YouTube video, or a file on nikoo.tv's own bucket. */
export type RadioTrack = { kind: "youtube"; id: string } | { kind: "file"; url: string };

/** nikoo.tv's non-stop list of a YouTube category (`/api/music/nonstop`). */
export function tracksOfNonstop(json: unknown): RadioTrack[] {
  const out: RadioTrack[] = [];
  for (const t of arr(rec(json).tracks)) {
    const id = rec(t).videoId;
    if (typeof id === "string" && YT_ID.test(id)) out.push({ kind: "youtube", id });
  }
  return out;
}

/** A category's own videos (`/api/home-sections-type-2/resolve`): files nikoo.tv keeps, or YouTube videos. */
export function tracksOfResolve(json: unknown): RadioTrack[] {
  const out: RadioTrack[] = [];
  for (const v0 of arr(rec(arr(rec(json).categories)[0]).videos)) {
    const v = rec(v0);
    // `videoUrl` only: `postUrl` of a file is a signed link that has run out.
    if (isPlayableFile(v.videoUrl, null) && !youTubeIdOf(v.videoUrl)) { out.push({ kind: "file", url: v.videoUrl }); continue; }
    const id = typeof v.id === "string" && v.id.startsWith("yt:") && YT_ID.test(v.id.slice(3)) ? v.id.slice(3) : youTubeIdOf(v.postUrl) ?? youTubeIdOf(v.videoUrl);
    if (id) out.push({ kind: "youtube", id });
  }
  return out;
}

/** Several categories' tracks as one list: one of each in turn (no singer's whole list before the next), no track twice. */
export function interleave(lists: RadioTrack[][], max: number): RadioTrack[] {
  const out: RadioTrack[] = [];
  const seen = new Set<string>();
  const longest = lists.reduce((n, l) => Math.max(n, l.length), 0);
  for (let i = 0; i < longest && out.length < max; i++) {
    for (const l of lists) {
      const t = l[i];
      if (!t || out.length >= max) continue;
      const k = t.kind === "youtube" ? t.id : t.url;
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
  }
  return out;
}
