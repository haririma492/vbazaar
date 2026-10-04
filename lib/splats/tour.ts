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
  exits: Exit[];
};

export type Tour = { version: 1; start: string; scenes: TourScene[] };

export const TOUR_KEY = "scenes/tour.json";

export const ORIGIN_POSE: Pose = { position: [0, 0, 0], yaw: 0, pitch: 0 };

export function emptyTour(): Tour {
  return { version: 1, start: "hallway", scenes: [] };
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
    scenes.push({ id, title: label(r.title, id), file, flip: r.flip !== false, start: pose(r.start), exits });
  }
  // Exits to scenes that are not (or no longer) in the tour lead nowhere.
  for (const s of scenes) s.exits = s.exits.filter((e) => seen.has(e.to));
  const start = str(o.start, 40);
  return { version: 1, start: seen.has(start) ? start : scenes[0]?.id ?? "hallway", scenes };
}

export const sceneById = (t: Tour, id: string) => t.scenes.find((s) => s.id === id) ?? null;

// ── Editing (each returns a new tour) ──────────────────────────────────────

/** Add a scene, or point an existing one at a new file (keeping its exits and start). */
export function upsertScene(t: Tour, id: string, file: string, title?: Partial<Label>): Tour {
  const existing = sceneById(t, id);
  const scene: TourScene = existing
    ? { ...existing, file, title: title ? label({ ...existing.title, ...title }, id) : existing.title }
    : { id, file, title: label(title, id), flip: true, start: ORIGIN_POSE, exits: [] };
  const scenes = existing ? t.scenes.map((s) => (s.id === id ? scene : s)) : [...t.scenes, scene];
  return parseTour({ ...t, scenes, start: t.scenes.length ? t.start : id });
}

export function removeScene(t: Tour, id: string): Tour {
  return parseTour({ ...t, scenes: t.scenes.filter((s) => s.id !== id) });
}

export function updateScene(t: Tour, id: string, patch: Partial<Pick<TourScene, "title" | "flip" | "start">>): Tour {
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
