/**
 * THE DEMO WITHOUT INTERNET (founder, 2026-10-18: "where I am going to demo
 * there is no internet, how can I run a local version of olgoo.com/demo").
 *
 * With `OFFLINE_DIR` set, every read that went to R2 reads a folder on this
 * computer instead, laid out as the bucket is (`scenes/walks.json`,
 * `scenes/<scene>/<file>.mp4`, `scenes/catalogues/<store>.json`, `masters/…`),
 * and `/api/offline/<key>` serves its files (with byte ranges, so a video
 * seeks). The folder is filled beforehand, with internet, by
 * `npm run offline:pack` (`scripts/offline-pack.mjs`) from olgoo.com's public
 * addresses — no bucket key is needed or used. Saving is not offered offline.
 *
 * Server only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";

/** The offline folder, or null when this server reads R2. */
export function offlineDir(): string | null {
  const d = (process.env["OFFLINE_DIR"] || "").trim();
  return d ? normalize(d) : null;
}

/** Where `/api/offline/<key>` is: the scenes' address in offline mode. */
export const OFFLINE_BASE = "/api/offline";

/** The file for a bucket key, or null when the key would leave the folder or is not there. */
export function offlinePath(key: string): string | null {
  const dir = offlineDir();
  if (!dir || !key || key.includes("\0")) return null;
  const p = normalize(join(dir, key));
  const rel = relative(dir, p);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) return null;
  return existsSync(p) && statSync(p).isFile() ? p : null;
}

/** A JSON file of the folder, parsed; null when it is not there. */
export function offlineJson(key: string): unknown | null {
  const p = offlinePath(key);
  return p ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Every file in the folder, as bucket keys (`/`-separated), with its size. */
export function offlineKeys(): Array<{ key: string; size: number }> {
  const dir = offlineDir();
  if (!dir || !existsSync(dir)) return [];
  const out: Array<{ key: string; size: number }> = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push({ key: relative(dir, p).split(sep).join("/"), size: statSync(p).size });
    }
  };
  walk(dir);
  return out;
}
