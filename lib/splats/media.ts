/**
 * THE WALK VIDEOS ARE PRIVATE (owner, 2026-11-06: "how can we make sure that
 * the mp4 files … cannot be downloaded by anyone?" — then "everyone should be
 * able to watch").
 *
 * Every video under `scenes/` (a store's walk, its `-phone.mp4` and
 * `-reverse.mp4` copies, a Shelf tour, a route preview, a cut walk's
 * `.original`) lives in the PRIVATE masters bucket, and the player reaches it
 * through `/api/media/<key>`, which hands each visitor a link that expires
 * (`app/api/media/[...key]/route.ts`). Nothing has a permanent public address,
 * so a link shared or saved stops working within hours. Watching needs no
 * sign-in.
 *
 * ⚠️ What this cannot do: a video a browser plays can be screen-recorded, and
 * DRM would break the walk (a protected video cannot be drawn into WebGL).
 *
 * Pure: the server (`r2.ts`) and the player both read these rules.
 */

/** A video kept privately: under `scenes/`, an .mp4/.mov/.m4v/.webm (also its `.original` or `.before-…` backup). */
export function isPrivateVideoKey(key: string): boolean {
  return /^scenes\//.test(key) && /\.(mp4|mov|m4v|webm)(?=$|\.)/i.test(key);
}

/** A key the public route will sign: a private video, no `..`, no backups (operator-only), nothing odd. */
export function isServableVideoKey(key: string): boolean {
  return isPrivateVideoKey(key)
    && /\.(mp4|mov|m4v|webm)$/i.test(key)
    && !key.split("/").some((p) => p === "" || p === "." || p === "..")
    && /^[A-Za-z0-9._\/-]{1,300}$/.test(key);
}

/** Where the player asks for a private video. Relative: it is always this site. */
export const mediaPath = (key: string) => `/api/media/${key}`;

/**
 * An address saved before the videos went private (`https://pub-….r2.dev/scenes/…/x.mp4?r=2`)
 * becomes the route's (`/api/media/scenes/…/x.mp4?r=2`). Anything else is returned unchanged.
 */
export function toMediaUrl(url: string): string {
  if (typeof url !== "string" || url.startsWith("/api/media/")) return url;
  const m = /^https?:\/\/[^/]+\/(scenes\/[^?#]+)([?#].*)?$/.exec(url);
  if (!m || !isPrivateVideoKey(m[1])) return url;
  return mediaPath(m[1]) + (m[2] ?? "");
}
