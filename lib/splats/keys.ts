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
 *   masters/<scene>/<file>.mov      a phone video of the place (iPhone: HEVC
 *                                   .mov), kept privately to train a splat
 *                                   from on a rented GPU (`train.ts`).
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
 * 16 MiB parts: a 2 GB master is 120 of them. Small, because a home upload
 * link drops now and then and a dropped part is sent again from its start
 * (64 MiB parts made each drop cost minutes on a slow link).
 */
const PREFERRED_PART = 16 * MiB;
/** R2's own ceiling for one object. */
const MAX_OBJECT = 5 * 1024 * 1024 * MiB - 5 * MiB;

/**
 * What the viewers load: splats for `/vca/splat` (Spark: SPZ, PlayCanvas SOG,
 * mkkellogg KSPLAT, antimatter15 SPLAT, Spark RAD), and a 360° walk video
 * (equirectangular MP4) for `/vca/walk`.
 */
const WEB_EXTENSIONS = ["spz", "sog", "ksplat", "splat", "rad", "mp4"] as const;

const CONTENT_TYPES: Record<string, string> = {
  ply: "application/octet-stream",
  spz: "application/octet-stream",
  sog: "application/zip",
  ksplat: "application/octet-stream",
  splat: "application/octet-stream",
  rad: "application/octet-stream",
  mp4: "video/mp4",
  mov: "video/quicktime",
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

/**
 * A `.ply` is a master; so is a phone video (`.mov`, to train from — private,
 * never served); a web format is a scene file; anything else is refused.
 */
export function kindOfFile(name: string): SplatKind | null {
  const ext = extensionOf(name);
  if (ext === "ply" || ext === "mov") return "master";
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

/** A 360° walk video (for `/vca/walk`) rather than a splat. */
export function isWalkVideo(name: string): boolean {
  return extensionOf(name) === "mp4";
}

/** A phone video a splat can be trained from (`train.ts`): .mp4 (also a walk video) or .mov. */
export function isTrainVideo(name: string): boolean {
  const ext = extensionOf(name);
  return ext === "mp4" || ext === "mov";
}

// ── A replaced sign's image (founder, 2026-10-08) ─────────────────────────

/**
 * A NEW SIGN'S IMAGE, NOT A SPLAT. The shop's sign or logo (PNG, JPEG or
 * WebP), uploaded from the viewer's edit mode («Replace a sign») to
 * `scenes/<scene>/signs/<sign>-<stamp>.<ext>` — its own folder, its own
 * rule: `isSplatKey` still refuses it, so nothing else can be sent there.
 * A new image is a new name (the stamp): every file is cached forever.
 */
export const SIGN_IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type SignImageType = keyof typeof SIGN_IMAGE_TYPES;
/** Plenty for a sharp sign (a 4000-pixel PNG); a photo straight from a phone is bigger only rarely. */
export const MAX_SIGN_IMAGE_BYTES = 12 * MiB;

const SIGN_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SIGN_KEY_RE = /^scenes\/([^/]+)\/signs\/([a-z0-9][a-z0-9-]{0,39})-(\d{8}-\d{6})\.(png|jpg|webp)$/;

export const isSignImageType = (t: unknown): t is SignImageType =>
  typeof t === "string" && Object.prototype.hasOwnProperty.call(SIGN_IMAGE_TYPES, t);

/** The key a sign's image is uploaded under, or null when the scene, sign or type is not acceptable. */
export function signImageKey(scene: string, sign: string, type: string, at: Date): string | null {
  if (!isSceneId(scene) || !SIGN_ID_RE.test(sign) || !isSignImageType(type)) return null;
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `scenes/${scene}/signs/${sign}-${stamp}.${SIGN_IMAGE_TYPES[type]}`;
}

/** Whether a key a browser sent back is a sign image this tool could have made — and its type. */
export function isSignImageKey(key: string): SignImageType | null {
  const m = SIGN_KEY_RE.exec(key);
  if (!m || !isSceneId(m[1]) || !SIGN_ID_RE.test(m[2])) return null;
  return (Object.keys(SIGN_IMAGE_TYPES) as SignImageType[]).find((t) => SIGN_IMAGE_TYPES[t] === m[4]) ?? null;
}

/** What the bytes really are (their first bytes), whatever the name or the browser says. */
export function imageTypeOf(b: Uint8Array): SignImageType | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}
