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

export type Area = {
  id: string;
  name: Bi;
  files: { video?: Uploaded };
  /** Its walk once the Video agent made it, `scenes/area-<id>/walk-<stamp>.mp4`. */
  walk?: string;
  video: Step;
  thread: ThreadEntry[];
};

export type Spot = {
  id: string;
  /** The moment of the hallway walk, and the door's direction then (radians, + right / + up). */
  t: number;
  yaw: number;
  pitch: number;
  /** The door photo's width on screen at `t`, in radians of view. */
  size: number;
  /** More moments, so the door stays on the wall as the camera walks past (like a sign's pins). */
  pins?: SignPin[];
  store?: string;
};

export type Bazaar = { areas: Area[]; hallway: string | null; spots: Spot[] };

export const SUGGESTED_AREAS: Array<{ id: string; name: Bi }> = [
  { id: "outside", name: { en: "Outside the shopping centre", fa: "بیرون مرکز خرید" } },
  { id: "lobby", name: { en: "Lobby", fa: "لابی" } },
  { id: "hallway", name: { en: "Hallway", fa: "راهرو" } },
];

const freshStep = (): Step => ({ state: "todo", tries: 0, note: "", at: null });

export const emptyBazaar = (): Bazaar => ({
  areas: SUGGESTED_AREAS.map((a) => ({ ...a, files: {}, video: freshStep(), thread: [] })),
  hallway: "hallway",
  spots: [],
});

export function parseBazaar(raw: unknown): Bazaar {
  const o = (raw && typeof raw === "object" ? raw : null) as Bazaar | null;
  if (!o || !Array.isArray(o.areas)) return emptyBazaar();
  return {
    areas: o.areas.filter((a) => a && AREA_RE.test(a.id)).map((a) => ({
      id: a.id,
      name: { en: a.name?.en ?? a.id, fa: a.name?.fa ?? "" },
      files: a.files ?? {},
      ...(a.walk ? { walk: a.walk } : {}),
      video: a.video && typeof a.video.state === "string" ? a.video : freshStep(),
      thread: Array.isArray(a.thread) ? a.thread : [],
    })),
    hallway: typeof o.hallway === "string" ? o.hallway : null,
    spots: Array.isArray(o.spots) ? o.spots.filter((s) => s && typeof s.id === "string" && Number.isFinite(s.t) && Number.isFinite(s.yaw)) : [],
  };
}

/** The area added (or renamed, when its id is there). */
export function putArea(b: Bazaar, id: string, name: Bi): Bazaar {
  if (!AREA_RE.test(id)) return b;
  const i = b.areas.findIndex((a) => a.id === id);
  if (i >= 0) return { ...b, areas: b.areas.map((a) => (a.id === id ? { ...a, name } : a)) };
  return { ...b, areas: [...b.areas, { id, name, files: {}, video: freshStep(), thread: [] }] };
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
  return b.spots.find((s) => s.store === store) ?? b.spots.find((s) => !s.store) ?? null;
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
  if (!target || from?.id === to) return b;
  return {
    ...b,
    spots: b.spots.map((s) => (s.id === to ? { ...s, store } : from && s.id === from.id ? { ...s, store: target.store } : s)),
  };
}

/** Where the walks join: each area's walk carries on into the next area that has one. */
export function joins(b: Bazaar): Array<{ from: string; to: string }> {
  const walks = b.areas.map((a) => a.walk).filter((w): w is string => Boolean(w));
  return walks.slice(0, -1).map((from, i) => ({ from, to: walks[i + 1] }));
}

/** A store's door, as the hallway walk holds it. */
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
