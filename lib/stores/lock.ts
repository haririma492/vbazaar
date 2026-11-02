// THE LOCK AGENT (owner, 2026-11-02: "we need an agent to automate the locking
// angle in 1) both horizontal and vertical place and 2) in all frames … me (the
// photographer's angle should be locked) all the way autonomously").
//
// For a walk made from a 360° video, with nobody pressing anything:
//   1. Claude finds the person carrying the camera in a few frames spread over
//      the walk (`findPhotographer`): their left and right edges, the top of
//      their head, and their arms reaching round the camera.
//   2. From those, they are followed through every frame by their colours
//      (`lib/splats/trackZone.ts`), so the locked zone moves with them.
//   3. Up and down: shoppers may not tilt the view so far down that the
//      operator's arms come on screen, nor up into the ceiling.
// It writes `Walk.hide` (marked `auto`) and `Walk.tilt`. Locks an operator set
// by hand are kept: the agent then only adds what is missing.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, readWalks, writeWalks } from "@/lib/splats/r2";
import { phoneKeyOf, type WalkHide } from "@/lib/splats/walks";
import { ZONE_H, ZONE_W, columnHistograms, zoneThroughWalk, type ZoneLock } from "@/lib/splats/trackZone";
import { probe, run } from "./media";
import { findPhotographer, type Purse } from "./ai";

/** Frames a second the zone is followed at (fewer on a long walk: at most `MAX_FRAMES`). */
const FPS = 3;
const MAX_FRAMES = 900;
/** The moments Claude looks for the operator, as fractions of the walk. */
const SEEDS = [0.06, 0.25, 0.45, 0.65, 0.85, 0.97];
const SEED_W = 1024, SEED_H = 512;
/** Degrees added round the person Claude boxed (a little of them always spills). */
const MARGIN = 12;
/** Half the view's height on a phone held upright or a computer (the camera's 75°). */
const HALF_VFOV = 37.5;
const rad = (d: number) => (d * Math.PI) / 180;

export async function autoLock(walkKey: string, purse: Purse, say: (note: string) => Promise<void>): Promise<string> {
  const before = (await readWalks()).walks[walkKey];
  if (!before) return "No walk to lock.";
  if (before.projection === "flat" || before.projection === "eac") return "Not a 360° panorama: nothing to lock.";
  if (before.hide && !before.hide.auto) return "Kept the locks set by hand.";
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  try {
    const src = join(dir, "phone.mp4");
    await say("Downloading the walk…");
    await downloadToFile(phoneKeyOf(walkKey), src, "web");
    const { seconds } = await probe(src);
    const fps = Math.min(FPS, MAX_FRAMES / Math.max(1, seconds));
    const dt = 1 / fps;

    await say("Looking for the person carrying the camera…");
    const locks: ZoneLock[] = [];
    let armsLat = -90;
    for (const f of SEEDS) {
      const t = Math.min(seconds - 0.1, Math.max(0, f * seconds));
      const jpeg = new Uint8Array(await run("ffmpeg", [
        "-v", "error", "-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", `scale=${SEED_W}:${SEED_H}`, "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
      ]));
      const p = await findPhotographer(purse, jpeg, SEED_W, SEED_H);
      if (!p.found) continue;
      const d1 = (p.x1 / SEED_W) * 360 - 180, d2 = (p.x2 / SEED_W) * 360 - 180;
      const span = d1 <= d2 ? d2 - d1 : 360 - (d1 - d2);
      if (span < 5 || span > 300) continue;
      const mid = d1 + span / 2;
      const width = Math.min(330, span + 2 * MARGIN);
      locks.push({ t: Math.round(t * 100) / 100, yaw: rad(((mid + 540) % 360) - 180), width: rad(width) });
      if (p.armsY < SEED_H) armsLat = Math.max(armsLat, 90 - (p.armsY / SEED_H) * 180);
    }
    if (!locks.length) return "Could not find the person carrying the camera: nothing locked.";

    await say(`Following them through the walk (${Math.round(seconds * fps)} frames)…`);
    const raw = await run("ffmpeg", ["-v", "error", "-i", src, "-vf", `fps=${fps.toFixed(4)},scale=${ZONE_W}:${ZONE_H}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
    const size = ZONE_W * ZONE_H * 3;
    const frames: Float32Array[] = [];
    for (let at = 0; at + size <= raw.length; at += size) frames.push(columnHistograms(raw.subarray(at, at + size), 3));
    const at = zoneThroughWalk(frames, dt, locks);

    // Down: the view's middle stays high enough that the screen's bottom edge
    // is above the operator's arms; up: no further than the ceiling's edge.
    // Never above −25°: shoppers must still look down into a cabinet or onto a counter.
    const down = armsLat > -90 ? Math.min(-25, Math.max(-40, armsLat + HALF_VFOV + 5)) : -35;
    const tilt = { up: rad(45), down: rad(down) };

    const hide: WalkHide = { yaw: locks[0].yaw, width: locks[0].width, top: 0, locks, at, auto: true };
    const walks = await readWalks();
    const w = walks.walks[walkKey];
    if (!w) return "The walk is gone.";
    if (w.hide && !w.hide.auto) return "Kept the locks set by hand meanwhile.";
    await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, hide, tilt: !w.tilt || w.hide?.auto ? tilt : w.tilt } } }, walks);
    return `Locked the camera operator in all ${at.length} frames (found by eye at ${locks.length} moments); shoppers look down to ${Math.round(down)}° and up to 45°.`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
