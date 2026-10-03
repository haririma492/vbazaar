/**
 * WHERE A GAUSSIAN-SPLAT FILE LIVES IN R2, AND HOW IT IS SENT THERE.
 *
 * The Virtual Bazaar's scenes (a hallway, then one per shop) are Gaussian
 * splats reconstructed from 360° footage. They never go into git: a master
 * `.ply` is ~2 GB, and even the web copy is tens of MB. They live in Cloudflare
 * R2 under two prefixes, one per kind of file:
 *
 *   masters/<scene>/<file>.ply      the reconstruction as it came out of
 *                                   Splatica — the source every web copy is
 *                                   made from. NEVER SERVED to visitors.
 *   scenes/<scene>/<file>.spz|sog…  the optimized copy the viewer loads.
 *
 * `<scene>` is the scene's id — `hallway`, `store-01`, … — the same id the
 * viewer will use to load it, so a storefront's portal names its store by it.
 *
 * Pure: `/api/operator/splats` validates every key a browser sends back with
 * `isSplatKey`, and the upload screen plans its parts with `partPlan`.
 */

export type SplatKind = "master" | "web";

const MiB = 1024 * 1024;
/** R2 (like S3) wants every part but the last ≥ 5 MiB, and at most 10,000 parts. */
const MIN_PART = 5 * MiB;
const MAX_PARTS = 10_000;
/**
 * 64 MiB parts: a 2 GB master is 30 of them — few enough to sign one at a time,
 * small enough that a dropped connection costs one part, not the file.
 */
const PREFERRED_PART = 64 * MiB;
/** R2's own ceiling for one object. */
const MAX_OBJECT = 5 * 1024 * 1024 * MiB - 5 * MiB;

/** What the viewer can load (Spark: SPZ, PlayCanvas SOG, mkkellogg KSPLAT, antimatter15 SPLAT, Spark RAD). */
const WEB_EXTENSIONS = ["spz", "sog", "ksplat", "splat", "rad"] as const;

const CONTENT_TYPES: Record<string, string> = {
  ply: "application/octet-stream",
  spz: "application/octet-stream",
  sog: "application/zip",
  ksplat: "application/octet-stream",
  splat: "application/octet-stream",
  rad: "application/octet-stream",
};

const SCENE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** `hallway`, `store-01`: lowercase letters, digits and inner hyphens. */
export function isSceneId(s: string): boolean {
  return SCENE_RE.test(s);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** A file name safe for a key: anything outside `A-Za-z0-9._-` becomes `-`. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 121);
  return FILE_RE.test(cleaned) ? cleaned : "";
}

/** A `.ply` is a master; a web format is a scene file; anything else is refused. */
export function kindOfFile(name: string): SplatKind | null {
  const ext = extensionOf(name);
  if (ext === "ply") return "master";
  return (WEB_EXTENSIONS as readonly string[]).includes(ext) ? "web" : null;
}

/** The R2 key a file is uploaded under, or null when the scene or file is not acceptable. */
export function splatKey(scene: string, fileName: string): { key: string; kind: SplatKind } | null {
  if (!isSceneId(scene)) return null;
  const file = safeFileName(fileName);
  const kind = file ? kindOfFile(file) : null;
  if (!kind) return null;
  return { key: `${kind === "master" ? "masters" : "scenes"}/${scene}/${file}`, kind };
}

/** Whether a key a browser sent back is one this tool could have made — and which kind. */
export function isSplatKey(key: string): SplatKind | null {
  const m = /^(masters|scenes)\/([^/]+)\/([^/]+)$/.exec(key);
  if (!m || !isSceneId(m[2]) || !FILE_RE.test(m[3])) return null;
  const kind = kindOfFile(m[3]);
  const want: SplatKind = m[1] === "masters" ? "master" : "web";
  return kind === want ? kind : null;
}

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[extensionOf(name)] ?? "application/octet-stream";
}

/**
 * How a file of `size` bytes is cut into parts: equal parts of `partSize`
 * (a whole number of MiB), the last one shorter. Null when R2 would refuse it.
 */
export function partPlan(size: number): { partSize: number; partCount: number } | null {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_OBJECT) return null;
  const floor = Math.max(PREFERRED_PART, MIN_PART, Math.ceil(size / MAX_PARTS));
  const partSize = Math.ceil(floor / MiB) * MiB;
  return { partSize, partCount: Math.max(1, Math.ceil(size / partSize)) };
}

/** Byte range [start, end) of part `n` (1-based), as the browser slices the file. */
export function partRange(n: number, size: number, partSize: number): [number, number] {
  const start = (n - 1) * partSize;
  return [start, Math.min(size, start + partSize)];
}

/** A scene id guessed from a file name: `Store 01 (final).ply` → `store-01-final`. Empty when nothing usable is left. */
export function sceneIdFromFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return isSceneId(slug) ? slug : "";
}

/**
 * The web copy's file name: the scene id and the moment it was made. A new
 * conversion is a new name, because scene files are cached forever.
 */
export function webFileName(scene: string, at: Date, ext = "spz"): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  return `${scene}-${stamp}.${ext}`;
}
