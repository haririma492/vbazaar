/**
 * The crew's hands on video and pictures: ffmpeg and ffprobe, in the server's
 * image (`Dockerfile`). Server only.
 *
 *   probe        a video's size, length and codec
 *   encode       the walk's web copy and its 4K phone copy: H.264, a
 *                keyframe every 10 frames (walking BACK stays smooth), no
 *                sound, playable while it downloads (scripts/splats/walk-video.md)
 *   views        normal camera views cut out of one moment of a 360° walk
 *                (ffmpeg's v360, which turns the same way as the walk:
 *                yaw + right, pitch + up — checked against `viewDir`)
 *   grayFrames   the walk as small grey panoramas, for following a product
 *                from frame to frame (`lib/splats/track.ts`)
 *   jpegOf       any picture as a JPEG of at most `max` px a side
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function run(bin: string, args: string[], opts: { input?: Uint8Array; onLine?: (line: string) => void } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let tail = "";
    p.stdout.on("data", (b: Buffer) => {
      out.push(b);
      if (opts.onLine) for (const line of b.toString().split("\n")) if (line.trim()) opts.onLine(line.trim());
    });
    p.stderr.on("data", (b: Buffer) => { tail = (tail + b.toString()).slice(-1500); });
    p.on("error", (e) => reject(new Error(`${bin} is not on this server (${e.message})`)));
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${bin} stopped (${code}): ${tail.trim().split("\n").slice(-2).join(" ")}`))));
    if (opts.input) p.stdin.end(Buffer.from(opts.input));
    else p.stdin.end();
  });
}

export type Probe = { width: number; height: number; seconds: number; codec: string };

export async function probe(path: string): Promise<Probe> {
  const out = JSON.parse((await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", path])).toString());
  const s = out.streams?.[0] ?? {};
  return { width: Number(s.width) || 0, height: Number(s.height) || 0, seconds: Number(out.format?.duration) || 0, codec: String(s.codec_name ?? "") };
}

/** One H.264 copy of a walk, at most `width` across, with ffmpeg's progress as 0–100. */
export function encode(input: string, output: string, width: number, crf: number, seconds: number, onPercent: (p: number) => void): Promise<Buffer> {
  return run("ffmpeg", [
    "-v", "error", "-y", "-i", input,
    "-vf", `scale='min(${width},iw)':-2:flags=lanczos`,
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-g", "10", "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-an", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", output,
  ], {
    onLine: (line) => {
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m && seconds > 0) onPercent(Math.min(99, Math.round((Number(m[1]) / 1e6 / seconds) * 100)));
    },
  });
}

/**
 * A heading (radians, any value) as the yaw ffmpeg's v360 accepts: degrees in −180…180.
 * v360 refuses anything outside that range, and a heading of 240° stopped the Tagger with
 * "Error initializing complex filters. Numerical result out of range".
 */
export const v360Yaw = (r: number) => ((((r * 180) / Math.PI) % 360) + 540) % 360 - 180;

/** Normal camera views (`n`×`n`, JPEG) of the walk at `t` s, one per heading, all at `pitch` with `fov` (radians). */
export async function views(input: string, t: number, yaws: number[], pitch: number, fov: number, n: number): Promise<Uint8Array[]> {
  const dir = mkdtempSync(join(tmpdir(), "views-"));
  try {
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);
    const split = `[0:v]split=${yaws.length}${yaws.map((_, i) => `[s${i}]`).join("")}`;
    const each = yaws.map((y, i) => `[s${i}]v360=input=e:output=flat:yaw=${v360Yaw(y).toFixed(3)}:pitch=${deg(pitch)}:h_fov=${deg(fov)}:v_fov=${deg(fov)}:w=${n}:h=${n}[o${i}]`);
    await run("ffmpeg", [
      "-v", "error", "-y", "-ss", t.toFixed(2), "-i", input, "-frames:v", "1", "-filter_complex", [split, ...each].join(";"),
      ...yaws.flatMap((_, i) => ["-map", `[o${i}]`, "-frames:v", "1", "-q:v", "3", join(dir, `v${i}.jpg`)]),
    ]);
    return yaws.map((_, i) => new Uint8Array(readFileSync(join(dir, `v${i}.jpg`))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The walk as grey W×W/2 panoramas, `fps` a second (one byte a pixel), from `start` s for `seconds`. */
export async function grayFrames(input: string, fps: number, W: number, start: number, seconds: number): Promise<{ frames: Uint8Array[]; W: number; H: number }> {
  const H = W / 2;
  const raw = await run("ffmpeg", ["-v", "error", "-ss", start.toFixed(2), "-t", seconds.toFixed(2), "-i", input, "-vf", `fps=${fps},scale=${W}:${H},format=gray`, "-f", "rawvideo", "pipe:1"]);
  const frames: Uint8Array[] = [];
  for (let at = 0; at + W * H <= raw.length; at += W * H) frames.push(new Uint8Array(raw.buffer, raw.byteOffset + at, W * H));
  return { frames, W, H };
}

/** A picture (any format ffmpeg reads) as a JPEG, at most `max` px a side. */
export async function jpegOf(bytes: Uint8Array, max: number): Promise<Uint8Array> {
  return new Uint8Array(await run("ffmpeg", [
    "-v", "error", "-i", "pipe:0", "-frames:v", "1",
    "-vf", `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`, "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
  ], { input: bytes }));
}

/** The part of a JPEG inside `box` ([left, top, right, bottom], thousandths), with a little margin, as a JPEG. */
export async function cropJpeg(bytes: Uint8Array, box: [number, number, number, number], margin = 0.08): Promise<Uint8Array> {
  const [l, t, r, b] = box.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
  const mx = (r - l) * margin, my = (b - t) * margin;
  const x0 = Math.max(0, l - mx), y0 = Math.max(0, t - my), x1 = Math.min(1, r + mx), y1 = Math.min(1, b + my);
  return new Uint8Array(await run("ffmpeg", [
    "-v", "error", "-i", "pipe:0", "-frames:v", "1",
    "-vf", `crop=iw*${(x1 - x0).toFixed(4)}:ih*${(y1 - y0).toFixed(4)}:iw*${x0.toFixed(4)}:ih*${y0.toFixed(4)}`,
    "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
  ], { input: bytes }));
}
