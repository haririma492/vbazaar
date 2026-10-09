/**
 * THE GPU TRAINING, WIRED TO THIS SERVER (`lib/splats/train.ts` is the logic;
 * this gives it RunPod, R2, the scripts and the hand-over).
 *
 *   RUNPOD_API_KEY               RunPod → Settings → API Keys (Railway → Variables)
 *   RUNPOD_TRAIN_GPUS            optional, GPU type ids tried in turn, comma-separated;
 *                                default «NVIDIA L4, NVIDIA RTX A5000, NVIDIA GeForce RTX 4090, NVIDIA L40S»
 *   RUNPOD_TRAIN_TIMEOUT_HOURS   optional, default 4
 *   RUNPOD_TRAIN_CLOUD           optional, SECURE (default) or COMMUNITY
 *   RUNPOD_TRAIN_METHOD          optional, splatfacto-big (default) or splatfacto (faster, coarser)
 *   RUNPOD_TRAIN_FRAMES          optional, default 500 (the sharpest of ~3× as many)
 *   RUNPOD_TRAIN_IMAGE, _DISK_GB, _ITERATIONS   optional
 *
 * The key stays on this server: the pod gets presigned R2 links only.
 *
 * THE HAND-OVER, after a good training, is what an uploaded master gets —
 * done here on the server, because the operator may have only a phone (the
 * page's in-tab conversion needs ~2× the .ply in memory) and because the
 * server already runs such work (`stream-job.ts`, `retouch-job.ts`):
 *   1. `scripts/splats/convert-in-r2.mjs <scene> --master <the trained .ply>`
 *      in its own process — the .spz web copy, uploaded, and the scene added
 *      to the tour (or pointed at it) — the very script «Actions → Convert
 *      splat» runs;
 *   2. the scene's route from cameras.json (`routeFromCameras`, the same
 *      function a camera file uploaded on the page goes through), and its
 *      sharper/streamed/restored copies retired as for any new master
 *      (they were made from the old one).
 *
 * Server only.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routeFromCameras } from "./cameras";
import { presignGetAny, presignPutMasters, readMastersText, readTour, writeMastersJson, writeTour } from "./r2";
import { sceneById, updateScene } from "./tour";
import { runpodClient } from "./runpod";
import {
  CURRENT_JOB_KEY, createTrainer, gpuLabel, runpodConfigured, trainConfig, type TrainJob, type Trainer,
} from "./train";

const CONVERT = join(process.cwd(), "scripts", "splats", "convert-in-r2.mjs");

/** Node can run the .mjs that imports .ts files (type stripping: 22.6 and later). */
function canStrip(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 6);
}

function runConvert(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", CONVERT, ...args], { cwd: process.cwd(), env: process.env });
    let tail = "";
    const read = (b: Buffer) => { tail = (tail + b.toString()).slice(-4000); };
    p.stdout.on("data", read);
    p.stderr.on("data", read);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(tail) : reject(new Error(`the conversion stopped (${code}): ${tail.trim().split("\n").slice(-3).join(" ")}`))));
  });
}

async function handoff(job: TrainJob): Promise<{ webKey: string; routePoints: number | null; warning: string | null }> {
  if (!canStrip()) throw new Error(`this server runs Node ${process.versions.node}; the conversion needs 22.6 or later`);
  // 1. The web copy and the tour.
  await runConvert([job.scene, "--master", job.keys.ply, ...(job.title ? ["--title", job.title] : [])]);
  // 2. The route, in the splat's own frame (both come out of gpu-frame.py in COLMAP's).
  const tour = await readTour(); // read again: the conversion has just written it
  const scene = sceneById(tour, job.scene);
  if (!scene) throw new Error(`the conversion left no «${job.scene}» in the tour`);
  let route: ReturnType<typeof routeFromCameras> = null;
  let warning: string | null = null;
  try {
    const text = await readMastersText(job.keys.cameras);
    route = text ? routeFromCameras(JSON.parse(text), scene.flip) : null;
    if (!route) warning = "No route: cameras.json held no camera positions. Record one in the viewer's «Place exits».";
  } catch (e) {
    warning = `No route: cameras.json could not be read (${(e as Error).message}).`;
  }
  await writeTour(updateScene(tour, job.scene, {
    ...(route ? { route: route.route } : {}),
    fileHQ: null, fileRad: null, fileRestored: null,
  }));
  return { webKey: scene.file, routePoints: route?.route.length ?? null, warning };
}

const runpod = () => runpodClient((process.env.RUNPOD_API_KEY || "").trim(), (url, init) => fetch(url, { ...init, cache: "no-store" }));

function scripts() {
  const dir = join(process.cwd(), "scripts", "splats");
  return { sh: readFileSync(join(dir, "gpu-train.sh"), "utf8"), py: readFileSync(join(dir, "gpu-frame.py"), "utf8") };
}

// One trainer per server process (kept across hot reloads in development).
const g = globalThis as unknown as { __skTrainer?: Trainer };
export function trainer(): Trainer {
  g.__skTrainer ??= createTrainer({
    config: trainConfig(process.env),
    runpod,
    configured: () => runpodConfigured(process.env),
    store: {
      presignGet: presignGetAny,
      presignPut: presignPutMasters,
      readText: readMastersText,
      saveJob: (j) => writeMastersJson(CURRENT_JOB_KEY, j),
      loadJob: async () => {
        const text = await readMastersText(CURRENT_JOB_KEY);
        return text ? (JSON.parse(text) as TrainJob) : null;
      },
    },
    scripts,
    handoff,
    now: Date.now,
    every: (ms, fn) => {
      const t = setInterval(() => {
        void fn().then((over) => { if (over) clearInterval(t); }, () => {});
      }, ms);
      t.unref?.();
    },
  });
  return g.__skTrainer;
}

/** A 15-minute link to the last job's whole log (it is uploaded when the job ends); null when there is none. */
export async function trainLogUrl(): Promise<string | null> {
  const j = await trainer().status();
  return j?.podId ? presignGetAny(j.keys.log, 900) : null;
}

/** What the page shows before anything is pressed — never a credential. */
export function trainSummary() {
  const c = trainConfig(process.env);
  return { configured: runpodConfigured(process.env), gpus: c.gpus.map(gpuLabel), timeoutHours: c.timeoutMs / 3_600_000 };
}
