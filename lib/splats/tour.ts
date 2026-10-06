/**
 * THE TOUR — which splat scenes exist, and where a visitor can go from each.
 *
 * One JSON file, `scenes/tour.json` in the public R2 bucket, written by
 * `/operator/splats` and read by the viewer (`/vca/splat`). It is a graph: a
 * scene (the hallway, a store) has EXITS, each a marker at a point in that
 * scene that leads to another scene. The hallway's storefront marker leads to
 * `store-01`; `store-01`'s door marker leads back. A visitor chooses: tap a
 * marker, or pick from the list of exits.
 *
 * ⚠️ GOING BACK RETURNS TO WHERE YOU STOOD, not to the scene's start. The
 * viewer keeps a TRAIL (`enter` / `leave`): entering a scene remembers the
 * pose the visitor left, and leaving puts them back there — the hallway
 * resumes in front of the store they walked into.
 *
 * Pure: the screens read and edit a tour only through these functions.
 */

// `keys.ts`'s scene-id rule, repeated: `node --test` runs this file without a
// bundler, so it imports nothing.
const isSceneId = (s: string) => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s);

export type Vec3 = [number, number, number];
/** Where the camera stands and which way it looks (radians; yaw about up, pitch up/down). */
export type Pose = { position: Vec3; yaw: number; pitch: number };
export type Label = { fa: string; en: string };

export type Exit = {
  id: string;
  /** The scene this exit leads to. */
  to: string;
  label: Label;
  /** The marker's place in THIS scene. */
  at: Vec3;
  /** Where to stand on arriving; the target scene's start when absent. */
  arrive?: Pose;
};

export type TourScene = {
  id: string;
  title: Label;
  /** The web file's key in the public bucket, e.g. `scenes/hallway/hallway.spz`. */
  file: string;
  /** Most reconstructions are y-down; true turns the splat upright. */
  flip: boolean;
  start: Pose;
  /**
   * The route the cameraman walked while filming, recorded once in the
   * viewer's edit mode: visitors are drawn gently along it
   * (`lib/splats/path.ts`). Empty: no tendency.
   */
  route: Vec3[];
  /**
   * Where this scene sits in the tour's one world (`lib/splats/place.ts`),
   * set with the viewer's Align tool. Placed scenes are shown together and
   * walked between with no jump; null: a scene of its own, reached by exits.
   * The route above is in the scene's own coordinates; start and exits are
   * in the world's.
   */
  place: { offset: Vec3; yaw: number; scale: number } | null;
  /** Walking pace here, as a share of the visitor's speed: below 1 is a stroll (a narrow alley of shops). */
  pace: number;
  /** A sharper copy for computers (`…-hq.spz`); phones keep `file`. */
  fileHQ: string | null;
  /**
   * How this scene was joined on (`place`), and to which scene: by the two
   * paths alone (a guess — where the films overlap, the view jumps) or by
   * fitting the pictures both films took of the shared ground (seamless).
   * `share`: how much of it matched. Null: not joined by «go on to».
   */
  join: Join | null;
  /** Things placed into the scene (a shelf of china, a sale post): world coordinates, like exits. */
  props: Prop[];
  /**
   * WALLS: how far either side of the route a visitor may walk (the scene's
   * own units; `lib/splats/corridor.ts`). 0: no walls. Needs a route.
   */
  walls: number;
  /** Shops entered on purpose (Enter / «Go in»): a door at the entrance, a short lane inside. In the world's coordinates, like exits. */
  doors: Door[];
  exits: Exit[];
};

export type Door = { id: string; label: Label; at: Vec3; depth: number };
export type Join = { to: string; by: "paths" | "pictures"; share: number | null };

/**
 * A THING PLACED INTO A FILMED SCENE (operator, 2026-10-06): a wall shelf
 * of china, or a sale post whose price tag rises — with a voice, «I'm on
 * sale!» — as a shopper walks past. `at` is its foot on the floor (world),
 * `yaw` which way its front faces, `size` its scale (1 = metres).
 */
export type Prop = {
  id: string;
  kind: "china-shelf" | "sale-post";
  at: Vec3;
  yaw: number;
  size: number;
  /** A sale post's tag («$19.99») and what it says aloud. */
  price: string;
  say: string;
};
export const PROP_KINDS = ["china-shelf", "sale-post"] as const;

/** `corridor.ts`'s DEFAULT_HALF, repeated (this file imports nothing). */
export const DEFAULT_WALLS = 1.5;

/**
 * HOW WALKING FEELS, for every visitor — tuned by the operator in the viewer
 * (edit mode → Drive) until it handles like a car one drives without thinking.
 *   speed     «Normal» walking speed (units a second); Slow and Fast follow it.
 *   accel     seconds to reach a new speed (and to stop): higher is gentler.
 *   turn      how much a turn of the stick, the phone or the keys turns (×).
 *   turnGlide seconds for the view to settle into a turn: higher is smoother.
 */
export type Drive = { speed: number; accel: number; turn: number; turnGlide: number };
export const DEFAULT_DRIVE: Drive = { speed: 0.8, accel: 0.35, turn: 1, turnGlide: 0.35 };
export const DRIVE_LIMITS: Record<keyof Drive, [number, number]> = {
  speed: [0.2, 3], accel: [0.1, 2.5], turn: [0.2, 3], turnGlide: [0.05, 2],
};

/**
 * THE SAFE SPOT (operator, 2026-10-05): where «⌂ Centre» brings a visitor who
 * is lost — the middle of the shopping centre, set by the operator standing
 * there. Null: the tour's start.
 */
export type Hub = { scene: string; pose: Pose };

export type Tour = { version: 1; start: string; scenes: TourScene[]; drive: Drive; hub: Hub | null };

export const TOUR_KEY = "scenes/tour.json";

export const ORIGIN_POSE: Pose = { position: [0, 0, 0], yaw: 0, pitch: 0 };

export function emptyTour(): Tour {
  return { version: 1, start: "hallway", scenes: [], drive: { ...DEFAULT_DRIVE }, hub: null };
}

// ── Reading (a tour is data from a bucket: nothing is trusted) ─────────────

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function vec3(v: unknown): Vec3 {
  const a = Array.isArray(v) ? v : [];
  return [num(a[0]), num(a[1]), num(a[2])];
}

function pose(v: unknown): Pose {
  const o = (v ?? {}) as Record<string, unknown>;
  return { position: vec3(o.position), yaw: num(o.yaw), pitch: num(o.pitch) };
}

function label(v: unknown, fallback: string): Label {
  const o = (v ?? {}) as Record<string, unknown>;
  const fa = str(o.fa);
  const en = str(o.en);
  return { fa: fa || en || fallback, en: en || fa || fallback };
}

/** A recorded route: up to 5000 points (a half-metre apart, 2.5 km); anything else is dropped. */
const MAX_ROUTE = 5000;
function routeOf(v: unknown): Vec3[] {
  if (!Array.isArray(v)) return [];
  const out: Vec3[] = [];
  for (const p of v.slice(0, MAX_ROUTE)) {
    if (Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n))) {
      out.push([p[0], p[1], p[2]]);
    }
  }
  return out.length >= 2 ? out : [];
}

/** `place.ts`'s parsePlace, repeated (this file imports nothing, for `node --test`). */
function placeOf(v: unknown): TourScene["place"] {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const off = Array.isArray(o.offset) ? o.offset : [];
  const scale = n(o.scale, 1);
  return { offset: [n(off[0], 0), n(off[1], 0), n(off[2], 0)], yaw: n(o.yaw, 0), scale: scale > 1e-3 && scale < 1e3 ? scale : 1 };
}

/** Walls either side of the route: 0 (none) to 20; the default when unset. */
function wallsOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(20, Math.max(0, v)) : DEFAULT_WALLS;
}

function propsOf(v: unknown): Prop[] {
  const out: Prop[] = [];
  const ids = new Set<string>();
  for (const x of Array.isArray(v) ? v.slice(0, 100) : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = str(o.id, 40);
    const kind = PROP_KINDS.find((k) => k === o.kind);
    if (!id || !kind || ids.has(id)) continue;
    ids.add(id);
    out.push({
      id, kind, at: vec3(o.at), yaw: num(o.yaw),
      size: Math.min(10, Math.max(0.05, num(o.size, 1))),
      price: str(o.price, 24) || (kind === "sale-post" ? "$19.99" : ""),
      say: str(o.say, 160) || (kind === "sale-post" ? "I'm on sale!" : ""),
    });
  }
  return out;
}

function joinOf(v: unknown): Join | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const to = str(o.to, 40);
  if (!isSceneId(to)) return null;
  const share = typeof o.share === "number" && Number.isFinite(o.share) ? Math.min(1, Math.max(0, o.share)) : null;
  return { to, by: o.by === "pictures" ? "pictures" : "paths", share };
}

function doorsOf(v: unknown): Door[] {
  const out: Door[] = [];
  const ids = new Set<string>();
  for (const d of Array.isArray(v) ? v.slice(0, 200) : []) {
    const o = (d ?? {}) as Record<string, unknown>;
    const id = str(o.id, 40);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const depth = num(o.depth, 3);
    out.push({ id, label: label(o.label, id), at: vec3(o.at), depth: Math.min(30, Math.max(0.5, depth)) });
  }
  return out;
}

function driveOf(v: unknown): Drive {
  const o = (v ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_DRIVE };
  for (const k of Object.keys(DRIVE_LIMITS) as Array<keyof Drive>) {
    const [lo, hi] = DRIVE_LIMITS[k];
    out[k] = Math.min(hi, Math.max(lo, num(o[k], DEFAULT_DRIVE[k])));
  }
  return out;
}

/** A pace between a slow stroll and a brisk walk; 1 when unset. */
function paceOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1.5, Math.max(0.2, v)) : 1;
}

const SCENE_FILE_RE = /^scenes\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.(spz|sog|ksplat|splat|rad)$/;

/** A tour as read from JSON; scenes and exits that do not make sense are dropped. */
export function parseTour(raw: unknown): Tour {
  const o = (raw ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const scenes: TourScene[] = [];
  for (const s of Array.isArray(o.scenes) ? o.scenes : []) {
    const r = (s ?? {}) as Record<string, unknown>;
    const id = str(r.id, 40);
    const file = str(r.file, 200);
    if (!isSceneId(id) || seen.has(id) || !SCENE_FILE_RE.test(file)) continue;
    seen.add(id);
    const exitIds = new Set<string>();
    const exits: Exit[] = [];
    for (const e of Array.isArray(r.exits) ? r.exits : []) {
      const x = (e ?? {}) as Record<string, unknown>;
      const eid = str(x.id, 40);
      const to = str(x.to, 40);
      if (!eid || exitIds.has(eid) || !isSceneId(to) || to === id) continue;
      exitIds.add(eid);
      exits.push({ id: eid, to, label: label(x.label, to), at: vec3(x.at), ...(x.arrive ? { arrive: pose(x.arrive) } : {}) });
    }
    const hq = str(r.fileHQ, 200);
    scenes.push({
      id, title: label(r.title, id), file, flip: r.flip !== false, start: pose(r.start), route: routeOf(r.route),
      place: placeOf(r.place), pace: paceOf(r.pace), fileHQ: SCENE_FILE_RE.test(hq) ? hq : null,
      walls: wallsOf(r.walls), doors: doorsOf(r.doors), join: joinOf(r.join), props: propsOf(r.props), exits,
    });
  }
  // Exits to scenes that are not (or no longer) in the tour lead nowhere.
  for (const s of scenes) s.exits = s.exits.filter((e) => seen.has(e.to));
  const start = str(o.start, 40);
  const h = (o.hub ?? null) as Record<string, unknown> | null;
  const hubScene = h ? str(h.scene, 40) : "";
  const hub: Hub | null = h && seen.has(hubScene) ? { scene: hubScene, pose: pose(h.pose) } : null;
  return { version: 1, start: seen.has(start) ? start : scenes[0]?.id ?? "hallway", scenes, drive: driveOf(o.drive), hub };
}

export const sceneById = (t: Tour, id: string) => t.scenes.find((s) => s.id === id) ?? null;

// ── Editing (each returns a new tour) ──────────────────────────────────────

/** Add a scene, or point an existing one at a new file (keeping its exits and start). */
export function upsertScene(t: Tour, id: string, file: string, title?: Partial<Label>): Tour {
  const existing = sceneById(t, id);
  const scene: TourScene = existing
    ? { ...existing, file, title: title ? label({ ...existing.title, ...title }, id) : existing.title }
    : { id, file, title: label(title, id), flip: true, start: ORIGIN_POSE, route: [], place: null, pace: 1, fileHQ: null, walls: DEFAULT_WALLS, doors: [], join: null, props: [], exits: [] };
  const scenes = existing ? t.scenes.map((s) => (s.id === id ? scene : s)) : [...t.scenes, scene];
  return parseTour({ ...t, scenes, start: t.scenes.length ? t.start : id });
}

export function removeScene(t: Tour, id: string): Tour {
  return parseTour({ ...t, scenes: t.scenes.filter((s) => s.id !== id) });
}

export function updateScene(t: Tour, id: string, patch: Partial<Pick<TourScene, "title" | "flip" | "start" | "route" | "place" | "pace" | "fileHQ" | "walls" | "join" | "props">>): Tour {
  return parseTour({ ...t, scenes: t.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

function nextExitId(scene: TourScene, to: string): string {
  for (let n = 1; ; n++) {
    const id = n === 1 ? to : `${to}-${n}`;
    if (!scene.exits.some((e) => e.id === id)) return id;
  }
}

/** A new exit from `from` to `to`, its marker at `at`. Null tour change when either scene is unknown. */
export function addExit(t: Tour, from: string, to: string, at: Vec3, lbl?: Partial<Label>): Tour {
  const scene = sceneById(t, from);
  const target = sceneById(t, to);
  if (!scene || !target || from === to) return t;
  const exit: Exit = { id: nextExitId(scene, to), to, at, label: label(lbl ?? target.title, to) };
  return parseTour({ ...t, scenes: t.scenes.map((s) => (s.id === from ? { ...s, exits: [...s.exits, exit] } : s)) });
}

export function removeExit(t: Tour, from: string, exitId: string): Tour {
  return parseTour({
    ...t,
    scenes: t.scenes.map((s) => (s.id === from ? { ...s, exits: s.exits.filter((e) => e.id !== exitId) } : s)),
  });
}

/** The scene a visitor's tour begins in. Unknown scenes are ignored. */
export function setStartScene(t: Tour, id: string): Tour {
  return sceneById(t, id) ? parseTour({ ...t, start: id }) : t;
}

/** The safe spot «⌂ Centre» brings visitors to (null: the tour's start). */
export function setHub(t: Tour, hub: Hub | null): Tour {
  return parseTour({ ...t, hub });
}

/** Where «⌂ Centre» goes: the safe spot, or the tour's start. */
export function hubOf(t: Tour): Hub | null {
  if (t.hub) return t.hub;
  const s = sceneById(t, t.start);
  return s ? { scene: s.id, pose: s.start } : null;
}

/** How walking feels (any part of it), kept within its limits. */
export function setDrive(t: Tour, patch: Partial<Drive>): Tour {
  return parseTour({ ...t, drive: { ...t.drive, ...patch } });
}

/** A new prop in scene `id`; its id is the next free «shelf-1» / «sale-1». */
export function addProp(t: Tour, id: string, kind: Prop["kind"], at: Vec3, yaw: number, size = 1): Tour {
  const scene = sceneById(t, id);
  if (!scene) return t;
  const stem = kind === "china-shelf" ? "shelf" : "sale";
  let n = 1;
  while (scene.props.some((p) => p.id === `${stem}-${n}`)) n++;
  const prop = { id: `${stem}-${n}`, kind, at, yaw, size, price: "", say: "" };
  return parseTour({ ...t, scenes: t.scenes.map((s) => (s.id === id ? { ...s, props: [...s.props, prop] } : s)) });
}

export function updateProp(t: Tour, id: string, propId: string, patch: Partial<Omit<Prop, "id" | "kind">>): Tour {
  return parseTour({ ...t, scenes: t.scenes.map((s) => (s.id === id ? { ...s, props: s.props.map((p) => (p.id === propId ? { ...p, ...patch } : p)) } : s)) });
}

export function removeProp(t: Tour, id: string, propId: string): Tour {
  return parseTour({ ...t, scenes: t.scenes.map((s) => (s.id === id ? { ...s, props: s.props.filter((p) => p.id !== propId) } : s)) });
}

/** A shop door at `at` in scene `id` (world coordinates), `depth` deep. */
export function addDoor(t: Tour, id: string, at: Vec3, name: string, depth = 3): Tour {
  const scene = sceneById(t, id);
  if (!scene) return t;
  let n = scene.doors.length + 1;
  while (scene.doors.some((d) => d.id === `door-${n}`)) n++;
  const door: Door = { id: `door-${n}`, at, depth, label: label({ en: name, fa: name }, `Shop ${n}`) };
  return parseTour({ ...t, scenes: t.scenes.map((s) => (s.id === id ? { ...s, doors: [...s.doors, door] } : s)) });
}

export function removeDoor(t: Tour, id: string, doorId: string): Tour {
  return parseTour({ ...t, scenes: t.scenes.map((s) => (s.id === id ? { ...s, doors: s.doors.filter((d) => d.id !== doorId) } : s)) });
}

// ── The visitor's trail ────────────────────────────────────────────────────

/** Each step: the scene a visitor left, and exactly where they stood in it. */
export type Trail = Array<{ scene: string; pose: Pose }>;

/** Walk through `exit`, leaving `here` at `pose`: the new trail and where to stand on arrival. */
export function enter(t: Tour, trail: Trail, here: string, pose: Pose, exit: Exit): { trail: Trail; scene: string; pose: Pose } | null {
  const target = sceneById(t, exit.to);
  if (!target) return null;
  return { trail: [...trail, { scene: here, pose }], scene: target.id, pose: exit.arrive ?? target.start };
}

/** Go back one step: the scene to return to and the pose the visitor left it at. Null at the start. */
export function leave(trail: Trail): { trail: Trail; scene: string; pose: Pose } | null {
  const last = trail[trail.length - 1];
  return last ? { trail: trail.slice(0, -1), scene: last.scene, pose: last.pose } : null;
}

// ── Saving without losing someone else's change ────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * ⚠️ TWO PAGES, ONE TOUR (operator, 2026-10-04: a recorded route "exists and
 * is very difficult to record"). The viewer's edit mode and the upload page
 * each hold a copy; saving one whole copy over the tour wiped what the other
 * had saved meanwhile — an upload could erase a route recorded minutes before.
 *
 * So a save is a three-way merge: `base` is the tour this page last read,
 * `mine` this page's tour now, `theirs` the tour as stored. Whatever this
 * page changed since `base` (scene by scene, field by field) is taken from
 * `mine`; everything else stays as stored.
 */
export function mergeTour(base: Tour, mine: Tour, theirs: Tour): Tour {
  const byId = (t: Tour) => new Map(t.scenes.map((s) => [s.id, s]));
  const B = byId(base), M = byId(mine), T = byId(theirs);
  const ids = [...theirs.scenes.map((s) => s.id), ...mine.scenes.map((s) => s.id).filter((id) => !T.has(id))];
  const scenes: TourScene[] = [];
  for (const id of ids) {
    const b = B.get(id), m = M.get(id), t = T.get(id);
    if (b && !m) continue; // removed here
    if (!m) { if (t) scenes.push(t); continue; } // not ours to change
    if (!b) { scenes.push(t ? { ...t, ...m } : m); continue; } // added here
    if (!t) { if (!same(m, b)) scenes.push(m); continue; } // removed there; kept if changed here
    const out = { ...t } as Record<string, unknown>;
    for (const k of Object.keys(m) as Array<keyof TourScene>) if (!same(m[k], b[k])) out[k] = m[k];
    scenes.push(out as TourScene);
  }
  return parseTour({
    ...theirs,
    scenes,
    start: same(mine.start, base.start) ? theirs.start : mine.start,
    drive: same(mine.drive, base.drive) ? theirs.drive : mine.drive,
    hub: same(mine.hub, base.hub) ? theirs.hub : mine.hub,
  });
}
