/**
 * THE WALKS — where a visitor can step off the 360° street walk into a shop.
 *
 * Founder, 2026-10-10: "we need to architect this function with 360 video mp4
 * quality and choice to break away and enter in a shop." The visitor walks
 * the cleaned Insta360 video itself (`/vca/walk`). Along it, at a DOOR — a
 * moment of the video (`t`, seconds) and a direction in it (`yaw`) — they may
 * step inside: the walk cross-fades to the shop's own 360° video, and «Back
 * to the street» returns to the street walk at that door, facing the street.
 *
 * One JSON file, `scenes/walks.json` in the public bucket next to
 * `tour.json`, written by the walk page's edit mode (?edit=1) through
 * `/api/operator/splats` («walksSave») and read by `/api/splats/walks`:
 *
 *   {
 *     "start": "scenes/street/street-v1.mp4",          the walk visitors begin on
 *     "walks": {
 *       "scenes/street/street-v1.mp4": {
 *         "title": { "en": "Main street", "fa": "…" },
 *         "doors": [{ "id": "bakery", "t": 42.5, "yaw": 1.2,
 *                     "label": { "en": "Bakery", "fa": "نانوایی" },
 *                     "to": "scenes/bakery/bakery-v1.mp4",
 *                     "back": { "t": 43, "yaw": -1.9 } }]       optional
 *       }
 *     }
 *   }
 *
 * ⚠️ YAW IS IN THE VIDEO'S OWN FRAME: 0 is the middle of the equirectangular
 * picture (where the camera faced), positive turns RIGHT, in radians, kept in
 * (−π, π]. The walk page turns the sphere to keep the visitor's view
 * continuous across a cross-fade, so it converts its own heading into this
 * frame before saving a door — a door stays put whichever way the visitor
 * happened to be facing.
 *
 * Pure: the screens read and edit the walks only through these functions;
 * `node --test` runs this file without a bundler, so it imports nothing.
 */

export const WALKS_KEY = "scenes/walks.json";
export const MAX_DOORS = 60;
/** A door is offered within this many seconds of its moment… */
export const NEAR_DT = 1.5;
/** …while the visitor looks within this angle of it (60°). */
export const NEAR_DYAW = Math.PI / 3;
/** The shop's video starts loading this many seconds before its door. */
export const PRELOAD_DT = 6;
/** Where a door's sign sits when only its heading is known: a little below the horizon (radians, + up). */
export const DEFAULT_PITCH = -0.08;
export const MAX_PINS = 24;

export type WalkLabel = { en: string; fa?: string };
export type WalkDoor = {
  id: string;
  /** Seconds into this walk's video. */
  t: number;
  /** The door's heading from the camera at `t`, in the video's own frame. */
  yaw: number;
  label: WalkLabel;
  /** The shop's video: a 360° walk (`scenes/…/….mp4`) or a flat phone video (`masters/…/….mov`, `isPhoneVideoKey`). Absent: the door opens `url` only. */
  to?: string;
  /**
   * THE SHOP'S WEBSITE (founder, 2026-10-10: "allow operator to also enter a
   * web site to open when shoppers enter the door"). With a video too, the shop
   * walk shows «Visit the website»; on its own, stepping in opens the site in a
   * new tab. https only (`isSiteUrl`).
   */
  url?: string;
  /** The shop's video is a flat (not 360°) phone video: shown full screen, no looking round. Also detected from its shape. */
  flat?: boolean;
  /** Where «Back to the street» lands, when not at the door facing away from it. */
  back?: { t: number; yaw: number };
  /** The sign's height in the picture at `t` (radians, + up); `DEFAULT_PITCH` when not set. */
  pitch?: number;
  /**
   * ⚠️ THE SIGN SITS ON THE DOOR (founder, 2026-10-10: "I need ability to move
   * the Step Inside rectangle exactly where the door is"). As the camera walks
   * past, the door's direction changes every second, so one heading cannot
   * stay on it: the operator pins the sign on the door at a few moments, and
   * between pins it follows the door smoothly (`signAt`). With pins, the sign
   * shows from the first pin's moment to the last's.
   */
  pins?: SignPin[];
};
export type SignPin = { t: number; yaw: number; pitch: number };
export type Walk = { title?: { en: string; fa: string }; doors: WalkDoor[] };
export type Walks = { start?: string; walks: Record<string, Walk> };

// `keys.ts`'s rules, repeated (no imports): `scenes/<scene id>/<file name>.mp4`,
// exactly the keys the uploader makes for a walk video.
const SCENE_ID = "[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?";
const WALK_KEY_RE = new RegExp(`^scenes/${SCENE_ID}/[A-Za-z0-9][A-Za-z0-9._-]{0,116}\\.[mM][pP]4$`);
const DOOR_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const PHONE_VIDEO_RE = new RegExp(`^masters/${SCENE_ID}/[A-Za-z0-9][A-Za-z0-9._-]{0,116}\\.(?:[mM][oO][vV]|[mM][pP]4)$`);

/** A shop's website: an https address, nothing else (no javascript:, no plain http). */
export function isSiteUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 400) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && Boolean(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** A 360° walk video's key in the scenes bucket, as the uploader makes them. */
export const isWalkKey = (v: unknown): v is string => typeof v === "string" && WALK_KEY_RE.test(v);
/**
 * A PHONE VIDEO OF A SHOP'S INSIDE (founder, 2026-10-10: the first two shops
 * are filmed with an iPhone — a flat video, not 360°). The uploader keeps a
 * `.mov` privately (`masters/<scene>/<file>.mov`); naming it as a door's
 * target is what lets visitors see it (`/api/splats/walks/video` signs a
 * short-lived link for a key a door names, and for nothing else).
 */
export const isPhoneVideoKey = (v: unknown): v is string => typeof v === "string" && PHONE_VIDEO_RE.test(v);
/** Anything a door may lead to, or a walk may be: a 360° walk or a phone video. */
export const isVideoKey = (v: unknown): v is string => isWalkKey(v) || isPhoneVideoKey(v);

/** The lighter copy a phone plays, when uploaded next to the original: `walk-v1.mp4` → `walk-v1-phone.mp4`. */
export const phoneKeyOf = (key: string) => key.replace(/\.mp4$/i, "-phone.mp4");
export const isPhoneCopy = (key: string) => /-phone\.mp4$/i.test(key);

/** An angle in (−π, π]. */
export function wrapAngle(a: number): number {
  const r = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return r === -Math.PI ? Math.PI : r;
}
/** How far `a` is from `b`, the short way round. */
export const angleDiff = (a: number, b: number) => wrapAngle(a - b);

export const emptyWalks = (): Walks => ({ walks: {} });

// ── Reading (data from a bucket or a browser: nothing is trusted) ─────────────

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The walks as read, and every problem found on the way. A problem's entry is
 * dropped from `walks`: the viewer reads with `parseWalks` and shows what is
 * sound; a save is refused while `problems` is not empty (`walksSave`).
 */
export function checkWalks(raw: unknown): { walks: Walks; problems: string[] } {
  const problems: string[] = [];
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const walks: Record<string, Walk> = {};
  const src = o.walks && typeof o.walks === "object" && !Array.isArray(o.walks) ? (o.walks as Record<string, unknown>) : {};
  if (o.walks !== undefined && src !== o.walks) problems.push("«walks» must be an object keyed by video.");
  for (const [key, w] of Object.entries(src)) {
    if (!isVideoKey(key)) {
      problems.push(`«${key}» is not a walk video key (scenes/<scene>/<file>.mp4, or a phone video masters/<scene>/<file>.mov).`);
      continue;
    }
    const r = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
    const walk: Walk = { doors: [] };
    if (r.title !== undefined) {
      const t = (r.title ?? {}) as Record<string, unknown>;
      const en = str(t.en, 120), fa = str(t.fa, 120);
      if (en || fa) walk.title = { en: en || fa, fa };
    }
    const doors = Array.isArray(r.doors) ? r.doors : [];
    if (r.doors !== undefined && !Array.isArray(r.doors)) problems.push(`${key}: «doors» must be a list.`);
    if (doors.length > MAX_DOORS) problems.push(`${key}: ${doors.length} doors; at most ${MAX_DOORS}.`);
    const ids = new Set<string>();
    for (const d of doors.slice(0, MAX_DOORS)) {
      const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
      const id = typeof x.id === "string" ? x.id : "";
      const where = `${key}, door «${id || "?"}»`;
      if (!DOOR_ID_RE.test(id)) { problems.push(`${where}: an id of lowercase letters, digits and hyphens.`); continue; }
      if (ids.has(id)) { problems.push(`${where}: the id is used twice.`); continue; }
      if (!finite(x.t) || x.t < 0) { problems.push(`${where}: its time must be a number of seconds ≥ 0.`); continue; }
      if (!finite(x.yaw)) { problems.push(`${where}: its direction must be a number (radians).`); continue; }
      const lbl = (x.label ?? {}) as Record<string, unknown>;
      const en = str(lbl.en, 80), fa = str(lbl.fa, 80);
      if (!en) { problems.push(`${where}: it needs an English label.`); continue; }
      const hasTo = x.to !== undefined && x.to !== null && x.to !== "";
      const hasUrl = x.url !== undefined && x.url !== null && x.url !== "";
      if (!hasTo && !hasUrl) { problems.push(`${where}: it leads nowhere — choose the shop's video, or enter its website.`); continue; }
      if (hasTo && !isVideoKey(x.to)) { problems.push(`${where}: «leads to» must be a walk video (scenes/<scene>/<file>.mp4) or a phone video (masters/<scene>/<file>.mov).`); continue; }
      if (hasTo && x.to === key) { problems.push(`${where}: it leads to the walk it is on.`); continue; }
      if (hasUrl && !isSiteUrl(x.url)) { problems.push(`${where}: its website must be an https:// address.`); continue; }
      let back: WalkDoor["back"];
      if (x.back !== undefined && x.back !== null) {
        const b = x.back as Record<string, unknown>;
        if (!finite(b.t) || b.t < 0 || !finite(b.yaw)) { problems.push(`${where}: «back» needs a time ≥ 0 and a direction.`); continue; }
        back = { t: b.t, yaw: wrapAngle(b.yaw) };
      }
      let pitch: number | undefined;
      if (x.pitch !== undefined && x.pitch !== null) {
        if (!finite(x.pitch) || Math.abs(x.pitch) > 1.5) { problems.push(`${where}: its sign height must be an angle between −1.5 and 1.5 (radians).`); continue; }
        pitch = x.pitch;
      }
      let pins: SignPin[] | undefined;
      if (x.pins !== undefined && x.pins !== null) {
        const raw = Array.isArray(x.pins) ? x.pins : null;
        const ok = raw?.every((q) => {
          const r = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
          return finite(r.t) && r.t >= 0 && finite(r.yaw) && finite(r.pitch) && Math.abs(r.pitch) <= 1.5;
        });
        if (!raw || !ok || raw.length > MAX_PINS) { problems.push(`${where}: its sign pins must be up to ${MAX_PINS} of { t ≥ 0, yaw, pitch }.`); continue; }
        pins = sortPins((raw as Array<Record<string, number>>).map((q) => ({ t: q.t, yaw: wrapAngle(q.yaw), pitch: q.pitch })));
        if (!pins.length) pins = undefined;
      }
      ids.add(id);
      walk.doors.push({
        id, t: x.t, yaw: wrapAngle(x.yaw), label: fa ? { en, fa } : { en },
        ...(hasTo ? { to: x.to as string } : {}), ...(hasUrl ? { url: x.url as string } : {}),
        ...(x.flat === true ? { flat: true } : {}), ...(back ? { back } : {}),
        ...(pitch !== undefined ? { pitch } : {}), ...(pins ? { pins } : {}),
      });
    }
    walk.doors.sort((a, b) => a.t - b.t);
    walks[key] = walk;
  }
  const out: Walks = { walks };
  if (o.start !== undefined && o.start !== null && o.start !== "") {
    if (isWalkKey(o.start)) out.start = o.start;
    else problems.push("«start» must be a walk video key.");
  }
  return { walks: out, problems };
}

/** The walks as read from JSON; what does not make sense is dropped. */
export const parseWalks = (raw: unknown): Walks => checkWalks(raw).walks;

/** Every video key the walks name (walks, doors' targets, start) — what must exist in the bucket. */
export function keysNamed(w: Walks): string[] {
  const s = new Set<string>(Object.keys(w.walks));
  for (const walk of Object.values(w.walks)) for (const d of walk.doors) if (d.to) s.add(d.to);
  if (w.start) s.add(w.start);
  return [...s];
}

/** Pins in time order, one per moment (a later pin within 0.05 s replaces an earlier one). */
export function sortPins(pins: SignPin[]): SignPin[] {
  const out: SignPin[] = [];
  for (const q of [...pins].sort((a, b) => a.t - b.t)) {
    if (out.length && Math.abs(out[out.length - 1].t - q.t) < 0.05) out[out.length - 1] = q;
    else out.push(q);
  }
  return out;
}

// ── The visitor's questions ──────────────────────────────────────────────────

/** The moments a door's sign shows between: its pins' first and last, or its own moment. */
export function signSpan(door: WalkDoor): [number, number] {
  const p = door.pins;
  return p && p.length >= 2 ? [p[0].t, p[p.length - 1].t] : p && p.length === 1 ? [p[0].t, p[0].t] : [door.t, door.t];
}

/**
 * Where the door's sign is at `t` (the video's frame: yaw + right, pitch + up),
 * or null when it is not shown. With two pins or more it follows them —
 * linearly between, the short way round — from the first to the last, held
 * half a second past either end; with one pin, or none, it is shown within
 * ±`slack` s of its moment, where it was put.
 */
export function signAt(door: WalkDoor, t: number, slack = NEAR_DT): { yaw: number; pitch: number } | null {
  const p = door.pins;
  if (p && p.length >= 2) {
    const a = p[0], z = p[p.length - 1];
    if (t < a.t - 0.5 || t > z.t + 0.5) return null;
    if (t <= a.t) return { yaw: a.yaw, pitch: a.pitch };
    if (t >= z.t) return { yaw: z.yaw, pitch: z.pitch };
    let i = 0;
    while (i < p.length - 2 && p[i + 1].t < t) i++;
    const q0 = p[i], q1 = p[i + 1];
    const k = (t - q0.t) / (q1.t - q0.t || 1);
    return { yaw: wrapAngle(q0.yaw + angleDiff(q1.yaw, q0.yaw) * k), pitch: q0.pitch + (q1.pitch - q0.pitch) * k };
  }
  const one = p && p.length === 1 ? p[0] : { t: door.t, yaw: door.yaw, pitch: door.pitch ?? DEFAULT_PITCH };
  return Math.abs(one.t - t) <= slack ? { yaw: one.yaw, pitch: one.pitch } : null;
}

export const walkOf = (w: Walks, key: string | null | undefined): Walk | null => (key ? w.walks[key] ?? null : null);

/**
 * The doors in reach at time `t` while looking at `yaw` (the video's frame):
 * within ±`dt` seconds and ±`dyaw` radians, nearest first (time and angle
 * weighed by their reach).
 */
export function doorsNear(walk: Walk | null, t: number, yaw: number, reach: { dt?: number; dyaw?: number } = {}): WalkDoor[] {
  if (!walk) return [];
  const dt = reach.dt ?? NEAR_DT, dyaw = reach.dyaw ?? NEAR_DYAW;
  const near: { d: WalkDoor; cost: number }[] = [];
  for (const d of walk.doors) {
    const s = signAt(d, t, dt);
    if (!s) continue;
    const off = Math.abs(angleDiff(s.yaw, yaw));
    if (off > dyaw) continue;
    const [a, b] = signSpan(d);
    near.push({ d, cost: (t < a ? a - t : t > b ? t - b : 0) / dt + off / dyaw });
  }
  return near.sort((x, y) => x.cost - y.cost).map((x) => x.d);
}

/** Doors within `within` seconds of `t`, whichever way the visitor looks, nearest in time first — what to show on the sphere and preload. */
export function doorsAround(walk: Walk | null, t: number, within = PRELOAD_DT): WalkDoor[] {
  if (!walk) return [];
  const gap = (d: WalkDoor) => { const [a, b] = signSpan(d); return t < a ? a - t : t > b ? t - b : 0; };
  return walk.doors.filter((d) => gap(d) <= within).sort((a, b) => gap(a) - gap(b));
}

/** Whether a door's video is shown flat (full screen, no looking round): ticked, or a phone video. The walk page also detects it from the video's shape. */
export const isFlatDoor = (door: WalkDoor) => door.flat === true || isPhoneVideoKey(door.to);
/** A door with a website and no video: stepping in opens the site. */
export const isSiteOnlyDoor = (door: WalkDoor) => !door.to && Boolean(door.url);

/** A video that is not about 2:1 is not an equirectangular 360° picture. */
export const looksFlat = (width: number, height: number) => !(width > 0 && height > 0) || Math.abs(width / height - 2) > 0.05;

/** Where «Back to the street» lands: at the door, facing away from it (toward the street), unless overridden. */
export function returnPoint(door: WalkDoor): { t: number; yaw: number } {
  return door.back ? { ...door.back } : { t: door.t, yaw: wrapAngle(door.yaw + Math.PI) };
}

// ── The operator's edits ─────────────────────────────────────────────────────

/** A door id from its label: `Ali's Bakery` → `alis-bakery`, `-2`, `-3`… when taken. */
export function nextDoorId(walk: Walk | null, label: string): string {
  const base = label.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34).replace(/-+$/, "") || "door";
  const taken = new Set((walk?.doors ?? []).map((d) => d.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const withWalk = (w: Walks, key: string, f: (walk: Walk) => Walk): Walks =>
  ({ ...w, walks: { ...w.walks, [key]: f(w.walks[key] ?? { doors: [] }) } });

export function addDoor(w: Walks, key: string, door: Omit<WalkDoor, "id"> & { id?: string }): Walks {
  return withWalk(w, key, (walk) => {
    const id = door.id && !walk.doors.some((d) => d.id === door.id) ? door.id : nextDoorId(walk, door.label.en);
    const doors = [...walk.doors, { ...door, id, yaw: wrapAngle(door.yaw), ...(door.pins ? { pins: sortPins(door.pins.map((q) => ({ ...q, yaw: wrapAngle(q.yaw) }))) } : {}) }].sort((a, b) => a.t - b.t);
    return { ...walk, doors };
  });
}

export function updateDoor(w: Walks, key: string, id: string, patch: Partial<Omit<WalkDoor, "id">>): Walks {
  if (!w.walks[key]) return w;
  return withWalk(w, key, (walk) => ({
    ...walk,
    doors: walk.doors.map((d) => (d.id === id ? { ...d, ...patch, ...(patch.yaw !== undefined ? { yaw: wrapAngle(patch.yaw) } : {}) } : d)).sort((a, b) => a.t - b.t),
  }));
}

export function removeDoor(w: Walks, key: string, id: string): Walks {
  if (!w.walks[key]) return w;
  return withWalk(w, key, (walk) => ({ ...walk, doors: walk.doors.filter((d) => d.id !== id) }));
}

export function setStart(w: Walks, key: string | null): Walks {
  const { start: _drop, ...rest } = w;
  return key && isWalkKey(key) ? { ...rest, start: key } : rest;
}

/**
 * The walk `/vca/walk` opens: the one the operator set, else the street — a
 * walk with doors that no door leads into (the most doors wins). Doors were
 * placed and saved without «Set as the street walk» on 2026-10-10, and the
 * plain address showed nothing.
 */
export function startOf(w: Walks): string | null {
  if (w.start && isWalkKey(w.start)) return w.start;
  const inside = new Set(Object.values(w.walks).flatMap((walk) => walk.doors.map((d) => d.to)));
  const streets = Object.entries(w.walks)
    .filter(([k, walk]) => isWalkKey(k) && walk.doors.length && !inside.has(k))
    .sort((a, b) => b[1].doors.length - a[1].doors.length);
  return streets[0]?.[0] ?? null;
}

// ── Saving without losing someone else's change ──────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of two lists of things with ids, as `mergeTour` does scenes: what `mine` changed since `base` wins; the rest is `theirs`. */
function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[]): T[] {
  const B = new Map(base.map((x) => [x.id, x])), M = new Map(mine.map((x) => [x.id, x])), T = new Map(theirs.map((x) => [x.id, x]));
  const ids = [...theirs.map((x) => x.id), ...mine.map((x) => x.id).filter((id) => !T.has(id))];
  const out: T[] = [];
  for (const id of ids) {
    const b = B.get(id), m = M.get(id), t = T.get(id);
    if (b && !m) continue; // removed here
    if (!m) { if (t) out.push(t); continue; } // not ours to change
    if (!b || !t) { if (!b || !same(m, b)) out.push(m); continue; } // added here; or removed there but changed here
    out.push(same(m, b) ? t : m);
  }
  return out;
}

/**
 * ⚠️ TWO OPERATORS, ONE FILE — the same lesson as the tour's (`mergeTour`).
 * `base` is the walks this page last read, `mine` this page's walks now,
 * `theirs` the walks as stored. Whatever this page changed since `base` (walk
 * by walk, door by door, the start) is taken from `mine`; the rest stays as
 * stored.
 */
export function mergeWalks(base: Walks, mine: Walks, theirs: Walks): Walks {
  const keys = [...Object.keys(theirs.walks), ...Object.keys(mine.walks).filter((k) => !(k in theirs.walks))];
  const walks: Record<string, Walk> = {};
  for (const k of keys) {
    const b = base.walks[k], m = mine.walks[k], t = theirs.walks[k];
    if (b && !m) continue; // removed here
    if (!m) { if (t) walks[k] = t; continue; } // not ours to change
    if (!t) { if (!b || !same(m, b)) walks[k] = m; continue; } // added here; or removed there but changed here
    const bb: Walk = b ?? { doors: [] };
    const title = same(m.title, bb.title) ? t.title : m.title;
    walks[k] = { ...(title ? { title } : {}), doors: mergeById(bb.doors, m.doors, t.doors) };
  }
  const start = same(mine.start, base.start) ? theirs.start : mine.start;
  return parseWalks({ walks, ...(start ? { start } : {}) });
}

/** What both this page and someone else changed differently since `base` — the merge took this page's; say so. */
export function mergeConflicts(base: Walks, mine: Walks, theirs: Walks): string[] {
  const out: string[] = [];
  for (const [k, m] of Object.entries(mine.walks)) {
    const b = base.walks[k], t = theirs.walks[k];
    if (!b || !t) continue;
    for (const d of m.doors) {
      const bd = b.doors.find((x) => x.id === d.id), td = t.doors.find((x) => x.id === d.id);
      if (bd && td && !same(d, bd) && !same(td, bd) && !same(d, td)) out.push(`Door «${d.id}» on ${k} was also changed elsewhere; this page's version was kept.`);
      if (bd && !td && !same(d, bd)) out.push(`Door «${d.id}» on ${k} was deleted elsewhere; this page's changed version was kept.`);
    }
    for (const bd of b.doors) {
      const td = t.doors.find((x) => x.id === bd.id);
      if (td && !m.doors.some((x) => x.id === bd.id) && !same(td, bd)) out.push(`Door «${bd.id}» on ${k} was changed elsewhere but deleted here; it is deleted.`);
    }
  }
  if (!same(mine.start, base.start) && !same(theirs.start, base.start) && !same(mine.start, theirs.start)) {
    out.push("The starting walk was also changed elsewhere; this page's choice was kept.");
  }
  return out;
}
