/**
 * THE GPU TRAINING, WIRED TO THIS SERVER (`lib/splats/train.ts` is the logic;
 * this gives it Modal, R2, the scripts and the hand-over).
 *
 *   MODAL_TOKEN_ID / MODAL_TOKEN_SECRET   Modal's API token (Railway → Variables)
 *   MODAL_TRAIN_GPU                       optional, default L4
 *   MODAL_TRAIN_TIMEOUT_HOURS             optional, default 3
 *   MODAL_TRAIN_IMAGE, _CPU, _MEMORY_MIB, _FRAMES, _ITERATIONS, _APP   optional
 *
 * The Modal SDK is loaded only when a training is started or asked after
 * (`import("modal")`, Node 22 or later), so nothing else on the site depends
 * on it.
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
import {
  CURRENT_JOB_KEY, createTrainer, modalConfigured, trainConfig, type ModalLike, type TrainJob, type Trainer,
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
  // 2. The route, in the splat's own frame (both come out of modal-frame.py in COLMAP's).
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

let modalClient: Promise<ModalLike> | null = null;
function modal(): Promise<ModalLike> {
  modalClient ??= import("modal").then((m) => new m.ModalClient() as unknown as ModalLike).catch((e) => {
    modalClient = null;
    throw new Error(`the Modal SDK could not be loaded (${(e as Error).message}); it needs Node 22 or later`);
  });
  return modalClient;
}

function scripts() {
  const dir = join(process.cwd(), "scripts", "splats");
  return { sh: readFileSync(join(dir, "modal-train.sh"), "utf8"), py: readFileSync(join(dir, "modal-frame.py"), "utf8") };
}

// One trainer per server process (kept across hot reloads in development).
const g = globalThis as unknown as { __skTrainer?: Trainer };
export function trainer(): Trainer {
  g.__skTrainer ??= createTrainer({
    config: trainConfig(process.env),
    modal,
    configured: () => modalConfigured(process.env),
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

/** What the page shows before anything is pressed — never a credential. */
export function trainSummary() {
  const c = trainConfig(process.env);
  return { configured: modalConfigured(process.env), gpu: c.gpu, gpuPricePerHour: c.gpuPricePerHour, timeoutHours: c.timeoutMs / 3_600_000 };
}
