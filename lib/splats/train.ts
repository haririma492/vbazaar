/**
 * TRAINING A SPLAT FROM A PHONE VIDEO, ON A RENTED GPU (operator, 2026-10-09:
 * a store owner with only an iPhone uploads a video at `/operator/splats`,
 * presses «Train», and the store is a splat in the tour with its walk route).
 *
 * Our server rents a RunPod pod (an L4 by default, or the next GPU type in
 * the list when none is free) on the official nerfstudio image and hands it
 * `scripts/splats/gpu-train.sh`; the pod downloads the video, finds the
 * cameras (COLMAP), trains (splatfacto) and PUTs its results back. RunPod
 * never gets an R2 key or ours: only presigned URLs, one per file, valid for
 * the job's time limit plus an hour. (Modal came first; it wanted a payment
 * method behind startup-credit forms, and the operator turned it down.)
 *
 *   training/<scene>/<job>/status.json   stage, percent, log tail, error (every ~30 s)
 *   training/<scene>/<job>/cameras.json  the camera positions → the scene's route
 *   training/<scene>/<job>/train.log     the whole log, at the end
 *   masters/<scene>/<scene>-<job>-trained.ply   the splat: a master like any other
 *
 * all in the masters bucket (private). `training/` sits beside `masters/` and
 * `tour-history/`, so «Files in R2» does not list it. When the pod has
 * finished well, the server hands over to what an uploaded master gets: the
 * .ply → .spz web copy and the tour (`scripts/splats/convert-in-r2.mjs`), and
 * the route from cameras.json (`routeFromCameras`) — `lib/splats/train-job.ts`.
 *
 * ⚠️ A POD BILLS UNTIL IT IS TERMINATED (`runpod.ts`): RunPod has no time
 * limit and restarts a container whose command ends. So the pod is
 * terminated here as soon as status.json says done or failed, at the time
 * limit, and on cancel — and retried on every watch until RunPod confirms
 * (`podReleased`). The script also deletes its own pod when it ends, and has
 * its own timer, in case this server is down.
 *
 * ⚠️ ONE TRAINING AT A TIME (a cost guard): a new one is refused while the
 * last is not finished. The job is kept in this process and in R2
 * (`training/current.json`), so a redeploy mid-training loses nothing.
 *
 * Pure apart from what is passed in (`TrainDeps`): type imports only, so
 * `node --test` runs it, with RunPod and R2 replaced by fakes.
 */

import type { PodCreate, PodInfo, RunPodLike } from "./runpod";

// `keys.ts`'s scene-id and file-name rules, repeated (`node --test` runs this without a bundler).
const SCENE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const isSceneId = (s: string) => SCENE_RE.test(s);

// ── Settings ────────────────────────────────────────────────────────────────

export type TrainConfig = {
  /** Registry image: nerfstudio with CUDA, COLMAP, ffmpeg and gsplat. */
  image: string;
  /** RunPod GPU type ids, tried in this order until one is free. */
  gpus: string[];
  /** SECURE: RunPod's own data centres; COMMUNITY: cheaper, other people's machines. */
  cloud: "SECURE" | "COMMUNITY";
  /** Container disk in GB: the video, ~350 frames at 4K and their downscales, the training. */
  diskGb: number;
  /** The pod is terminated after this long, whatever it is doing. */
  timeoutMs: number;
  /** Frames kept from the video (the sharpest of ~3× as many cut). */
  frames: number;
  iterations: number;
  /** nerfstudio method: splatfacto-big (finer, slower) or splatfacto. */
  method: "splatfacto-big" | "splatfacto";
};

/**
 * ghcr.io/nerfstudio-project/nerfstudio:1.1.5 — the newest release tag
 * (manifest sha256:b59b8e1012d7a43679d3234b3de9c8416a4b8435fcbf21b9d8c4494b8563f19e
 * when checked, 2026-10-09). Its Dockerfile: CUDA 11.8 (sm 61–90, so every
 * GPU below is covered), COLMAP 3.9.1, ffmpeg, torch 2.1.2, gsplat from
 * nerfstudio's pin. It has no curl: `gpu-train.sh` installs it first.
 */
export const DEFAULT_IMAGE = "ghcr.io/nerfstudio-project/nerfstudio:1.1.5";

/**
 * RunPod's GPU type ids (docs: references/gpu-types), cheapest-that-fits
 * first: 24 GB is plenty for splatfacto on ~350 frames (it trains at ≤1600 px).
 */
export const DEFAULT_GPUS = ["NVIDIA L4", "NVIDIA RTX A5000", "NVIDIA GeForce RTX 4090", "NVIDIA L40S"];

/** «NVIDIA GeForce RTX 4090» → «RTX 4090», for the screen. */
export const gpuLabel = (id: string) => id.replace(/^NVIDIA\s+/, "").replace(/^GeForce\s+/, "").trim() || id;

export function trainConfig(env: Record<string, string | undefined>): TrainConfig {
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : d;
  };
  const gpus = (env.RUNPOD_TRAIN_GPUS || "").split(",").map((g) => g.trim()).filter(Boolean);
  return {
    image: (env.RUNPOD_TRAIN_IMAGE || "").trim() || DEFAULT_IMAGE,
    gpus: gpus.length ? gpus.slice(0, 8) : DEFAULT_GPUS,
    cloud: (env.RUNPOD_TRAIN_CLOUD || "").trim().toUpperCase() === "COMMUNITY" ? "COMMUNITY" : "SECURE",
    diskGb: Math.round(num("RUNPOD_TRAIN_DISK_GB", 80, 30, 500)),
    // 4 h: COLMAP on 500 frames with loop detection, then splatfacto-big, is ~2–2.5 h on an L4.
    timeoutMs: num("RUNPOD_TRAIN_TIMEOUT_HOURS", 4, 0.5, 23) * 3_600_000,
    frames: Math.round(num("RUNPOD_TRAIN_FRAMES", 500, 50, 1500)),
    iterations: Math.round(num("RUNPOD_TRAIN_ITERATIONS", 30000, 1000, 100000)),
    method: (env.RUNPOD_TRAIN_METHOD || "").trim() === "splatfacto" ? "splatfacto" : "splatfacto-big",
  };
}

export const runpodConfigured = (env: Record<string, string | undefined>) => Boolean((env.RUNPOD_API_KEY || "").trim());

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

export type ScriptStatus = {
  stage: Stage;
  words: string;
  percent: number | null;
  error: string | null;
  log: string[];
  updatedAt: string | null;
};

/** What gpu-train.sh wrote, made safe to show; null when it is not a status at all. */
export function parseStatus(text: string | null): ScriptStatus | null {
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
  /** The GPU it runs on (its label), or the first one asked for while starting. */
  gpu: string;
  timeoutMs: number;
  podId: string | null;
  /** RunPod's price for the pod, USD per hour (what it said at creation). */
  costPerHour: number | null;
  /** RunPod has confirmed the pod is terminated (or never had one). */
  podReleased: boolean;
  state: TrainState;
  /** The script's stage (status.json), or ours while starting and finishing. */
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

/** The pod, as RunPod tells it: still on its way or running, stopped, or no more. */
export type PodState = "up" | "stopped" | "gone";

export function podState(pod: PodInfo | null): PodState {
  if (!pod || pod.status === "TERMINATED") return "gone";
  if (pod.status === "EXITED" || pod.status === "ERROR") return "stopped";
  return "up";
}

/**
 * A pod that has said nothing this long after «Train» is failed: RunPod
 * pulled the 5 GB image and booted it long ago, or never found it a machine.
 */
export const SILENT_MS = 45 * 60_000;

/**
 * Where the job goes next, from what the script last wrote and the pod's
 * state. Pure; «finishing» means: hand over now. The caller terminates the
 * pod of any job this moves to «finishing» or «failed».
 */
export function advance(job: TrainJob, status: ScriptStatus | null, pod: PodState, now: number): TrainJob {
  if (isFinished(job.state) || job.state === "finishing") return job;
  const next: TrainJob = { ...job };
  if (status) Object.assign(next, { stage: status.stage, words: status.words, percent: status.percent, log: status.log });
  if (status?.stage === "done") {
    return { ...next, state: "finishing", stage: "handing over", words: "Making the web copy and adding it to the tour", percent: 100 };
  }
  const failed = (error: string): TrainJob => ({ ...next, state: "failed", stage: "failed", error, finishedAt: now });
  if (status?.stage === "failed") return failed(status.error || "The GPU machine stopped without saying why — see its log.");
  if (pod === "gone") return failed("The GPU machine is gone and left no result.");
  if (pod === "stopped") return failed("The GPU machine stopped before it had finished — see its log.");
  if (now - job.startedAt >= job.timeoutMs) return failed(`Stopped by the time limit (${Math.round(job.timeoutMs / 3_600_000)} h).`);
  if (!status && now - job.startedAt >= SILENT_MS) {
    return failed(`The GPU machine never reported back in ${SILENT_MS / 60_000} min (RunPod found no machine, or the script could not start). Try again.`);
  }
  next.state = "running";
  return next;
}

// ── What is passed in ───────────────────────────────────────────────────────

export type TrainStore = {
  /** A GET link for an object in either bucket (by its prefix), valid this many seconds. */
  presignGet(key: string, seconds: number): Promise<string>;
  /** A PUT link into the masters bucket, signed without a content type. */
  presignPut(key: string, seconds: number): Promise<string>;
  /** An object of the masters bucket as text; null when there is none. Throws when R2 cannot be read. */
  readText(key: string): Promise<string | null>;
  saveJob(job: TrainJob): Promise<void>;
  loadJob(): Promise<TrainJob | null>;
};

export type TrainDeps = {
  config: TrainConfig;
  /** The RunPod client. */
  runpod: () => RunPodLike;
  /** Whether RUNPOD_API_KEY is set. */
  configured: () => boolean;
  store: TrainStore;
  /** gpu-train.sh and gpu-frame.py, as text. */
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

/**
 * The pod's command: unpack gpu-train.sh from the environment and run it,
 * then idle — RunPod restarts a container whose command ends, which would
 * train all over again. The script deletes its own pod when it ends; until
 * then (or if it cannot) the server terminates it.
 */
export const POD_BOOT = 'printf %s "$SK_TRAIN_SH_B64" | base64 -d > /tmp/sk-train.sh && bash /tmp/sk-train.sh; '
  + 'echo "sk-train: ended ($?); idle until the pod is terminated"; exec sleep infinity';

export type TrainUrls = { video: string; status: string; statusGet: string; ply: string; cameras: string; log: string };

/** POST /v2/pods's body for one GPU type, built from the job: pure. RunPod caps the body at 100 KB. */
export function podBody(config: TrainConfig, gpu: string, job: TrainJob, urls: TrainUrls, scripts: { sh: string; py: string }): PodCreate {
  return {
    name: `sk-train-${job.scene}-${job.id}`,
    cloud: config.cloud,
    gpu: { id: gpu, count: 1 },
    image: config.image,
    disk: config.diskGb,
    entrypoint: ["bash", "-c", POD_BOOT],
    cmd: [],
    env: {
      SK_JOB: job.id,
      SK_SCENE: job.scene,
      SK_VIDEO_EXT: trainVideoOf(job.video)?.ext ?? "mp4",
      SK_FRAMES: String(config.frames),
      SK_ITERATIONS: String(config.iterations),
      SK_METHOD: config.method,
      SK_TIMEOUT_S: String(Math.round(config.timeoutMs / 1000)),
      SK_VIDEO_URL: urls.video,
      SK_STATUS_URL: urls.status,
      SK_STATUS_GET_URL: urls.statusGet,
      SK_PLY_URL: urls.ply,
      SK_CAMERAS_URL: urls.cameras,
      SK_LOG_URL: urls.log,
      SK_TRAIN_SH_B64: b64(scripts.sh),
      SK_FRAME_PY_B64: b64(scripts.py),
      PYTHONUNBUFFERED: "1",
    },
  };
}

// ── The trainer ─────────────────────────────────────────────────────────────

/** A job still without a pod this long after it was started was lost to a restart. */
export const LAUNCH_STALE_MS = 30 * 60_000;

const httpStatus = (e: unknown) => (e as { status?: unknown }).status;

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
        const saved = await deps.store.loadJob();
        // A record from before RunPod (Modal's) has no pod to release.
        if (saved) current = { ...saved, podId: saved.podId ?? null, costPerHour: saved.costPerHour ?? null, podReleased: saved.podReleased ?? !saved.podId };
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

  /** Terminate the pod of a job that no longer needs it; tried again on the next watch if RunPod is not reachable. */
  async function release(j: TrainJob): Promise<TrainJob> {
    if (j.podReleased || !j.podId) return j.podReleased ? j : { ...j, podReleased: true };
    try {
      await deps.runpod().terminate(j.podId);
      return { ...j, podReleased: true };
    } catch (e) {
      return { ...j, warning: `The GPU machine could not be stopped yet (${(e as Error).message}); trying again.` };
    }
  }

  /** Presign the links and ask RunPod for a pod, GPU type by type; the job moves to «running» or «failed». */
  async function launch(j: TrainJob) {
    const { config } = deps;
    const cancelled = () => current?.id === j.id && current.state === "cancelled";
    try {
      // Every link outlives the time limit by an hour.
      const secs = Math.ceil(config.timeoutMs / 1000) + 3600;
      const [video, status, statusGet, ply, cameras, log] = await Promise.all([
        deps.store.presignGet(j.video, secs),
        deps.store.presignPut(j.keys.status, secs),
        deps.store.presignGet(j.keys.status, secs),
        deps.store.presignPut(j.keys.ply, secs),
        deps.store.presignPut(j.keys.cameras, secs),
        deps.store.presignPut(j.keys.log, secs),
      ]);
      const urls = { video, status, statusGet, ply, cameras, log };
      const scripts = deps.scripts();
      const refusals: string[] = [];
      for (const gpu of config.gpus) {
        if (cancelled()) return;
        let pod: PodInfo;
        try {
          pod = await deps.runpod().create(podBody(config, gpu, j, urls, scripts));
        } catch (e) {
          const code = httpStatus(e);
          // A bad key or a bad body is the same for every GPU: stop asking.
          if (code === 401 || code === 403 || code === 413 || code === 422) throw e;
          refusals.push(`${gpuLabel(gpu)}: ${(e as Error).message}`);
          continue;
        }
        if (cancelled()) {
          // Cancelled while RunPod was creating it: stop it before it bills.
          const stopped = await deps.runpod().terminate(pod.id).then(() => true, () => false);
          await save({ ...current!, podId: pod.id, podReleased: stopped }); // not stopped: the watcher tries again
          return;
        }
        await save({
          ...(current?.id === j.id ? current : j), podId: pod.id, gpu: gpuLabel(gpu), costPerHour: pod.cost, podReleased: false, state: "running",
          words: "Starting the GPU machine (RunPod fetches the 5 GB image first: a few minutes)",
        });
        return;
      }
      throw new Error(`no GPU free right now — ${refusals.join(" · ")}`);
    } catch (e) {
      if (cancelled()) return;
      await save({ ...j, state: "failed", stage: "failed", words: "Not started", error: `RunPod refused to start the training: ${(e as Error).message}`, finishedAt: deps.now() });
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

  /** Ask status.json and RunPod how it goes, move the job on, and stop a pod no longer needed. */
  async function refresh(): Promise<TrainJob | null> {
    const j = await job();
    if (!j) return j;
    if (isFinished(j.state) || j.state === "finishing") {
      let next = j;
      if (!j.podReleased) {
        next = await release(j);
        if (next !== j) await save(next);
      }
      if (next.state === "finishing") handOver(next); // after a restart, nobody is handing over: start again
      return next;
    }
    if (!j.podId) {
      // Still being launched by this process, or the process that launched it
      // restarted before RunPod answered: then nothing will ever move it on.
      if (launching || deps.now() - j.startedAt < LAUNCH_STALE_MS) return j;
      const failed: TrainJob = { ...j, state: "failed", stage: "failed", words: "Not started", error: "The server restarted while RunPod was starting the training. Press «Train» again.", finishedAt: deps.now() };
      await save(failed);
      return failed;
    }
    let status: ScriptStatus | null;
    try {
      status = parseStatus(await deps.store.readText(j.keys.status));
    } catch {
      return j; // R2 busy: not a reason to judge the pod; ask again next time
    }
    let pod: PodState;
    try {
      pod = podState(await deps.runpod().get(j.podId));
    } catch (e) {
      return { ...j, warning: `Could not ask RunPod: ${(e as Error).message}` };
    }
    let next = advance(j, status, pod, deps.now());
    if (next.state === "finishing" || next.state === "failed") next = await release(next);
    if (JSON.stringify(next) !== JSON.stringify(j)) await save(next);
    if (next.state === "finishing") handOver(next);
    return next;
  }

  const settled = (j: TrainJob | null) => !j || (isFinished(j.state) && j.podReleased);

  function watch() {
    if (watching || !deps.every) return;
    watching = true;
    deps.every(30_000, async () => {
      const j = await refresh().catch(() => current);
      const over = settled(j);
      if (over) watching = false;
      return over;
    });
  }

  return {
    /** The current or last job, brought up to date (and watched until it ends and its pod is gone). */
    async status(): Promise<TrainJob | null> {
      const j = await refresh();
      if (!settled(j)) watch();
      return j;
    },

    /** Start training `scene` from the video at `videoKey`. Refused while another is unfinished. */
    async start(scene: string, videoKey: string, title: string | null): Promise<TrainJob> {
      if (!deps.configured()) {
        throw new TrainRefused("RunPod is not set up on this host: set RUNPOD_API_KEY (Railway → Variables).", 503);
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
        id, scene, video: videoKey, title: title?.trim().slice(0, 80) || null, gpu: gpuLabel(config.gpus[0]), timeoutMs: config.timeoutMs,
        podId: null, costPerHour: null, podReleased: true, state: "starting", stage: "starting", words: "Asking RunPod for a GPU", percent: null, log: [],
        startedAt: at.getTime(), finishedAt: null, error: null, keys, webKey: null, routePoints: null, warning: null,
      };
      await save(j);
      // Launched in the background: the page follows the job through
      // `status()`, and «Train» answers at once whatever RunPod does (the CDN
      // in front of the site gives up after ~100 s: HTTP 524).
      launching = launch(j).finally(() => { launching = null; });
      watch();
      return current!;
    },

    /** Once the background launch has settled: the job as it then stands. */
    async launched(): Promise<TrainJob | null> {
      await launching;
      return current;
    },

    /** Terminate the pod now (the GPU bill stops with it). */
    async cancel(): Promise<TrainJob | null> {
      const j = await job();
      if (!j || isFinished(j.state)) return j;
      if (j.state === "finishing") throw new TrainRefused("The training has finished and is being added to the tour; it cannot be cancelled now.");
      if (j.podId) await deps.runpod().terminate(j.podId); // a pod already gone is fine; RunPod unreachable: say so, nothing changes
      await save({ ...j, state: "cancelled", stage: "cancelled", words: "Cancelled", podReleased: true, finishedAt: deps.now() });
      return current;
    },
  };
}

export type Trainer = ReturnType<typeof createTrainer>;
