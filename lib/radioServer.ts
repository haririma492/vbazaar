/**
 * NIKOO.TV, READ BY OUR SERVER for the walks' music (`lib/radio.ts` has the rules; this fetches and remembers).
 * nikoo.tv sends no CORS headers, and one cached read serves every shopper. Only nikoo.tv is ever fetched, and
 * only for an id its own catalogue lists. A failed read is never remembered: the next shopper asks again.
 */
import {
  MAIN_CHANNEL, RADIO, categoriesOf, interleave, isRadioId, readCatalogue, tracksOfNonstop, tracksOfResolve,
  type MusicMember, type RadioCatalogue, type RadioTrack,
} from "./radio";

const NIKOO = (process.env.NIKOO_BASE_URL || "https://nikoo.tv").replace(/\/+$/, "");

async function getJson(path: string, ms = 12_000): Promise<unknown> {
  const res = await fetch(`${NIKOO}${path}`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
  // nikoo.tv answers "not a YouTube source" with JSON on a 200 and "no such category" on a 404: both are read.
  const json = await res.json().catch(() => null);
  if (json === null) throw new Error(`nikoo.tv answered ${res.status}`);
  return json;
}

/** One read at a time per key, kept for `ttl`; a failure is thrown to everyone waiting and not kept. */
function remembered<T>(ttl: number, max: number) {
  const kept = new Map<string, { at: number; value: T }>();
  const flying = new Map<string, Promise<T>>();
  return async (key: string, read: () => Promise<T>): Promise<T> => {
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    let p = flying.get(key);
    if (!p) {
      p = read().then((value) => {
        if (kept.size >= max) kept.delete(kept.keys().next().value as string);
        kept.set(key, { at: Date.now(), value });
        return value;
      }).finally(() => flying.delete(key));
      flying.set(key, p);
    }
    return p;
  };
}

const HOUR = 3_600_000;
const catalogueOnce = remembered<RadioCatalogue>(HOUR, 1);
/** The channels and the music categories nikoo.tv has now (an hour's memory). Throws when it cannot be reached. */
export function radioCatalogue(): Promise<RadioCatalogue> {
  return catalogueOnce("all", async () => {
    const [channels, music] = await Promise.all([getJson("/api/channels"), getJson("/api/home-sections-type-3/list", 20_000)]);
    const cat = readCatalogue(channels, music);
    if (cat.channels.length < 2 && !cat.sections.length) throw new Error("nikoo.tv's list came back empty");
    return cat;
  });
}

export type RawState = { at: number; json: unknown; reason?: string };
const stateOnce = remembered<RawState>(10_000, 40);
/** What a channel airs this minute, as nikoo.tv says it (10 s memory). Never throws: a failure is a `reason`. */
export async function channelState(id: string): Promise<RawState> {
  if (id !== MAIN_CHANNEL && !isRadioId(id)) return { at: Date.now(), json: null, reason: "no such channel" };
  const path = id === MAIN_CHANNEL ? RADIO[4].statePath : `/api/channels/state?id=${encodeURIComponent(id)}`;
  try {
    return await stateOnce(id, async () => {
      const at = Date.now();
      const res = await fetch(`${NIKOO}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(res.status === 404 ? "nikoo.tv has no such channel" : `nikoo.tv answered ${res.status}`);
      return { at, json: await res.json() };
    });
  } catch (e) {
    const m = (e as Error).message;
    return { at: Date.now(), json: null, reason: /nikoo\.tv/.test(m) ? m : `nikoo.tv could not be reached (${m})` };
  }
}

/** A group is many singers: at most this many of them, this many tracks of each, this many in all. */
const GROUP_CATEGORIES = 40;
const PER_CATEGORY = 25;
const MAX_TRACKS = 400;

async function categoryTracks(member: MusicMember, id: string): Promise<RadioTrack[]> {
  const q = `slug=${member}&category=${encodeURIComponent(id)}`;
  const non = tracksOfNonstop(await getJson(`/api/music/nonstop?${q}`, 15_000).catch(() => null));
  if (non.length) return non;
  // Not a YouTube source (nikoo.tv's own files), or the non-stop list is not there: the category's own videos.
  return tracksOfResolve(await getJson(`/api/home-sections-type-2/resolve?${q}`, 15_000));
}

const tracksOnce = remembered<RadioTrack[]>(6 * HOUR, 60);
/** What a music choice plays (6 h memory). Throws with a reason a person can read when there is nothing. */
export function musicTracks(member: MusicMember, id: string): Promise<RadioTrack[]> {
  return tracksOnce(`${member}/${id}`, async () => {
    const cats = categoriesOf(await radioCatalogue(), member, id);
    if (!cats.length) throw new Error("nikoo.tv has no such category");
    if (cats.length === 1) {
      const one = (await categoryTracks(member, cats[0])).slice(0, MAX_TRACKS);
      if (!one.length) throw new Error("this category has nothing a walk can play");
      return one;
    }
    // A group: its categories spread evenly when there are more than we read, 6 at a time.
    const step = Math.max(1, cats.length / GROUP_CATEGORIES);
    const pick = Array.from({ length: Math.min(cats.length, GROUP_CATEGORIES) }, (_, i) => cats[Math.floor(i * step)]);
    const lists: RadioTrack[][] = new Array(pick.length).fill(null).map(() => []);
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < pick.length) {
        const i = next++;
        lists[i] = (await categoryTracks(member, pick[i]).catch(() => [])).slice(0, PER_CATEGORY);
      }
    }));
    const all = interleave(lists, MAX_TRACKS);
    if (!all.length) throw new Error("this group has nothing a walk can play");
    return all;
  });
}
