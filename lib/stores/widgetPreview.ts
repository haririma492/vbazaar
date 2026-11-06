// THE WIDGET'S SNEAK PREVIEW OF THE FREE TOUR (owner, 2026-11-06: "on this view on store web site we need to get a
// sneak preview of the free tour (with music - if it has) now is only photos moving").
//
// Made on our server, once a walk (and again when the walk or its music changes): the first PREVIEW_SECONDS of the
// store's walk turned from the 360° picture into an ordinary forward view (ffmpeg v360, 100° wide), 960 × 720, with
// the walk's music 1 under it, faded in and out. The store's site plays this flat clip; the 360° walk itself, the
// tours and the basket stay on vbazaar.app (the moat). The clip is a private video like every walk
// (`isPrivateVideoKey`), played through `/api/media/<key>`.
//
// Free (ffmpeg only). One clip at a time per server; a failure is kept with its reason, and the widget falls back to
// the Shelf Tour or the photos until the next try.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, readMastersText, readWalks, uploadFile, webObjectExists, writeMastersJson } from "@/lib/splats/r2";
import { mediaPath } from "@/lib/splats/media";
import { musicOf, phoneKeyOf } from "@/lib/splats/walks";
import { run } from "./media";
import { PREVIEW_SECONDS } from "./widgetRules";

export type PreviewMeta = { walk: string; music: string | null; key: string | null; made: string; error?: string };
const metaKey = (slug: string) => `stores/${slug}/widget-preview.json`;
let busy: string | null = null;
const RETRY_MS = 30 * 60_000;

export async function readPreview(slug: string): Promise<PreviewMeta | null> {
  try { const t = await readMastersText(metaKey(slug)); return t ? (JSON.parse(t) as PreviewMeta) : null; } catch { return null; }
}

/**
 * The preview clip for this walk and music, as a playable address, or null while it is being made (or cannot be).
 * Starts making it in the background when it is missing or out of date.
 */
export async function previewFor(slug: string, walkKey: string | null): Promise<{ src: string; sound: boolean } | null> {
  if (!walkKey) return null;
  const walk = (await readWalks().catch(() => null))?.walks[walkKey];
  if (walk?.projection && walk.projection !== "equirect") return null; // only a 360° walk makes this preview
  const music = musicOf(walk)[0] ?? null;
  const meta = await readPreview(slug);
  if (meta && meta.walk === walkKey && meta.music === music) {
    if (meta.key) return { src: mediaPath(meta.key), sound: Boolean(music) };
    if (Date.now() - Date.parse(meta.made) < RETRY_MS) return null; // failed recently: not tried on every view
  }
  if (!busy) void make(slug, walkKey, music);
  return meta?.key && meta.walk === walkKey ? { src: mediaPath(meta.key), sound: Boolean(meta.music) } : null;
}

async function make(slug: string, walkKey: string, music: string | null): Promise<void> {
  busy = slug;
  const dir = mkdtempSync(join(tmpdir(), "wprev-"));
  const made = new Date().toISOString();
  try {
    const phone = phoneKeyOf(walkKey);
    const src = await presignGet((await webObjectExists(phone)) ? phone : walkKey, "web", 3600);
    const out = join(dir, "preview.mp4");
    const T = PREVIEW_SECONDS;
    const args = ["-v", "error", "-y", "-t", String(T), "-i", src];
    if (music) args.push("-t", String(T), "-i", await presignGet(music, "web", 3600));
    args.push(
      "-vf", `v360=input=e:output=flat:h_fov=100:v_fov=84:pitch=-4,scale=960:720,fps=25,fade=t=in:st=0:d=0.6,fade=t=out:st=${T - 1}:d=1`,
      "-map", "0:v:0",
      ...(music ? ["-map", "1:a:0", "-af", `afade=t=in:st=0:d=1,afade=t=out:st=${T - 1.5}:d=1.5`, "-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", String(T), out,
    );
    await run("ffmpeg", args);
    const key = `scenes/store-${slug}/widget-preview-${made.replace(/[-:.TZ]/g, "").slice(0, 14)}.mp4`;
    await uploadFile(key, out, "video/mp4");
    await writeMastersJson(metaKey(slug), { walk: walkKey, music, key, made } satisfies PreviewMeta);
  } catch (e) {
    console.error("[widget] preview", slug, e);
    await writeMastersJson(metaKey(slug), { walk: walkKey, music, key: null, made, error: (e as Error).message.slice(0, 300) } satisfies PreviewMeta).catch(() => undefined);
  } finally {
    busy = null;
    rmSync(dir, { recursive: true, force: true });
  }
}
