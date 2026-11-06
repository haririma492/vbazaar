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
import { readJob, setJob } from "./jobState";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, presignGet, readMastersText, readWalks, webObjectExists, writeMastersJson, writeWalks } from "@/lib/splats/r2";
import { phoneKeyOf, type WalkHide } from "@/lib/splats/walks";
import { ZONE_H, ZONE_W, columnHistograms, zoneThroughWalk, type ZoneLock } from "@/lib/splats/trackZone";
import { probe, run } from "./media";
import { findPhotographer, type Purse } from "./ai";
import { downForHead, dropStrays, isUnderCamera, seedTimes, type Seen } from "./lockRules";
import { PACE_FPS, VIEW_FOV, VIEW_H, VIEW_PITCH, VIEW_W, VIEW_YAWS, frameShift, groundMove, paceOf } from "@/lib/splats/pace";

/** Frames a second the zone is followed at (fewer on a long walk: at most `MAX_FRAMES`). */
const FPS = 3;
const MAX_FRAMES = 900;
/** When Claude looks for the operator: `seedTimes` in `lockRules.ts` (every ~8 s). The frame it is shown. */
const SEED_W = 1024, SEED_H = 512;
/** Degrees added round the person Claude boxed (a little of them always spills). */
const MARGIN = 18; // 12 left an arm or a shoulder showing at the edge
/** Half the view's height on a phone held upright or a computer (the camera's 75°). */
const HALF_VFOV = 37.5;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * The lock agent's run on a walk: the operator locked out of view, then the
 * photographer's walking speed measured (`measurePace`), so Slow and Fast are
 * the same speed on every walk. The pace is measured even when nobody was
 * found to lock; a failure there never undoes the lock.
 */
export async function autoLock(walkKey: string, purse: Purse, say: (note: string) => Promise<void>): Promise<string> {
  const locked = await lockOperator(walkKey, purse, say);
  let paced: string;
  try {
    paced = await measurePace(walkKey, say);
  } catch (e) {
    paced = `Walking speed not measured (${e instanceof Error ? e.message : String(e)}).`;
  }
  return `${locked} ${paced}`;
}

/**
 * Walks still to measure, kept in the masters bucket so a restart (every push
 * to main redeploys) does not lose the list: each is taken off as it is done,
 * measured or not, and the server carries on with the rest when it starts.
 */
const PACE_PENDING = "pace/pending.json";
let pacing = false;
/** For `/operator/agents`: the walks waiting to be measured, and whether one is being measured now. */
export async function paceStatus(): Promise<{ busy: boolean; waiting: string[]; current?: string }> {
  const j = await readJob("pace");
  return { busy: Boolean(j?.busy && Date.now() - Date.parse(j.at) < 6 * 3600_000), waiting: await readPending(), ...(j?.key ? { current: j.key } : {}) };
}
export async function queuePace(keys: string[]): Promise<void> {
  const old = await readPending();
  await writeMastersJson(PACE_PENDING, [...new Set([...old, ...keys])]);
  void drainPace();
}
async function readPending(): Promise<string[]> {
  try { const t = await readMastersText(PACE_PENDING); const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; } catch { return []; }
}
/** Measure the queued walks one by one (also called when the server starts). */
export async function drainPace(): Promise<void> {
  if (pacing) return;
  pacing = true;
  try {
    for (;;) {
      const [key, ...rest] = await readPending();
      if (!key) return;
      await setJob("pace", { busy: true, key });
      try { console.log("[pace]", key, await measurePace(key, async () => {})); } catch (e) { console.error("[pace]", key, e); }
      await setJob("pace", { busy: false, key: null });
      await writeMastersJson(PACE_PENDING, rest);
    }
  } finally {
    pacing = false;
  }
}

/** Pairs of frames measured at most (spread over the walk). */
const PACE_PAIRS = 240;

/**
 * How fast the photographer walked (m/s), read off the floor in four views 45°
 * down (`lib/splats/pace.ts`), written as `Walk.pace`. No AI, nothing spent.
 */
export async function measurePace(walkKey: string, say: (note: string) => Promise<void>): Promise<string> {
  const before = (await readWalks()).walks[walkKey];
  if (!before) return "";
  if (before.projection === "flat" || before.projection === "eac") return "";
  const src = (await webObjectExists(phoneKeyOf(walkKey))) ? await presignGet(phoneKeyOf(walkKey), "web", 3600) : await presignGet(walkKey, "web", 3600);
  await say("Measuring how fast the walk was filmed…");
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(2);
  const views = VIEW_YAWS.map((y, i) => `[s${i}]v360=e:flat:yaw=${y}:pitch=-${deg(VIEW_PITCH)}:h_fov=${deg(VIEW_FOV)}:v_fov=${deg((VIEW_FOV * VIEW_H) / VIEW_W)}:w=${VIEW_W}:h=${VIEW_H},format=gray[v${i}]`).join(";");
  // Shrunk first (the views are 160 px) and at most the first 3 minutes: an 8K walk read whole took too long.
  const graph = `[0:v]fps=${PACE_FPS},scale=1920:960,split=${VIEW_YAWS.length}${VIEW_YAWS.map((_, i) => `[s${i}]`).join("")};${views};${VIEW_YAWS.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${VIEW_YAWS.length}`;
  const raw = await run("ffmpeg", ["-v", "error", "-t", "180", "-i", src, "-filter_complex", graph, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
  const W = VIEW_W * VIEW_YAWS.length, size = W * VIEW_H;
  const n = Math.floor(raw.length / size);
  if (n < 12) return "Walking speed not measured: the walk is too short.";
  const viewOf = (f: number, i: number) => {
    const out = new Uint8Array(VIEW_W * VIEW_H);
    for (let y = 0; y < VIEW_H; y++) out.set(raw.subarray(f * size + y * W + i * VIEW_W, f * size + y * W + (i + 1) * VIEW_W), y * VIEW_W);
    return out;
  };
  const every = Math.max(1, Math.floor((n - 1) / PACE_PAIRS));
  const pairs: { move: number; score: number }[][] = [];
  for (let f = 0; f + 1 < n; f += every) {
    pairs.push(VIEW_YAWS.map((_, i) => {
      const s = frameShift(viewOf(f, i), viewOf(f + 1, i), VIEW_W, VIEW_H);
      return { move: groundMove(s.dx, s.dy), score: s.score };
    }));
  }
  const pace = paceOf(pairs, 1 / PACE_FPS);
  if (pace === null) return "Walking speed not measured (the floor gave too little to go on): Slow and Fast use the old speeds on this walk.";
  const walks = await readWalks();
  const w = walks.walks[walkKey];
  if (!w) return "";
  await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, pace } } }, walks);
  return `Filmed at ${pace.toFixed(2)} m/s: Slow and Fast now play at the standard speeds.`;
}

async function lockOperator(walkKey: string, purse: Purse, say: (note: string) => Promise<void>): Promise<string> {
  const before = (await readWalks()).walks[walkKey];
  if (!before) return "No walk to lock.";
  if (before.projection === "flat" || before.projection === "eac") return "Not a 360° panorama: nothing to lock.";
  // Locks set by hand are kept and become the starting points: the agent
  // follows the operator from them through every frame (no looking needed).
  const handLocks: ZoneLock[] | null = before.hide && !before.hide.auto
    ? (before.hide.locks?.length ? before.hide.locks : (before.hide.at ?? []).slice(0, 50).map((p) => ({ t: p.t, yaw: p.yaw, width: p.width ?? before.hide!.width })))
    : null;
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  try {
    // The phone copy, downloaded; a walk without one (made before phone copies)
    // is read straight from the bucket, only the frames needed.
    let src = join(dir, "phone.mp4");
    if (await webObjectExists(phoneKeyOf(walkKey))) {
      await say("Downloading the walk…");
      await downloadToFile(phoneKeyOf(walkKey), src, "web");
    } else {
      src = await presignGet(walkKey, "web", 6 * 3600);
    }
    const { seconds } = await probe(src);
    const fps = Math.min(FPS, MAX_FRAMES / Math.max(1, seconds));
    const dt = 1 / fps;

    await say(handLocks ? "Starting from the locks set by hand…" : "Looking for the person carrying the camera…");
    const locks: ZoneLock[] = handLocks ? [...handLocks] : [];
    let armsLat = -90;
    const seen: Seen[] = [];
    const times = handLocks ? [] : seedTimes(seconds);
    if (times.length) await say(`Looking for them at ${times.length} moments…`);
    for (const t0 of times) {
      const t = Math.min(seconds - 0.1, Math.max(0, t0));
      // The operator is usually BEHIND the camera, i.e. split across the panorama's left and right edges, which
      // is where Claude most often missed them. So the frame is first turned half round (the edges meet in the
      // middle; 180° is its own inverse, so a direction read there is just +180°), and the plain frame only if
      // that finds nobody.
      let p: Awaited<ReturnType<typeof findPhotographer>> | null = null;
      let turn = 0;
      for (const yaw of [180, 0]) {
        const vf = yaw ? `v360=e:e:yaw=${yaw},scale=${SEED_W}:${SEED_H}` : `scale=${SEED_W}:${SEED_H}`;
        const jpeg = new Uint8Array(await run("ffmpeg", [
          "-v", "error", "-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", vf, "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
        ]));
        const q = await findPhotographer(purse, jpeg, SEED_W, SEED_H);
        if (q.found) { p = q; turn = yaw; break; }
      }
      if (!p) continue;
      const d1 = (p.x1 / SEED_W) * 360 - 180 + turn, d2 = (p.x2 / SEED_W) * 360 - 180 + turn;
      const n1 = ((d1 + 540) % 360) - 180, n2 = ((d2 + 540) % 360) - 180;
      const span = n1 <= n2 ? n2 - n1 : 360 - (n1 - n2);
      seen.push({ span, headLat: 90 - (Math.min(SEED_H, Math.max(0, p.headY)) / SEED_H) * 180 });
      if (span < 5 || span > 300) continue;
      const mid = n1 + span / 2;
      const width = Math.min(330, span + 2 * MARGIN);
      locks.push({ t: Math.round(t * 100) / 100, yaw: rad(((mid + 540) % 360) - 180), width: rad(width) });
      if (p.armsY < SEED_H) armsLat = Math.max(armsLat, 90 - (p.armsY / SEED_H) * 180);
    }
    // The camera held just over the head: the head fills the bottom of the
    // picture all the way round, so a slice of directions cannot hide it.
    // Only how far down shoppers may look can (`lockRules.ts`).
    if (!handLocks && isUnderCamera(seen)) {
      const downDeg = downForHead(seen, HALF_VFOV);
      const walks = await readWalks();
      const w = walks.walks[walkKey];
      if (!w) return "The walk is gone.";
      if (w.hide && !w.hide.auto) return "Kept the locks set by hand meanwhile.";
      const { hide: _old, ...rest } = w;
      await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...rest, tilt: { up: rad(45), down: rad(downDeg) } } } }, walks);
      return `The camera was held over the operator's head: shoppers look down to ${downDeg}° (the head stays out of view) and up to 45°; no directions blocked.`;
    }
    if (!handLocks) dropStrays(locks);
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

    const hide: WalkHide = { yaw: locks[0].yaw, width: locks[0].width, top: 0, locks, at, ...(handLocks ? {} : { auto: true }) };
    const walks = await readWalks();
    const w = walks.walks[walkKey];
    if (!w) return "The walk is gone.";
    if (w.hide && !w.hide.auto && !handLocks) return "Kept the locks set by hand meanwhile.";
    if (handLocks && JSON.stringify(w.hide?.locks ?? null) !== JSON.stringify(before.hide?.locks ?? null)) return "The locks were changed by hand meanwhile: run again.";
    await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, hide, tilt: !w.tilt || w.hide?.auto ? tilt : w.tilt } } }, walks);
    const from = handLocks ? `from your ${locks.length} locks` : `found by eye at ${locks.length} moments`;
    return `Locked the camera operator in all ${at.length} frames (${from}); shoppers look down to ${Math.round(w.tilt && !w.hide?.auto && handLocks ? (w.tilt.down ?? rad(down)) * 180 / Math.PI : down)}° and up to 45°.`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

