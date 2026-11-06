// THE STORE'S INSTAGRAM REEL (owner, 2026-11-06: the Instagram pathway, "lets do that for saraye-bamdad"). Made on our
// server from the store's 360° walk (free, ffmpeg only): `planReel` picks where it starts (inside the door), which
// way it looks (the shelf side with the most products, never the camera operator) and how long; this cuts that
// stretch out of the walk as an ordinary vertical view, 1080 × 1920, 30 fps, no sound (Instagram's own licensed music
// is added when posting: an uploaded track can be muted by Instagram, and its music brings reach). Kept as a private
// video (`isPrivateVideoKey`), downloaded through `/api/media/<key>`. One at a time per server.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, readMastersText, readWalks, uploadFile, writeMastersJson } from "@/lib/splats/r2";
import { mediaPath } from "@/lib/splats/media";
import { entryOf, hideAt } from "@/lib/splats/walks";
import { probe, run, v360Yaw } from "./media";
import { planReel, type ReelPlan } from "./reelRules";

export type ReelMeta = { walk: string; key: string | null; made: string; state: "making" | "done" | "failed"; plan?: ReelPlan; error?: string };
const metaKey = (slug: string) => `stores/${slug}/reel.json`;
let busy: string | null = null;

export async function readReel(slug: string): Promise<(ReelMeta & { src: string | null }) | null> {
  try {
    const t = await readMastersText(metaKey(slug));
    if (!t) return null;
    const m = JSON.parse(t) as ReelMeta;
    // A "making" left by a server that restarted mid-way is not still being made.
    if (m.state === "making" && busy !== slug && Date.now() - Date.parse(m.made) > 20 * 60_000) return { ...m, state: "failed", error: "Stopped when the server restarted. Make it again.", src: null };
    return { ...m, src: m.key ? mediaPath(m.key) : null };
  } catch { return null; }
}

/** Starts making the reel in the background; false when another store's is being made right now. */
export function startReel(slug: string, walkKey: string): boolean {
  if (busy) return false;
  busy = slug;
  void make(slug, walkKey).finally(() => { busy = null; });
  return true;
}

async function make(slug: string, walkKey: string): Promise<void> {
  const made = new Date().toISOString();
  const dir = mkdtempSync(join(tmpdir(), "reel-"));
  await writeMastersJson(metaKey(slug), { walk: walkKey, key: null, made, state: "making" } satisfies ReelMeta).catch(() => undefined);
  try {
    const walk = (await readWalks()).walks[walkKey];
    if (!walk) throw new Error("The store's walk is not in walks.json.");
    if (walk.projection && walk.projection !== "equirect") throw new Error("Only a 360° walk makes a Reel.");
    const src = await presignGet(walkKey, "web", 3600);
    const { seconds: duration } = await probe(src);
    const hide = walk.hide;
    const plan = planReel({
      duration,
      entry: entryOf(walk),
      zoneAt: hide ? (t) => hideAt(hide, t) : null,
      pins: (walk.items ?? []).flatMap((it) => it.pins.map((p) => ({ t: p.t, x: p.x }))),
    });
    if (!plan) throw new Error("No direction inside the store stays clear of the camera operator for 10 seconds.");
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(2);
    const out = join(dir, "reel.mp4");
    const T = plan.seconds;
    await run("ffmpeg", [
      "-v", "error", "-y", "-ss", plan.start.toFixed(2), "-t", String(T), "-i", src,
      "-vf", `v360=input=e:output=flat:yaw=${v360Yaw(plan.yaw).toFixed(2)}:pitch=-3:h_fov=${deg(plan.hfov)}:v_fov=${deg(plan.vfov)}:w=1080:h=1920:interp=lanczos,fps=30,` +
        `unsharp=5:5:0.4,fade=t=in:st=0:d=0.5,fade=t=out:st=${(T - 0.8).toFixed(2)}:d=0.8`,
      "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart", out,
    ]);
    const key = `scenes/store-${slug}/reel-${made.replace(/[-:.TZ]/g, "").slice(0, 14)}.mp4`;
    await uploadFile(key, out, "video/mp4");
    await writeMastersJson(metaKey(slug), { walk: walkKey, key, made, state: "done", plan } satisfies ReelMeta);
  } catch (e) {
    console.error("[reel]", slug, e);
    await writeMastersJson(metaKey(slug), { walk: walkKey, key: null, made, state: "failed", error: (e as Error).message.slice(0, 300) } satisfies ReelMeta).catch(() => undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
