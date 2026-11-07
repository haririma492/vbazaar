/**
 * The signed R2 address of a private walk video, for a `<video>` that is drawn
 * into WebGL (the 360° sphere, its reversed copy).
 *
 * ⚠️ WHY NOT JUST `/api/media/<key>`: that route answers with a 302 to another
 * origin (the R2 bucket), and iOS Safari does not carry CORS across a
 * cross-origin MEDIA redirect — the video plays but is "tainted", WebGL refuses
 * it, and the Free Tour was a black sphere on every iPhone (2026-11-07). Given
 * the signed link directly, the bucket's own CORS applies and it draws.
 *
 * The link is the same one the redirect handed out (it expires, the video stays
 * private). On any failure the route's path is returned, so nothing is worse
 * than before.
 */
const links = new Map<string, Promise<string>>();

export function directMediaUrl(path: string): Promise<string> {
  if (typeof path !== "string" || !path.startsWith("/api/media/")) return Promise.resolve(path);
  const bare = path.split(/[?#]/)[0];
  let p = links.get(bare);
  if (!p) {
    p = fetch(`${bare}?link=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.ok && typeof j.url === "string" && /^https:\/\//.test(j.url) ? (j.url as string) : path))
      .catch(() => path);
    links.set(bare, p);
    // The server signs for 6 h and reuses a link for 1 h: forget ours well inside that.
    setTimeout(() => links.delete(bare), 50 * 60 * 1000);
  }
  return p;
}
