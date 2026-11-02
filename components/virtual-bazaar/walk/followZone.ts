// The browser half of `lib/splats/trackZone.ts`: the walk video drawn small
// (1 px = 1°) every third of a second, then the photographer followed through
// it from the operator's locks. Needs the video's CORS, as following a product does.
import { ZONE_H, ZONE_W, columnHistograms, zoneThroughWalk, type ZoneLock } from "@/lib/splats/trackZone";

export const ZONE_DT = 1 / 3;

export async function followZoneThroughWalk(
  src: string,
  locks: ZoneLock[],
  onProgress: (p: { done: number; total: number }) => void,
  signal: { cancelled: boolean },
): Promise<ZoneLock[]> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  try {
    await new Promise<void>((ok, fail) => {
      video.addEventListener("loadeddata", () => ok(), { once: true });
      video.addEventListener("error", () => fail(new Error("The video could not be opened to follow you.")), { once: true });
      video.load();
    });
    const canvas = document.createElement("canvas");
    canvas.width = ZONE_W;
    canvas.height = ZONE_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const total = Math.max(1, Math.floor(video.duration / ZONE_DT));
    const frames: Float32Array[] = [];
    for (let i = 0; i < total; i++) {
      if (signal.cancelled) throw new Error("Stopped.");
      await new Promise<void>((ok) => {
        video.addEventListener("seeked", () => ok(), { once: true });
        video.currentTime = Math.min(i * ZONE_DT, Math.max(0, video.duration - 0.05));
      });
      ctx.drawImage(video, 0, 0, ZONE_W, ZONE_H);
      frames.push(columnHistograms(ctx.getImageData(0, 0, ZONE_W, ZONE_H).data));
      onProgress({ done: i + 1, total });
    }
    return zoneThroughWalk(frames, ZONE_DT, locks);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
