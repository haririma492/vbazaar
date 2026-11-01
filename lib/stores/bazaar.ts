/**
 * THE BAZAAR'S AREAS AND THE HALLWAY'S SPOTS (owner, 2026-10-30: "another
 * screen for the hallway and outside area of shopping center and probably
 * the lobby … if you can connect the area's nicely and seamlessly you do";
 * "we start filming from outside and the door of the store should be EXACTLY
 * as the real door of each store, I can upload a separate photo of the door").
 *
 *   areas     each a 360° Insta360 walk the operator uploads (outside, lobby,
 *             hallway…), in walking order: the end of one walk carries on
 *             into the next (`Walk.next`), and the first is where shoppers
 *             start
 *   hallway   the area stores' doors go on
 *   spots     places on the hallway a door can go (a moment of its walk and
 *             a direction, marked once on its screen); a store takes the
 *             first free one, and the operator may move stores between them
 *             (`moveStore`)
 *
 * The door shoppers see in a spot is the store's own door photo, and through
 * it the store's walk, which starts outside that same real door.
 *
 * Stored privately, `stores/bazaar.json` (`BAZAAR_KEY`). Pure.
 */

import type { Bi, Step, ThreadEntry, Uploaded } from "./store";
import type { SignPin, WalkDoor } from "../splats/walks";

export const BAZAAR_KEY = "stores/bazaar.json";
export const AREA_RE = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;
/** The scene an area's walk is under. */
export const areaScene = (id: string) => `area-${id}`;

/**
 * A PLACE (owner, 2026-11-01): a shopping centre or plaza, with its own areas
 * (outside, lobby, hallways). Shoppers start a place from its first area
 * with a walk. World on Yonge is the first; a plaza across town is another.
 */
export type Place = { id: string; name: Bi };

export type Area = {
  id: string;
  name: Bi;
  /** The place it belongs to (`Place.id`). */
  place: string;
  /**
   * Where its walk carries on at its end: an area id, "" for nowhere, absent
   * for the next area of the same place in the list (unless that one is
   * entered by a door, `Spot.toArea`).
   */
  next?: string;
  files: { video?: Uploaded };
  /** Its walk once the Video agent made it, `scenes/area-<id>/walk-<stamp>.mp4`. */
  walk?: string;
  video: Step;
  thread: ThreadEntry[];
};

export type Spot = {
  id: string;
  /** The area whose walk it is on. */
  area: string;
  /** The moment of that area's walk, and the door's direction then (radians, + right / + up). */
  t: number;
  yaw: number;
  pitch: number;
  /** The door photo's width on screen at `t`, in radians of view. */
  size: number;
  /** More moments, so the door stays on the wall as the camera walks past (like a sign's pins). */
  pins?: SignPin[];
  /** The store whose door is here … */
  store?: string;
  /** … or the area this door leads into (a lobby's door into a hallway). */
  toArea?: string;
};

export type Bazaar = { places: Place[]; areas: Area[]; hallway: string | null; spots: Spot[] };

export const PLACE_RE = AREA_RE;
export const DEFAULT_PLACE: Place = { id: "world-on-yonge", name: { en: "World on Yonge", fa: "ورلد آن یانگ" } };

export const SUGGESTED_AREAS: Array<{ id: string; name: Bi }> = [
  { id: "outside", name: { en: "Outside the shopping centre", fa: "بیرون مرکز خرید" } },
  { id: "lobby", name: { en: "Lobby", fa: "لابی" } },
  { id: "hallway", name: { en: "Hallway", fa: "راهرو" } },
];

const freshStep = (): Step => ({ state: "todo", tries: 0, note: "", at: null });

export const emptyBazaar = (): Bazaar => ({
  places: [DEFAULT_PLACE],
  areas: SUGGESTED_AREAS.map((a) => ({ ...a, place: DEFAULT_PLACE.id, files: {}, video: freshStep(), thread: [] })),
  hallway: "hallway",
  spots: [],
});

export function parseBazaar(raw: unknown): Bazaar {
  const o = (raw && typeof raw === "object" ? raw : null) as (Partial<Bazaar> & { areas?: Area[] }) | null;
  if (!o || !Array.isArray(o.areas)) return emptyBazaar();
  // Before places (2026-11-01) the bazaar was one place: World on Yonge.
  const places: Place[] = Array.isArray(o.places) && o.places.length
    ? o.places.filter((p) => p && PLACE_RE.test(p.id)).map((p) => ({ id: p.id, name: { en: p.name?.en ?? p.id, fa: p.name?.fa ?? "" } }))
    : [DEFAULT_PLACE];
  const firstPlace = places[0]?.id ?? DEFAULT_PLACE.id;
  const areas: Area[] = o.areas.filter((a) => a && AREA_RE.test(a.id)).map((a) => ({
    id: a.id,
    name: { en: a.name?.en ?? a.id, fa: a.name?.fa ?? "" },
    place: places.some((p) => p.id === a.place) ? a.place : firstPlace,
    ...(typeof a.next === "string" ? { next: a.next } : {}),
    files: a.files ?? {},
    ...(a.walk ? { walk: a.walk } : {}),
    video: a.video && typeof a.video.state === "string" ? a.video : freshStep(),
    thread: Array.isArray(a.thread) ? a.thread : [],
  }));
  const hallway = typeof o.hallway === "string" ? o.hallway : null;
  const fallbackArea = hallway ?? areas[0]?.id ?? "hallway";
  return {
    places,
    areas,
    hallway,
    // Before doors could go on any area, every spot was on the hallway.
    spots: Array.isArray(o.spots)
      ? o.spots.filter((s) => s && typeof s.id === "string" && Number.isFinite(s.t) && Number.isFinite(s.yaw))
        .map((s) => ({ ...s, area: typeof s.area === "string" && s.area ? s.area : fallbackArea }))
      : [],
  };
}

/** A place added (or renamed, when its id is there). */
export function putPlace(b: Bazaar, id: string, name: Bi): Bazaar {
  if (!PLACE_RE.test(id)) return b;
  if (b.places.some((p) => p.id === id)) return { ...b, places: b.places.map((p) => (p.id === id ? { ...p, name } : p)) };
  return { ...b, places: [...b.places, { id, name }] };
}

/** An area moved to another place, and/or where its walk carries on (`Area.next`; null: back to the default). */
export function setArea(b: Bazaar, id: string, patch: { place?: string; next?: string | null }): Bazaar {
  return {
    ...b,
    areas: b.areas.map((a) => {
      if (a.id !== id) return a;
      const out: Area = { ...a };
      if (patch.place !== undefined && b.places.some((p) => p.id === patch.place)) out.place = patch.place;
      if (patch.next === null) delete out.next;
      else if (patch.next !== undefined && (patch.next === "" || (patch.next !== id && b.areas.some((x) => x.id === patch.next)))) out.next = patch.next;
      return out;
    }),
  };
}

/** A door spot that leads into another area ("" clears it, so a store may take it). */
export function linkSpot(b: Bazaar, spotId: string, toArea: string): Bazaar {
  const ok = toArea === "" || b.areas.some((a) => a.id === toArea);
  if (!ok) return b;
  return {
    ...b,
    spots: b.spots.map((s) => {
      if (s.id !== spotId) return s;
      const { toArea: _old, store: _store, ...rest } = s;
      return toArea ? { ...rest, toArea } : rest;
    }),
  };
}

/** The place a store's door is in (its spot's area's place), if it has one. */
export function placeOfStore(b: Bazaar, slug: string): string | undefined {
  const sp = b.spots.find((s) => s.store === slug);
  return sp ? b.areas.find((a) => a.id === sp.area)?.place : undefined;
}

/** The place's first area with a walk: where its shoppers start. */
export function startOf(b: Bazaar, place: string): Area | null {
  return b.areas.find((a) => a.place === place && a.walk) ?? null;
}

/** The area added (or renamed, when its id is there). */
export function putArea(b: Bazaar, id: string, name: Bi): Bazaar {
  if (!AREA_RE.test(id)) return b;
  const i = b.areas.findIndex((a) => a.id === id);
  if (i >= 0) return { ...b, areas: b.areas.map((a) => (a.id === id ? { ...a, name } : a)) };
  return { ...b, areas: [...b.areas, { id, name, place: b.places[0]?.id ?? DEFAULT_PLACE.id, files: {}, video: freshStep(), thread: [] }] };
}

/** An area one place earlier (-1) or later (+1) in the walking order. */
export function moveArea(b: Bazaar, id: string, by: -1 | 1): Bazaar {
  const i = b.areas.findIndex((a) => a.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= b.areas.length) return b;
  const areas = [...b.areas];
  [areas[i], areas[j]] = [areas[j], areas[i]];
  return { ...b, areas };
}

/** The spot a store's door is in: the one it holds, else the first free one; null when none is free. */
export function spotFor(b: Bazaar, store: string): Spot | null {
  return b.spots.find((s) => s.store === store) ?? b.spots.find((s) => !s.store && !s.toArea) ?? null;
}

export function takeSpot(b: Bazaar, spotId: string, store: string): Bazaar {
  return { ...b, spots: b.spots.map((s) => (s.id === spotId ? { ...s, store } : s.store === store ? { ...s, store: undefined } : s)) };
}

/**
 * THE OPERATOR MOVES A STORE (owner: "the operator should also be able to
 * move the layout of the stores next to each other"): into spot `to`; a store
 * already there swaps into the one this store leaves.
 */
export function moveStore(b: Bazaar, store: string, to: string): Bazaar {
  const from = b.spots.find((s) => s.store === store);
  const target = b.spots.find((s) => s.id === to);
  if (!target || target.toArea || from?.id === to) return b;
  return {
    ...b,
    spots: b.spots.map((s) => (s.id === to ? { ...s, store } : from && s.id === from.id ? { ...s, store: target.store } : s)),
  };
}

/**
 * Where the walks join: an area's walk carries on into `next` when it is set
 * ("" for nowhere); otherwise into the next area of the same place in the list
 * that has a walk — unless that area is entered by a door (a lobby's doors
 * into two hallways: the first hallway does not run on into the second).
 */
export function joins(b: Bazaar): Array<{ from: string; to: string }> {
  const byDoor = new Set(b.spots.map((s) => s.toArea).filter(Boolean) as string[]);
  const out: Array<{ from: string; to: string }> = [];
  b.areas.forEach((a, i) => {
    if (!a.walk) return;
    let to: Area | undefined;
    if (a.next !== undefined) to = a.next ? b.areas.find((x) => x.id === a.next) : undefined;
    else to = b.areas.slice(i + 1).find((x) => x.place === a.place && x.walk);
    if (a.next === undefined && to && byDoor.has(to.id)) to = undefined;
    if (to?.walk && to.walk !== a.walk) out.push({ from: a.walk, to: to.walk });
  });
  return out;
}

/** A door from one area into another (a spot with `toArea`), as its area's walk holds it. */
export function areaDoorOf(spot: Spot, to: Area): WalkDoor | null {
  if (!to.walk) return null;
  return {
    id: `area-${to.id}`,
    t: spot.t,
    yaw: spot.yaw,
    pitch: spot.pitch,
    label: { en: to.name.en, ...(to.name.fa ? { fa: to.name.fa } : {}) },
    to: to.walk,
    ...(spot.pins?.length ? { pins: spot.pins } : {}),
  };
}

/** A store's door, as its spot's area walk holds it. */
export function doorOf(spot: Spot, store: { slug: string; name: Bi; walk: string; image?: string; website?: string }): WalkDoor {
  return {
    id: `store-${store.slug}`,
    t: spot.t,
    yaw: spot.yaw,
    pitch: spot.pitch,
    label: { en: store.name.en, ...(store.name.fa ? { fa: store.name.fa } : {}) },
    to: store.walk,
    ...(store.website ? { url: store.website } : {}),
    ...(spot.pins?.length ? { pins: spot.pins } : {}),
    ...(store.image ? { image: store.image, size: spot.size } : {}),
  };
}
