// A PRODUCT'S PHOTO FROM SEVERAL FRAMES OF THE WALK (owner, 2026-11-04: "go ahead
// with building frame combination"). The frames are cut by ffmpeg, combined by
// `fuse.ts`, and written back as one JPEG with the product's yellow box.
//
//   1. up to `CANDIDATES` moments along the product's light are cut as
//      close-ups aimed at it, and the sharpest is found;
//   2. up to `NEIGHBOURS` more frames are cut from just round it (the light's
//      own pins, 0.1 s apart: the product the same size in each);
//   3. they are lined up and averaged (`fuse`), then shrunk/grown to `OUT`
//      px with a light sharpening (ffmpeg's unsharp: it brings back the edge
//      the averaging softened, it adds no letters), and the box is drawn.
import { run, v360Yaw, photoFrame } from "./media";
import { fuse, grey, sharpness, type Rgb } from "./fuse";
import type { ItemPin } from "@/lib/splats/walks";

export const CANDIDATES = 8, NEIGHBOURS = 4, WORK = 512, OUT = 1024;

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);

/** One close-up of the product at a pin, as RGB (`WORK` px square, no box). */
async function closeUp(input: string, q: ItemPin, fov: number): Promise<Rgb> {
  const raw = await run("ffmpeg", ["-v", "error", "-ss", q.t.toFixed(2), "-i", input, "-frames:v", "1", "-vf",
    `v360=input=e:output=flat:yaw=${v360Yaw(q.x).toFixed(3)}:pitch=${deg(q.y)}:h_fov=${deg(fov)}:v_fov=${deg(fov)}:w=${WORK}:h=${WORK}:interp=lanczos`,
    "-threads", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  if (raw.length < WORK * WORK * 3) throw new Error("No frame there.");
  return { n: WORK, px: Float32Array.from(raw.subarray(0, WORK * WORK * 3)) };
}

/**
 * The product's photo from its light (`pins`, `size`): the sharpest moment and
 * its neighbours combined. Returns the JPEG and how many frames went into it.
 */
export async function fusedPhoto(input: string, pins: ItemPin[], size: { w: number; h: number }): Promise<{ jpeg: Uint8Array; frames: number }> {
  const { fov } = photoFrame(size, WORK);
  const step = Math.max(1, Math.floor(pins.length / CANDIDATES));
  let best: { q: ItemPin; img: Rgb; score: number } | null = null;
  for (const q of pins.filter((_, i) => i % step === 0).slice(0, CANDIDATES)) {
    try {
      const img = await closeUp(input, q, fov);
      const score = sharpness(grey(img), WORK);
      if (!best || score > best.score) best = { q, img, score };
    } catch { /* that moment is skipped */ }
  }
  if (!best) throw new Error("No frame of the product could be cut.");
  const near = pins.filter((q) => q !== best!.q && Math.abs(q.t - best!.q.t) <= 0.35)
    .sort((a, b) => Math.abs(a.t - best!.q.t) - Math.abs(b.t - best!.q.t)).slice(0, NEIGHBOURS);
  const frames: Rgb[] = [best.img];
  for (const q of near) {
    try { frames.push(await closeUp(input, q, fov)); } catch { /* skipped */ }
  }
  const { img, used } = fuse(frames, photoFrame(size, WORK).box);
  const bytes = new Uint8Array(img.px.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(img.px[i])));
  const { box } = photoFrame(size, OUT);
  const jpeg = new Uint8Array(await run("ffmpeg", ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${WORK}x${WORK}`, "-i", "pipe:0", "-frames:v", "1",
    "-vf", `scale=${OUT}:${OUT}:flags=lanczos,unsharp=5:5:0.6:5:5:0,drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=yellow@0.9:t=4`,
    "-threads", "1", "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { input: bytes }));
  return { jpeg, frames: used };
}
