// MUSIC, SOUND ONLY (2026-11-06: the owner's walk crashed Chrome and Edge, "Out of Memory", from the moment two
// tracks were added; both MP3s carried an embedded cover picture, 1280×720 and 640×480 PNG, which a browser
// reads as a video stream inside the file). Every uploaded track is rewritten with its sound only: the audio
// is copied as it is (no re-encoding, no loss), the pictures and other streams are left out. Under a NEW key:
// sounds are served "immutable", so a browser that has the old file would keep playing it. Free; a failure
// leaves the file as uploaded (the old key back).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, putSignImage } from "@/lib/splats/r2";
import { walkAudioKey } from "@/lib/splats/keys";
import { run } from "./media";

/** Keys this server has handed out, so two tracks cleaned in the same second never share a name. */
const issued = new Set<string>();

/** The key to play: `key` when it is sound only already, else a new key holding its sound only. */
export async function soundOnly(key: string, scene: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "music-"));
  try {
    const m4a = /\.m4a$/i.test(key);
    const src = join(dir, m4a ? "in.m4a" : "in.mp3"), out = join(dir, m4a ? "out.m4a" : "out.mp3");
    await downloadToFile(key, src, "web");
    const streams = (await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", src])).toString().trim().split(/\s+/);
    if (streams.every((t) => t === "audio")) return key;
    await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-map", "0:a:0", "-c:a", "copy", "-map_metadata", "-1", ...(m4a ? ["-movflags", "+faststart"] : ["-id3v2_version", "3"]), out]);
    const bytes = new Uint8Array(readFileSync(out));
    if (bytes.length < 10_000) throw new Error("the sound came out empty");
    // A new name, a second later than any other this minute (the key carries the second).
    let next: string | null = null;
    for (let k = 1; k < 120 && (!next || next === key || issued.has(next)); k++) next = walkAudioKey(scene, m4a ? "audio/mp4" : "audio/mpeg", new Date(Date.now() + k * 1000));
    if (!next || next === key || issued.has(next)) return key;
    issued.add(next);
    await putSignImage(next, m4a ? "audio/mp4" : "audio/mpeg", bytes);
    return next;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
