// THE REVERSED COPY (owner, 2026-11-03: "the movement (slow and fast) along
// with user moving the video bar … gets stuck"; "yes" to the fix). A video
// only plays forwards, so «Back» used to be a stream of small seeks, and every
// seek in a heavy 360° video stalled. Each walk now gets
// `<name>-reverse.mp4`: the phone copy played backwards, 2880×1440, keyframe
// every 10 frames. Back PLAYS it, as smooth as walking on (Walk360.tsx).
//
// Made in 1-second pieces (each reversed alone, so memory stays small) and
// joined in the opposite order. Walks waiting for theirs are kept in the
// masters bucket, so a restart (every push to main redeploys) carries on.
// Server only.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGetAny, readMastersText, readWalks, uploadFile, webObjectExists, writeMastersJson } from "@/lib/splats/r2";
import { phoneKeyOf, reverseKeyOf } from "@/lib/splats/walks";
import { probe, run } from "./media";

/** The reversed copy of a video file: 1-second pieces, each reversed, joined last-first. */
export async function reverseVideo(input: string, output: string, seconds: number, dir: string): Promise<void> {
  // ⚠️ EXACTLY ONE SECOND'S FRAMES PER PIECE (2026-11-03): cut by time alone
  // each piece took a frame extra, and area-outside's reversed copy came out
  // 1.7 s longer than the walk — so Back would not use it (the player checks
  // the two agree). Each piece now holds exactly `fps` frames, re-timed from 0.
  const fpsText = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate", "-of", "csv=p=0", input])).toString().trim();
  const [num, den] = fpsText.split("/").map(Number);
  const fps = num > 0 && den > 0 ? num / den : 25;
  const perPiece = Math.max(1, Math.round(fps));
  const pieces: string[] = [];
  for (let i = 0; i * 1 < seconds; i++) {
    const out = join(dir, `r${String(i).padStart(5, "0")}.mp4`);
    await run("ffmpeg", [
      "-v", "error", "-y", "-ss", String(i), "-t", "1.2", "-i", input,
      "-vf", `trim=end_frame=${perPiece},scale=2880:1440:flags=bicubic,reverse,setpts=N/(${fps}*TB)`, "-r", String(fps), "-threads", "2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-g", "10", "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-an", out,
    ]);
    pieces.push(out);
  }
  const list = join(dir, "list.txt");
  writeFileSync(list, pieces.reverse().map((p) => `file '${p}'`).join("\n"));
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output]);
}

/** Make (again) the reversed copy of one walk, from its phone copy (or the walk itself). */
export async function makeReverse(walkKey: string): Promise<string> {
  const walk = (await readWalks()).walks[walkKey];
  if (!walk) return "No such walk.";
  if (walk.projection === "flat") return "A flat video: no reversed copy needed.";
  const from = (await webObjectExists(phoneKeyOf(walkKey))) ? phoneKeyOf(walkKey) : walkKey;
  const src = await presignGetAny(from, 6 * 3600);
  const { seconds } = await probe(src);
  if (!seconds) return "The walk's video could not be read.";
  const dir = mkdtempSync(join(tmpdir(), "reverse-"));
  try {
    const out = join(dir, "reverse.mp4");
    await reverseVideo(src, out, seconds, dir);
    await uploadFile(reverseKeyOf(walkKey), out, "video/mp4");
    return `Reversed copy made (${Math.round(seconds)} s): Back now plays it.`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PENDING = "reverse/pending.json";
let draining = false;
/** For `/operator/agents`: the walks waiting for their reversed copy, and whether one is being made now. */
export async function reverseStatus(): Promise<{ busy: boolean; waiting: string[] }> {
  return { busy: draining, waiting: await readPending() };
}
async function readPending(): Promise<string[]> {
  try { const t = await readMastersText(PENDING); const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; } catch { return []; }
}
/** Queue walks for a (new) reversed copy; the queue lives in the bucket and drains in the background. */
export async function queueReverse(keys: string[]): Promise<void> {
  const old = await readPending();
  await writeMastersJson(PENDING, [...new Set([...old, ...keys])]);
  void drainReverse();
}
/** Make the queued reversed copies one by one (also called when the server starts). */
export async function drainReverse(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const [key, ...rest] = await readPending();
      if (!key) return;
      try { console.log("[reverse]", key, await makeReverse(key)); } catch (e) { console.error("[reverse]", key, e); }
      await writeMastersJson(PENDING, rest);
    }
  } finally {
    draining = false;
  }
}
