/**
 * TRAINING A SPLAT FROM A PHONE VIDEO, ON A RENTED GPU (operator, 2026-10-09:
 * a store owner with only an iPhone uploads a video at `/operator/splats`,
 * presses «Train», and the store is a splat in the tour with its walk route).
 *
 * Our server starts a Modal sandbox (GPU L4 by default) on the official
 * nerfstudio image and hands it `scripts/splats/modal-train.sh`; the sandbox
 * downloads the video, finds the cameras (COLMAP), trains (splatfacto) and
 * PUTs its results back. Modal never gets an R2 key: only presigned URLs, one
 * per file, valid for the job's time limit plus an hour.
 *
 *   training/<scene>/<job>/status.json   stage, percent, log tail, error (every ~30 s)
 *   training/<scene>/<job>/cameras.json  the camera positions → the scene's route
 *   training/<scene>/<job>/train.log     the whole log, at the end
 *   masters/<scene>/<scene>-<job>-trained.ply   the splat: a master like any other
 *
 * all in the masters bucket (private). `training/` sits beside `masters/` and
 * `tour-history/`, so «Files in R2» does not list it. When the sandbox has
 * finished well, the server hands over to what an uploaded master gets: the
 * .ply → .spz web copy and the tour (`scripts/splats/convert-in-r2.mjs`), and
 * the route from cameras.json (`routeFromCameras`) — `lib/splats/train-job.ts`.
 *
 * ⚠️ ONE TRAINING AT A TIME (a cost guard): a new one is refused while the
 * last is not finished. The job is kept in this process and in R2
 * (`training/current.json`), so a redeploy mid-training loses nothing.
 *
 * Pure apart from what is passed in (`TrainDeps`): no imports, so `node
 * --test` runs it, with Modal and R2 replaced by fakes.
 */

// `keys.ts`'s scene-id and file-name rules, repeated (`node --test` runs this without a bundler).
const SCENE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const isSceneId = (s: string) => SCENE_RE.test(s);

// ── Settings ────────────────────────────────────────────────────────────────

export type TrainConfig = {
  /** Modal app the sandboxes are created in (made on first use). */
  app: string;
  /** Registry image: nerfstudio with CUDA, COLMAP, ffmpeg and gsplat. */
  image: string;
  /** Modal GPU type, e.g. "L4", "A10G", "L40S". */
  gpu: string;
  /** Approximate price of that GPU per hour, in US dollars (shown, never billed by us). */
  gpuPricePerHour: number | null;
  cpu: number;
  memoryMiB: number;
  /** The sandbox is stopped by Modal after this long, whatever it is doing. */
  timeoutMs: number;
  frames: number;
  iterations: number;
};

/**
 * ghcr.io/nerfstudio-project/nerfstudio:1.1.5 — the newest release tag
 * (manifest sha256:b59b8e1012d7a43679d3234b3de9c8416a4b8435fcbf21b9d8c4494b8563f19e
 * when checked, 2026-10-09). Its Dockerfile: CUDA 11.8 (sm 61–90, so L4's
 * sm 89 is covered), COLMAP 3.9.1, ffmpeg, torch 2.1.2, gsplat from
 * nerfstudio's pin.
 */
export const DEFAULT_IMAGE = "ghcr.io/nerfstudio-project/nerfstudio:1.1.5";

/** Approximate Modal list prices per GPU-hour (USD), for the screen only. */
const GPU_PRICES: Record<string, number> = { T4: 0.59, L4: 0.8, A10G: 1.1, L40S: 1.95, A100: 2.1, "A100-80GB": 2.5, H100: 3.95 };

export function trainConfig(env: Record<string, string | undefined>): TrainConfig {
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : d;
  };
  const gpu = (env.MODAL_TRAIN_GPU || "").trim() || "L4";
  return {
    app: (env.MODAL_TRAIN_APP || "").trim() || "sarekooche-splat-train",
    image: (env.MODAL_TRAIN_IMAGE || "").trim() || DEFAULT_IMAGE,
    gpu,
    gpuPricePerHour: GPU_PRICES[gpu.split(":")[0]] ?? null,
    cpu: num("MODAL_TRAIN_CPU", 4, 1, 32),
    memoryMiB: num("MODAL_TRAIN_MEMORY_MIB", 16384, 4096, 131072),
    timeoutMs: num("MODAL_TRAIN_TIMEOUT_HOURS", 3, 0.5, 23) * 3_600_000,
    frames: Math.round(num("MODAL_TRAIN_FRAMES", 350, 50, 1500)),
    iterations: Math.round(num("MODAL_TRAIN_ITERATIONS", 30000, 1000, 100000)),
  };
}

export const modalConfigured = (env: Record<string, string | undefined>) =>
  Boolean((env.MODAL_TOKEN_ID || "").trim() && (env.MODAL_TOKEN_SECRET || "").trim());

/** The image layer added on top: curl (the CUDA runtime base image removes it after setup). */
export const IMAGE_COMMANDS = [
  "RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*",
];

// ── Keys ────────────────────────────────────────────────────────────────────

/** A phone video already in R2 that a splat can be trained from: (scenes|masters)/<scene>/<file>.mp4|.mov. */
export function trainVideoOf(key: string): { scene: string; file: string; ext: "mp4" | "mov" } | null {
  const m = /^(masters|scenes)\/([^/]+)\/([^/]+)\.(mp4|mov)$/i.exec(key);
  if (!m || !isSceneId(m[2]) || !FILE_RE.test(`${m[3]}.${m[4]}`)) return null;
  return { scene: m[2], file: `${m[3]}.${m[4]}`, ext: m[4].toLowerCase() as "mp4" | "mov" };
}

/** A job's id: when it started, to the second, and a short random tail: `20261009-142233-k3f9`. */
export function newJobId(at: Date, random: () => number = Math.random): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const tail = Array.from({ length: 4 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(random() * 32) % 32]).join("");
  return `${stamp}-${tail}`;
}

const JOB_RE = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

export type TrainKeys = { dir: string; status: string; cameras: string; log: string; ply: string };

/** Where one job's files go (all in the masters bucket). Null for a bad scene or job id. */
export function trainKeys(scene: string, job: string): TrainKeys | null {
  if (!isSceneId(scene) || !JOB_RE.test(job)) return null;
  const dir = `training/${scene}/${job}/`;
  return { dir, status: `${dir}status.json`, cameras: `${dir}cameras.json`, log: `${dir}train.log`, ply: `masters/${scene}/${scene}-${job}-trained.ply` };
}

/** The job record kept in R2 (masters bucket): the one current or last training. */
export const CURRENT_JOB_KEY = "training/current.json";

// ── status.json ─────────────────────────────────────────────────────────────

export const STAGES = ["starting", "downloading", "matching", "training", "exporting", "framing", "uploading", "done", "failed"] as const;
export type Stage = (typeof STAGES)[number];

export type SandboxStatus = {
  stage: Stage;
  words: string;
  percent: number | null;
  error: string | null;
  log: string[];
  updatedAt: string | null;
};

/** What modal-train.sh wrote, made safe to show; null when it is not a status at all. */
export function parseStatus(text: string | null): SandboxStatus | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stage = (STAGES as readonly unknown[]).includes(o.stage) ? (o.stage as Stage) : null;
  if (!stage) return null;
  const pct = typeof o.percent === "number" && Number.isFinite(o.percent) ? Math.min(100, Math.max(0, o.percent)) : null;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    stage,
    words: str(o.words, 200),
    percent: pct,
    error: str(o.error, 1000) || null,
    log: Array.isArray(o.log) ? o.log.filter((l): l is string => typeof l === "string").slice(-15).map((l) => l.slice(0, 300)) : [],
    updatedAt: str(o.updatedAt, 40) || null,
  };
}

// ── The job and how it moves on ─────────────────────────────────────────────

export type TrainState = "starting" | "running" | "finishing" | "done" | "failed" | "cancelled";

export type TrainJob = {
  id: string;
  scene: string;
  /** The video's R2 key. */
  video: string;
  title: string | null;
  gpu: string;
  timeoutMs: number;
  sandboxId: string | null;
  state: TrainState;
  /** The sandbox's stage (status.json), or ours while starting and finishing. */
  stage: string;
  words: string;
  percent: number | null;
  log: string[];
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  keys: TrainKeys;
  /** Set when done: the web copy in the tour, and the route's length. */
  webKey: string | null;
  routePoints: number | null;
  /** Something that went wrong without spoiling the result (e.g. no route). */
  warning: string | null;
};

export const isFinished = (s: TrainState) => s === "done" || s === "failed" || s === "cancelled";

/** The sandbox: still running (null), its exit code, or gone (Modal no longer knows it). */
export type SandboxExit = number | null | "gone";

/**
 * Where the job goes next, from what the sandbox last wrote and whether it is
 * still running. Pure; «finishing» means: hand over now.
 */
export function advance(job: TrainJob, status: SandboxStatus | null, exit: SandboxExit, now: number): TrainJob {
  if (isFinished(job.state) || job.state === "finishing") return job;
  const next: TrainJob = { ...job };
  if (status) Object.assign(next, { stage: status.stage, words: status.words, percent: status.percent, log: status.log });
  if (exit === null) {
    next.state = "running";
    return next;
  }
  const succeeded = status?.stage === "done" && (exit === 0 || exit === "gone");
  if (succeeded) return { ...next, state: "finishing", stage: "handing over", words: "Making the web copy and adding it to the tour", percent: 100 };
  // The SDK's poll() answers 124 for Modal's time limit, 137 for terminated (modal getReturnCode).
  const ranOut = exit === 124 || now - job.startedAt >= job.timeoutMs - 60_000;
  const error = status?.error
    || (ranOut ? `Stopped by the time limit (${Math.round(job.timeoutMs / 3_600_000)} h).`
      : exit === "gone" ? "The GPU machine is gone and left no result."
        : `The GPU machine stopped (exit ${exit}) without saying why — see its log.`);
  return { ...next, state: "failed", stage: "failed", error, finishedAt: now };
}

// ── What is passed in ───────────────────────────────────────────────────────

/** The part of the Modal SDK (`modal` on npm, ModalClient) this uses — see node_modules/modal/dist/index.d.ts. */
export type ModalLike = {
  apps: { fromName(name: string, params?: { createIfMissing?: boolean }): Promise<unknown> };
  images: { fromRegistry(tag: string): { dockerfileCommands(commands: string[]): unknown } };
  sandboxes: {
    create(app: any, image: any, params: Record<string, unknown>): Promise<{ sandboxId: string }>;
    fromId(id: string): Promise<{ poll(): Promise<number | null>; terminate(): Promise<unknown> }>;
  };
};

export type TrainStore = {
  /** A GET link for an object in either bucket (by its prefix), valid this many seconds. */
  presignGet(key: string, seconds: number): Promise<string>;
  /** A PUT link into the masters bucket, signed without a content type. */
  presignPut(key: string, seconds: number): Promise<string>;
  /** An object of the masters bucket as text; null when there is none. */
  readText(key: string): Promise<string | null>;
  saveJob(job: TrainJob): Promise<void>;
  loadJob(): Promise<TrainJob | null>;
};

export type TrainDeps = {
  config: TrainConfig;
  /** The Modal client (made on first use). */
  modal: () => Promise<ModalLike>;
  /** Whether MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are set. */
  configured: () => boolean;
  store: TrainStore;
  /** modal-train.sh and modal-frame.py, as text. */
  scripts: () => { sh: string; py: string };
  /** The hand-over after a good training: web copy, tour, route. */
  handoff: (job: TrainJob) => Promise<{ webKey: string; routePoints: number | null; warning: string | null }>;
  now: () => number;
  random?: () => number;
  /** Call `fn` every `ms` until it returns true (the server's watcher); tests pass a no-op. */
  every?: (ms: number, fn: () => Promise<boolean>) => void;
};

export class TrainRefused extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

const b64 = (s: string) =>
  typeof Buffer !== "undefined" ? Buffer.from(s, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(s)));

/** The sandbox's parameters (SandboxCreateParams), built from the job: pure. */
export function sandboxParams(config: TrainConfig, job: TrainJob, urls: { video: string; status: string; ply: string; cameras: string; log: string }, scripts: { sh: string; py: string }) {
  return {
    gpu: config.gpu,
    cpu: config.cpu,
    memoryMiB: config.memoryMiB,
    timeoutMs: config.timeoutMs,
    command: ["bash", "-c", scripts.sh, "modal-train"],
    env: {
      SK_JOB: job.id,
      SK_SCENE: job.scene,
      SK_VIDEO_EXT: trainVideoOf(job.video)?.ext ?? "mp4",
      SK_FRAMES: String(config.frames),
      SK_ITERATIONS: String(config.iterations),
      SK_VIDEO_URL: urls.video,
      SK_STATUS_URL: urls.status,
      SK_PLY_URL: urls.ply,
      SK_CAMERAS_URL: urls.cameras,
      SK_LOG_URL: urls.log,
      SK_FRAME_PY_B64: b64(scripts.py),
      PYTHONUNBUFFERED: "1",
    },
    tags: { purpose: "splat-train", scene: job.scene, job: job.id },
  };
}

// ── The trainer ─────────────────────────────────────────────────────────────

/** A job still without a sandbox this long after it was started was lost to a restart. */
export const LAUNCH_STALE_MS = 30 * 60_000;

export function createTrainer(deps: TrainDeps) {
  let current: TrainJob | null = null;
  let loaded = false;
  let handing = false;
  let watching = false;
  let launching: Promise<void> | null = null;

  async function job(): Promise<TrainJob | null> {
    if (!loaded) {
      loaded = true;
      try {
        current = (await deps.store.loadJob()) ?? current;
      } catch {
        /* R2 unreadable for a moment: what this process knows */
      }
    }
    return current;
  }

  async function save(j: TrainJob) {
    current = j;
    try {
      await deps.store.saveJob(j);
    } catch {
      /* kept in this process; saved again on the next change */
    }
  }

  /** Presign the links and ask Modal for the sandbox; the job moves to «running» or «failed». */
  async function launch(j: TrainJob) {
    const { config } = deps;
    try {
      // Every link outlives the sandbox's time limit by an hour.
      const secs = Math.ceil(config.timeoutMs / 1000) + 3600;
      const [video, status, ply, cameras, log] = await Promise.all([
        deps.store.presignGet(j.video, secs),
        deps.store.presignPut(j.keys.status, secs),
        deps.store.presignPut(j.keys.ply, secs),
        deps.store.presignPut(j.keys.cameras, secs),
        deps.store.presignPut(j.keys.log, secs),
      ]);
      const modal = await deps.modal();
      const app = await modal.apps.fromName(config.app, { createIfMissing: true });
      const image = modal.images.fromRegistry(config.image).dockerfileCommands(IMAGE_COMMANDS);
      const sb = await modal.sandboxes.create(app, image, sandboxParams(config, j, { video, status, ply, cameras, log }, deps.scripts()));
      if (current?.id === j.id && current.state === "cancelled") {
        // Cancelled while Modal was still starting it: stop it before it bills.
        await modal.sandboxes.fromId(sb.sandboxId).then((x) => x.terminate()).catch(() => {});
        return;
      }
      await save({ ...(current?.id === j.id ? current : j), sandboxId: sb.sandboxId, state: "running", words: "Starting the GPU machine (the first time, Modal fetches the 5 GB image: a few minutes)" });
    } catch (e) {
      if (current?.id === j.id && current.state === "cancelled") return;
      await save({ ...j, state: "failed", stage: "failed", words: "Not started", error: `Modal refused to start the training: ${(e as Error).message}`, finishedAt: deps.now() });
    }
  }

  function handOver(j: TrainJob) {
    if (handing) return;
    handing = true;
    void (async () => {
      try {
        const r = await deps.handoff(j);
        await save({ ...(current ?? j), state: "done", stage: "done", words: "In the tour", webKey: r.webKey, routePoints: r.routePoints, warning: r.warning, finishedAt: deps.now() });
      } catch (e) {
        await save({
          ...(current ?? j), state: "failed", stage: "failed", finishedAt: deps.now(),
          error: `Trained, but the hand-over failed: ${(e as Error).message}. The splat is in R2 as ${j.keys.ply} — convert it with Actions → Convert splat.`,
        });
      } finally {
        handing = false;
      }
    })();
  }

  /** Ask the sandbox and status.json how it goes, and move the job on. */
  async function refresh(): Promise<TrainJob | null> {
    const j = await job();
    if (!j || isFinished(j.state)) return j;
    if (j.state === "finishing") {
      handOver(j); // after a restart, nobody is handing over: start again
      return j;
    }
    if (!j.sandboxId) {
      // Still being launched by this process, or the process that launched it
      // restarted before Modal answered: then nothing will ever move it on.
      if (launching || deps.now() - j.startedAt < LAUNCH_STALE_MS) return j;
      const failed: TrainJob = { ...j, state: "failed", stage: "failed", words: "Not started", error: "The server restarted while Modal was starting the training. Press «Train» again.", finishedAt: deps.now() };
      await save(failed);
      return failed;
    }
    let status: SandboxStatus | null = null;
    try {
      status = parseStatus(await deps.store.readText(j.keys.status));
    } catch {
      /* not written yet, or R2 busy */
    }
    let exit: SandboxExit;
    try {
      const sb = await (await deps.modal()).sandboxes.fromId(j.sandboxId);
      exit = await sb.poll();
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (!/NotFound/i.test(name)) return { ...j, warning: `Could not ask Modal: ${(e as Error).message}` };
      exit = "gone";
    }
    const next = advance(j, status, exit, deps.now());
    if (JSON.stringify(next) !== JSON.stringify(j)) await save(next);
    if (next.state === "finishing") handOver(next);
    return next;
  }

  function watch() {
    if (watching || !deps.every) return;
    watching = true;
    deps.every(30_000, async () => {
      const j = await refresh().catch(() => current);
      const over = !j || isFinished(j.state);
      if (over) watching = false;
      return over;
    });
  }

  return {
    /** The current or last job, brought up to date (and watched until it ends). */
    async status(): Promise<TrainJob | null> {
      const j = await refresh();
      if (j && !isFinished(j.state)) watch();
      return j;
    },

    /** Start training `scene` from the video at `videoKey`. Refused while another is unfinished. */
    async start(scene: string, videoKey: string, title: string | null): Promise<TrainJob> {
      if (!deps.configured()) {
        throw new TrainRefused("Modal is not set up on this host: set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET (Railway → Variables).", 503);
      }
      if (!isSceneId(scene)) throw new TrainRefused("A scene id like «store-01».", 400);
      if (!trainVideoOf(videoKey)) throw new TrainRefused("Not a phone video in R2 (.mp4 or .mov under masters/ or scenes/).", 400);
      const before = await refresh();
      if (before && !isFinished(before.state)) {
        throw new TrainRefused(`«${before.scene}» is still training (one at a time, to keep the GPU bill in check). Wait, or cancel it.`);
      }
      const { config } = deps;
      const at = new Date(deps.now());
      const id = newJobId(at, deps.random);
      const keys = trainKeys(scene, id)!;
      const j: TrainJob = {
        id, scene, video: videoKey, title: title?.trim().slice(0, 80) || null, gpu: config.gpu, timeoutMs: config.timeoutMs,
        sandboxId: null, state: "starting", stage: "starting", words: "Asking Modal for a GPU", percent: null, log: [],
        startedAt: at.getTime(), finishedAt: null, error: null, keys, webKey: null, routePoints: null, warning: null,
      };
      await save(j);
      // Launched in the background: on the first run Modal pulls the 5 GB
      // image before `sandboxes.create` returns, far past the ~100 s the CDN
      // in front of the site waits for an answer (HTTP 524). The page follows
      // the job through `status()`.
      launching = launch(j).finally(() => { launching = null; });
      watch();
      return current!;
    },

    /** Once the background launch has settled: the job as it then stands. */
    async launched(): Promise<TrainJob | null> {
      await launching;
      return current;
    },

    /** Stop the sandbox now (the GPU bill stops with it). */
    async cancel(): Promise<TrainJob | null> {
      const j = await job();
      if (!j || isFinished(j.state)) return j;
      if (j.state === "finishing") throw new TrainRefused("The training has finished and is being added to the tour; it cannot be cancelled now.");
      if (j.sandboxId) {
        try {
          await (await (await deps.modal()).sandboxes.fromId(j.sandboxId)).terminate();
        } catch (e) {
          if (!/NotFound/i.test((e as { name?: string }).name ?? "")) throw e;
        }
      }
      await save({ ...j, state: "cancelled", stage: "cancelled", words: "Cancelled", finishedAt: deps.now() });
      return current;
    },
  };
}

export type Trainer = ReturnType<typeof createTrainer>;
