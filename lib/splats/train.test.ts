// Training a splat from a phone video on a rented GPU (RunPod): keys, the
// script's status, how a job moves on, RunPod's API as we call it, and the
// trainer with RunPod and R2 replaced by fakes.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CURRENT_JOB_KEY, LAUNCH_STALE_MS, DEFAULT_GPUS, DEFAULT_IMAGE, POD_BOOT, SILENT_MS, advance, createTrainer, gpuLabel, newJobId, parseStatus, podBody,
  podState, runpodConfigured, trainConfig, trainKeys, trainVideoOf, type TrainDeps, type TrainJob,
} from "./train.ts";
import { RunPodError, runpodClient, type PodCreate, type RunPodLike } from "./runpod.ts";
import { isSplatKey } from "./keys.ts";
import { routeFromCameras } from "./cameras.ts";

const HOUR = 3_600_000;

/** Start a job and wait for its background launch, as the page's next status poll would see it. */
async function launch(tr: ReturnType<typeof createTrainer>, scene: string, video: string, title: string | null) {
  await tr.start(scene, video, title);
  return tr.launched();
}

test("settings: L4 first, then other 24–48 GB GPUs, 4 h, 500 frames, splatfacto-big; env can change them within bounds", () => {
  const c = trainConfig({});
  assert.deepEqual(c.gpus, DEFAULT_GPUS);
  assert.equal(c.gpus[0], "NVIDIA L4");
  assert.equal(c.cloud, "SECURE");
  assert.equal(c.timeoutMs, 4 * HOUR);
  assert.equal(c.image, DEFAULT_IMAGE);
  assert.equal(c.diskGb, 80);
  assert.equal(c.frames, 500);
  assert.equal(c.method, "splatfacto-big");
  assert.equal(trainConfig({ RUNPOD_TRAIN_METHOD: "splatfacto" }).method, "splatfacto");
  assert.equal(trainConfig({ RUNPOD_TRAIN_METHOD: "nerfacto" }).method, "splatfacto-big", "only the two splat methods");
  assert.equal(c.iterations, 30000);
  const d = trainConfig({
    RUNPOD_TRAIN_GPUS: " NVIDIA RTX A5000 ,, NVIDIA L40S", RUNPOD_TRAIN_TIMEOUT_HOURS: "2", RUNPOD_TRAIN_FRAMES: "9999",
    RUNPOD_TRAIN_DISK_GB: "nope", RUNPOD_TRAIN_CLOUD: "community",
  });
  assert.deepEqual(d.gpus, ["NVIDIA RTX A5000", "NVIDIA L40S"]);
  assert.equal(d.timeoutMs, 2 * HOUR);
  assert.equal(d.frames, 500, "out of bounds: the default");
  assert.equal(d.diskGb, 80);
  assert.equal(d.cloud, "COMMUNITY");
  assert.equal(trainConfig({ RUNPOD_TRAIN_CLOUD: "cheap" }).cloud, "SECURE");
  assert.equal(gpuLabel("NVIDIA GeForce RTX 4090"), "RTX 4090");
  assert.equal(gpuLabel("NVIDIA L4"), "L4");
  assert.equal(runpodConfigured({ RUNPOD_API_KEY: " " }), false);
  assert.equal(runpodConfigured({ RUNPOD_API_KEY: "rpa_x" }), true);
});

test("which uploads can be trained from: phone videos under masters/ or scenes/", () => {
  assert.deepEqual(trainVideoOf("masters/store-01/IMG_0421.MOV"), { scene: "store-01", file: "IMG_0421.MOV", ext: "mov" });
  assert.deepEqual(trainVideoOf("scenes/store-01/walk.mp4"), { scene: "store-01", file: "walk.mp4", ext: "mp4" });
  for (const bad of ["masters/store-01/a.ply", "masters/Store/a.mov", "masters/a/../b.mov", "training/a/b.mov", "masters/a/b/c.mov", "masters/a/.mov"]) {
    assert.equal(trainVideoOf(bad), null, bad);
  }
});

test("a job's keys: results under training/, the splat a master like any other", () => {
  const id = newJobId(new Date("2026-10-09T14:22:33.456Z"), () => 0);
  assert.equal(id, "20261009-142233-aaaa");
  assert.match(newJobId(new Date(), Math.random), /^\d{8}-\d{6}-[a-z2-9]{4}$/);
  const k = trainKeys("store-01", id)!;
  assert.equal(k.status, "training/store-01/20261009-142233-aaaa/status.json");
  assert.equal(k.cameras, "training/store-01/20261009-142233-aaaa/cameras.json");
  assert.equal(k.log, "training/store-01/20261009-142233-aaaa/train.log");
  assert.equal(k.ply, "masters/store-01/store-01-20261009-142233-aaaa-trained.ply");
  assert.equal(isSplatKey(k.ply), "master", "the page lists it and can hand out its download link");
  assert.equal(isSplatKey(k.status), null);
  assert.ok(!k.status.startsWith("masters/") && !k.status.startsWith("scenes/"), "not in «Files in R2»");
  assert.ok(!CURRENT_JOB_KEY.startsWith("masters/"));
  assert.equal(trainKeys("Store", id), null);
  assert.equal(trainKeys("store-01", "../x"), null);
});

test("status.json: what the script wrote, made safe; anything else is no status", () => {
  const s = parseStatus(JSON.stringify({ v: 1, stage: "training", words: "Training", percent: 140, error: "", log: ["a", 3, "b"], updatedAt: "2026-10-09T14:00:00Z" }))!;
  assert.equal(s.stage, "training");
  assert.equal(s.percent, 100, "clamped");
  assert.equal(s.error, null);
  assert.deepEqual(s.log, ["a", "b"]);
  assert.equal(parseStatus(JSON.stringify({ stage: "failed", error: "x".repeat(5000) }))!.error!.length, 1000);
  assert.equal(parseStatus(JSON.stringify({ stage: "hacking" })), null);
  assert.equal(parseStatus("<html>"), null);
  assert.equal(parseStatus(null), null);
  assert.equal(parseStatus("null"), null);
  assert.deepEqual(parseStatus(JSON.stringify({ stage: "matching", log: Array.from({ length: 40 }, (_, i) => `l${i}`) }))!.log.length, 15);
});

function job(p: Partial<TrainJob> = {}): TrainJob {
  return {
    id: "20261009-142233-aaaa", scene: "store-01", video: "masters/store-01/v.mov", title: null, gpu: "L4", timeoutMs: 3 * HOUR,
    podId: "pod-1", costPerHour: 0.39, podReleased: false, state: "running", stage: "starting", words: "", percent: null, log: [], startedAt: 0, finishedAt: null,
    error: null, keys: trainKeys("store-01", "20261009-142233-aaaa")!, webKey: null, routePoints: null, warning: null, ...p,
  };
}
const st = (p: object) => parseStatus(JSON.stringify({ stage: "training", ...p }));

test("how a job moves on", () => {
  // Running: the script's stage and progress are shown.
  let j = advance(job({ state: "starting" }), st({ percent: 42.5, log: ["x"] }), "up", 10);
  assert.equal(j.state, "running");
  assert.equal(j.percent, 42.5);
  assert.deepEqual(j.log, ["x"]);
  // Done: hand over, whether the pod is still up or has already deleted itself.
  for (const pod of ["up", "gone", "stopped"] as const) assert.equal(advance(job(), st({ stage: "done" }), pod, 10).state, "finishing", pod);
  // It said why it failed.
  j = advance(job(), st({ stage: "failed", error: "COLMAP could not work out where the phone was." }), "gone", 99);
  assert.equal(j.state, "failed");
  assert.equal(j.error, "COLMAP could not work out where the phone was.");
  assert.equal(j.finishedAt, 99);
  // The pod went away, or stopped, without a result.
  assert.match(advance(job(), st({}), "gone", 10).error!, /gone/);
  assert.match(advance(job(), null, "stopped", 10).error!, /stopped before/);
  // RunPod has no time limit: ours.
  assert.equal(advance(job(), st({}), "up", 3 * HOUR - 1).state, "running");
  assert.match(advance(job(), st({}), "up", 3 * HOUR).error!, /time limit \(3 h\)/);
  // Never a word from the pod.
  assert.equal(advance(job(), null, "up", SILENT_MS - 1).state, "running");
  assert.match(advance(job(), null, "up", SILENT_MS).error!, /never reported back/);
  // Finished jobs, and one being handed over, stay as they are.
  for (const state of ["done", "failed", "cancelled", "finishing"] as const) {
    const before = job({ state });
    assert.equal(advance(before, st({ stage: "failed", error: "late" }), "gone", 10), before);
  }
  assert.equal(podState(null), "gone");
  assert.equal(podState({ id: "p", status: "TERMINATED", cost: 0 }), "gone");
  assert.equal(podState({ id: "p", status: "EXITED", cost: 0 }), "stopped");
  assert.equal(podState({ id: "p", status: "ERROR", cost: 0 }), "stopped");
  for (const status of ["PROVISIONING", "STARTING", "RUNNING", "SOMETHING_NEW"]) assert.equal(podState({ id: "p", status, cost: 0.4 }), "up", status);
});

const URLS = { video: "https://r2/v?sig", status: "https://r2/s?sig", statusGet: "https://r2/s?get", ply: "https://r2/p?sig", cameras: "https://r2/c?sig", log: "https://r2/l?sig" };

test("the pod gets presigned URLs and the scripts, never a key; it idles when the script ends", () => {
  const c = trainConfig({});
  const p = podBody(c, "NVIDIA L4", job(), URLS, { sh: "echo hi", py: "print('ü')" });
  assert.deepEqual(p.gpu, { id: "NVIDIA L4", count: 1 });
  assert.equal(p.cloud, "SECURE");
  assert.equal(p.image, DEFAULT_IMAGE);
  assert.equal(p.disk, 80);
  assert.equal(p.name, "sk-train-store-01-20261009-142233-aaaa");
  assert.deepEqual(p.entrypoint, ["bash", "-c", POD_BOOT]);
  assert.deepEqual(p.cmd, []);
  assert.match(POD_BOOT, /exec sleep infinity$/, "RunPod restarts a container whose command ends");
  assert.equal(p.env.SK_VIDEO_EXT, "mov");
  assert.equal(p.env.SK_STATUS_URL, "https://r2/s?sig");
  assert.equal(p.env.SK_STATUS_GET_URL, "https://r2/s?get");
  assert.equal(p.env.SK_TIMEOUT_S, "14400");
  assert.equal(p.env.SK_METHOD, "splatfacto-big");
  assert.equal(p.env.SK_FRAMES, "500");
  assert.equal(Buffer.from(p.env.SK_TRAIN_SH_B64, "base64").toString("utf8"), "echo hi");
  assert.equal(Buffer.from(p.env.SK_FRAME_PY_B64, "base64").toString("utf8"), "print('ü')");
  assert.ok(Object.keys(p.env).every((k) => !/^(R2|AWS|MODAL|RUNPOD)_/.test(k)), "RunPod injects its own pod-scoped RUNPOD_API_KEY; ours must not be sent");
  assert.ok(Object.values(p.env).every((v) => typeof v === "string"));
});

test("the real scripts fit RunPod's 100 KB body limit, with long presigned URLs", () => {
  const sh = readFileSync(new URL("../../scripts/splats/gpu-train.sh", import.meta.url), "utf8");
  const py = readFileSync(new URL("../../scripts/splats/gpu-frame.py", import.meta.url), "utf8");
  const long = "https://acct.r2.cloudflarestorage.com/masters/x?" + "X-Amz-Signature=".padEnd(900, "a");
  const body = podBody(trainConfig({}), "NVIDIA L4", job(), { video: long, status: long, statusGet: long, ply: long, cameras: long, log: long }, { sh, py });
  const bytes = Buffer.byteLength(JSON.stringify(body));
  assert.ok(bytes < 100 * 1024, `${bytes} bytes`);
  assert.ok(bytes < 70 * 1024, `${bytes} bytes: room left to grow`);
});

test("RunPod's API as we call it: v2, bearer key, errors in RunPod's words", async () => {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const answers: { status: number; body: string }[] = [];
  const rp = runpodClient("rpa_secret", async (url, init) => {
    seen.push({ url, ...init });
    const a = answers.shift()!;
    return { status: a.status, text: async () => a.body };
  });
  const body: PodCreate = podBody(trainConfig({}), "NVIDIA L4", job(), URLS, { sh: "x", py: "y" });

  answers.push({ status: 201, body: JSON.stringify({ id: "abc123", status: "PROVISIONING", cost: 0.39, env: {} }) });
  assert.deepEqual(await rp.create(body), { id: "abc123", status: "PROVISIONING", cost: 0.39 });
  assert.equal(seen[0].url, "https://api.runpod.io/v2/pods");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].headers.Authorization, "Bearer rpa_secret");
  assert.equal(seen[0].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(seen[0].body!), body);

  answers.push({ status: 200, body: JSON.stringify({ id: "abc123", status: "RUNNING", cost: 0.39 }) });
  assert.equal((await rp.get("abc123"))!.status, "RUNNING");
  assert.equal(seen[1].url, "https://api.runpod.io/v2/pods/abc123");
  assert.equal(seen[1].method, "GET");
  answers.push({ status: 404, body: JSON.stringify({ title: "Not Found", status: 404, detail: "pod not found" }) });
  assert.equal(await rp.get("abc123"), null);

  answers.push({ status: 204, body: "" });
  await rp.terminate("abc123");
  assert.equal(seen[3].method, "DELETE");
  answers.push({ status: 404, body: "" });
  await rp.terminate("abc123"); // already gone: fine

  answers.push({ status: 400, body: JSON.stringify({ title: "Bad Request", status: 400, detail: "no capacity for NVIDIA L4 in SECURE cloud" }) });
  await assert.rejects(rp.create(body), (e: RunPodError) => e.status === 400 && e.message === "no capacity for NVIDIA L4 in SECURE cloud (HTTP 400)");
  answers.push({ status: 422, body: JSON.stringify({ title: "Unprocessable", status: 422, detail: "invalid body", errors: ["$: additional properties 'bogus' not allowed"] }) });
  await assert.rejects(rp.create(body), /invalid body; \$: additional properties 'bogus' not allowed \(HTTP 422\)/);
  answers.push({ status: 502, body: "<html>bad gateway</html>" });
  await assert.rejects(rp.get("abc123"), /HTTP 502: <html>bad gateway/);
  answers.push({ status: 500, body: "" });
  await assert.rejects(rp.terminate("abc123"), /HTTP 500/);
});

// ── The trainer, with fakes ─────────────────────────────────────────────────

function fakes(opts: { configured?: boolean; refuse?: Record<string, { status: number; message: string }>; createGate?: Promise<void>; terminateFails?: number } = {}) {
  const r2 = new Map<string, string>();
  const calls: string[] = [];
  const pods = new Map<string, string>(); // id → status
  const created: PodCreate[] = [];
  let terminateFails = opts.terminateFails ?? 0;
  let n = 0;
  const runpod: RunPodLike = {
    create: async (body) => {
      calls.push(`create ${body.gpu.id}`);
      if (opts.createGate) await opts.createGate;
      const no = opts.refuse?.[body.gpu.id];
      if (no) throw new RunPodError(no.status, no.message);
      created.push(body);
      const id = `pod-${++n}`;
      pods.set(id, "PROVISIONING");
      return { id, status: "PROVISIONING", cost: 0.39 };
    },
    get: async (id) => (pods.has(id) ? { id, status: pods.get(id)!, cost: 0.39 } : null),
    terminate: async (id) => {
      calls.push(`terminate ${id}`);
      if (terminateFails > 0) {
        terminateFails--;
        throw new RunPodError(503, "RunPod is busy (HTTP 503)");
      }
      pods.delete(id);
    },
  };
  let t = Date.UTC(2026, 9, 9, 14, 0, 0);
  const handed: TrainJob[] = [];
  const deps: TrainDeps = {
    config: trainConfig({}),
    runpod: () => runpod,
    configured: () => opts.configured ?? true,
    store: {
      presignGet: async (key, secs) => `https://r2.example/${key}?get&exp=${secs}`,
      presignPut: async (key, secs) => `https://r2.example/${key}?put&exp=${secs}`,
      readText: async (key) => r2.get(key) ?? null,
      saveJob: async (j) => { r2.set(CURRENT_JOB_KEY, JSON.stringify(j)); },
      loadJob: async () => (r2.has(CURRENT_JOB_KEY) ? JSON.parse(r2.get(CURRENT_JOB_KEY)!) : null),
    },
    scripts: () => ({ sh: "#!/bin/bash\necho train", py: "print(1)" }),
    handoff: async (j) => { handed.push(j); return { webKey: "scenes/store-01/store-01-x.spz", routePoints: 12, warning: null }; },
    now: () => t,
    random: () => 0.5,
  };
  return { deps, r2, calls, pods, handed, created, advanceClock: (ms: number) => { t += ms; } };
}
const settle = () => new Promise((r) => setImmediate(r));

test("trainer: start, report, finish, stop the pod and hand over", async () => {
  const f = fakes();
  const tr = createTrainer(f.deps);
  const j = await launch(tr, "store-01", "masters/store-01/IMG_1.mov", " Our store ");
  assert.equal(j.state, "running");
  assert.equal(j.podId, "pod-1");
  assert.equal(j.gpu, "L4");
  assert.equal(j.costPerHour, 0.39);
  assert.equal(j.podReleased, false);
  assert.equal(j.title, "Our store");
  assert.deepEqual(f.calls, ["create NVIDIA L4"]);
  const p = f.created[0];
  // Every link outlives the 4 h limit by an hour.
  assert.equal(p.env.SK_VIDEO_URL, "https://r2.example/masters/store-01/IMG_1.mov?get&exp=18000");
  assert.equal(p.env.SK_PLY_URL, `https://r2.example/${j.keys.ply}?put&exp=18000`);
  assert.equal(p.env.SK_STATUS_GET_URL, `https://r2.example/${j.keys.status}?get&exp=18000`);
  assert.ok(f.r2.has(CURRENT_JOB_KEY), "kept in R2 too");

  // One at a time.
  await assert.rejects(tr.start("store-02", "scenes/store-02/a.mp4", null), (e: Error & { status?: number }) => e.status === 409 && /still training/.test(e.message));

  // The script reports.
  f.pods.set("pod-1", "RUNNING");
  f.r2.set(j.keys.status, JSON.stringify({ stage: "training", words: "Training the splat", percent: 37, log: ["12000 (37.00%)"] }));
  let now = (await tr.status())!;
  assert.equal(now.state, "running");
  assert.equal(now.percent, 37);
  assert.equal(now.words, "Training the splat");

  // It finishes: the pod is terminated at once, and the hand-over runs, once.
  f.r2.set(j.keys.status, JSON.stringify({ stage: "done", words: "Done", percent: 100 }));
  f.advanceClock(50 * 60_000);
  now = (await tr.status())!;
  assert.equal(now.state, "finishing");
  assert.equal(now.podReleased, true);
  assert.ok(!f.pods.has("pod-1"), "no GPU billed during the hand-over");
  await tr.status();
  await settle();
  assert.equal(f.handed.length, 1);
  now = (await tr.status())!;
  assert.equal(now.state, "done");
  assert.equal(now.webKey, "scenes/store-01/store-01-x.spz");
  assert.equal(now.routePoints, 12);
  assert.equal(now.finishedAt! - now.startedAt, 50 * 60_000);
  assert.equal(f.calls.filter((c) => c.startsWith("terminate")).length, 1);

  // And the next one may start.
  const next = await launch(tr, "store-02", "scenes/store-02/a.mp4", null);
  assert.equal(next.state, "running");
  assert.equal(next.scene, "store-02");
});

test("trainer: no L4 free → the next GPU in the list", async () => {
  const f = fakes({ refuse: { "NVIDIA L4": { status: 400, message: "no capacity (HTTP 400)" }, "NVIDIA RTX A5000": { status: 500, message: "oops (HTTP 500)" } } });
  const j = await launch(createTrainer(f.deps), "store-01", "masters/store-01/a.mov", null);
  assert.deepEqual(f.calls, ["create NVIDIA L4", "create NVIDIA RTX A5000", "create NVIDIA GeForce RTX 4090"]);
  assert.equal(j.state, "running");
  assert.equal(j.gpu, "RTX 4090");
});

test("trainer: no GPU free at all, or a bad key, is a failed job that says why — not a stuck one", async () => {
  const none = Object.fromEntries(DEFAULT_GPUS.map((g) => [g, { status: 400, message: "no capacity (HTTP 400)" }]));
  const f = fakes({ refuse: none });
  const j = await launch(createTrainer(f.deps), "store-01", "masters/store-01/a.mov", null);
  assert.equal(j.state, "failed");
  assert.match(j.error!, /^RunPod refused to start the training: no GPU free right now — L4: no capacity/);
  assert.match(j.error!, /L40S: no capacity/);
  assert.equal(JSON.parse(f.r2.get(CURRENT_JOB_KEY)!).state, "failed");

  // A refused key is the same for every GPU: asked once.
  const k = fakes({ refuse: { "NVIDIA L4": { status: 401, message: "invalid api key (HTTP 401)" } } });
  const kj = await launch(createTrainer(k.deps), "store-01", "masters/store-01/a.mov", null);
  assert.deepEqual(k.calls, ["create NVIDIA L4"]);
  assert.match(kj.error!, /invalid api key/);
});

test("trainer: refused without RunPod's key, or for a file that is not a video", async () => {
  const tr = createTrainer(fakes({ configured: false }).deps);
  await assert.rejects(tr.start("store-01", "masters/store-01/a.mov", null), (e: Error & { status?: number }) => e.status === 503 && /RUNPOD_API_KEY/.test(e.message));
  const ok = createTrainer(fakes().deps);
  await assert.rejects(ok.start("store-01", "masters/store-01/a.ply", null), (e: Error & { status?: number }) => e.status === 400);
  await assert.rejects(ok.start("Store 1", "masters/store-01/a.mov", null), (e: Error & { status?: number }) => e.status === 400);
});

test("trainer: cancel terminates the pod", async () => {
  const f = fakes();
  const tr = createTrainer(f.deps);
  await launch(tr, "store-01", "masters/store-01/a.mov", null);
  const c = (await tr.cancel())!;
  assert.equal(c.state, "cancelled");
  assert.equal(c.podReleased, true);
  assert.equal(f.pods.size, 0);
  assert.equal((await tr.status())!.state, "cancelled", "stays cancelled");
});

test("trainer: the time limit is ours — the pod is failed and terminated", async () => {
  const f = fakes();
  const tr = createTrainer(f.deps);
  await launch(tr, "store-01", "masters/store-01/a.mov", null);
  f.pods.set("pod-1", "RUNNING");
  f.r2.set(trainKeys("store-01", (await tr.status())!.id)!.status, JSON.stringify({ stage: "training", percent: 80 }));
  f.advanceClock(4 * HOUR);
  const j = (await tr.status())!;
  assert.equal(j.state, "failed");
  assert.match(j.error!, /time limit/);
  assert.equal(f.pods.size, 0);
});

test("trainer: RunPod unreachable when the pod should stop → tried again until it is", async () => {
  const f = fakes({ terminateFails: 2 });
  const tr = createTrainer(f.deps);
  const j = await launch(tr, "store-01", "masters/store-01/a.mov", null);
  f.r2.set(j.keys.status, JSON.stringify({ stage: "failed", error: "COLMAP gave up." }));
  let now = (await tr.status())!;
  assert.equal(now.state, "failed");
  assert.equal(now.error, "COLMAP gave up.");
  assert.equal(now.podReleased, false);
  assert.match(now.warning!, /could not be stopped yet/);
  assert.ok(f.pods.has("pod-1"));
  // A redeploy in between: the record in R2 still knows the pod must go.
  const again = createTrainer(f.deps);
  now = (await again.status())!;
  assert.equal(now.podReleased, false);
  now = (await again.status())!;
  assert.equal(now.podReleased, true);
  assert.equal(f.pods.size, 0);
  assert.equal(now.state, "failed", "still failed, for its reason");
  assert.equal(now.error, "COLMAP gave up.");
});

test("trainer: a pod that disappears without a result is failed; an unreadable status.json is not judged", async () => {
  const f = fakes();
  const tr = createTrainer(f.deps);
  const j = await launch(tr, "store-01", "masters/store-01/a.mov", null);
  f.pods.delete("pod-1");
  const realRead = f.deps.store.readText;
  f.deps.store.readText = async () => { throw new Error("R2 busy"); };
  assert.equal((await tr.status())!.state, "running", "R2 busy: ask again later");
  f.deps.store.readText = realRead;
  const now = (await tr.status())!;
  assert.equal(now.state, "failed");
  assert.match(now.error!, /gone/);
  assert.equal(now.id, j.id);
});

test("trainer: a restarted server picks the job up from R2, failure reason included", async () => {
  const f = fakes();
  await launch(createTrainer(f.deps), "store-01", "masters/store-01/a.mov", null);
  const again = createTrainer(f.deps); // a redeploy: nothing in memory
  const j = (await again.status())!;
  assert.equal(j.state, "running");
  await assert.rejects(again.start("store-02", "scenes/store-02/a.mp4", null), /still training/);
  f.r2.set(j.keys.status, JSON.stringify({ stage: "failed", error: "Training stopped with an error (see the log)." }));
  const failed = (await again.status())!;
  assert.equal(failed.state, "failed");
  assert.equal(failed.error, "Training stopped with an error (see the log).");
  assert.equal(f.pods.size, 0);
});

test("trainer: a record from the Modal days loads as finished, with no pod to stop", async () => {
  const f = fakes();
  f.r2.set(CURRENT_JOB_KEY, JSON.stringify({ ...job({ state: "failed" }), podId: undefined, costPerHour: undefined, podReleased: undefined, sandboxId: null }));
  const tr = createTrainer(f.deps);
  const j = (await tr.status())!;
  assert.equal(j.state, "failed");
  assert.equal(j.podReleased, true);
  assert.deepEqual(f.calls, []);
  assert.equal((await launch(tr, "store-01", "masters/store-01/a.mov", null)).state, "running");
});

test("trainer: after a restart mid hand-over, the hand-over runs again", async () => {
  const f = fakes();
  const j = await launch(createTrainer(f.deps), "store-01", "masters/store-01/a.mov", null);
  f.r2.set(CURRENT_JOB_KEY, JSON.stringify({ ...j, state: "finishing" }));
  const again = createTrainer(f.deps);
  const now = (await again.status())!;
  assert.equal(now.state, "finishing");
  assert.equal(now.podReleased, true, "and its pod, still up, is stopped");
  await settle();
  assert.equal(f.handed.length, 1);
  assert.equal((await again.status())!.state, "done");
});

test("trainer: a failed hand-over says where the splat is", async () => {
  const f = fakes();
  f.deps.handoff = async () => { throw new Error("out of memory"); };
  const tr = createTrainer(f.deps);
  const j = await launch(tr, "store-01", "masters/store-01/a.mov", null);
  f.r2.set(j.keys.status, JSON.stringify({ stage: "done" }));
  await tr.status();
  await settle();
  const now = (await tr.status())!;
  assert.equal(now.state, "failed");
  assert.match(now.error!, /out of memory/);
  assert.ok(now.error!.includes(j.keys.ply));
});

test("cameras.json as gpu-frame.py writes it becomes a route", () => {
  const cameras = Array.from({ length: 20 }, (_, i) => ({ id: i, img_name: `frame_${String(i + 1).padStart(5, "0")}.png`, position: [i * 0.3, 0.2, -i * 0.4] }));
  const r = routeFromCameras({ frame: "colmap", cameras: [...cameras].reverse() }, true)!;
  assert.equal(r.cameras, 20);
  assert.deepEqual(r.route[0], [0, -0.2, 0], "filming order, turned upright as the splat is (flip)");
  assert.ok(r.route.length >= 10);
});

test("trainer: «Train» answers before RunPod does (the CDN gives up after ~100 s)", async () => {
  let release!: () => void;
  const f = fakes({ createGate: new Promise<void>((ok) => { release = ok; }) });
  const tr = createTrainer(f.deps);
  const j = await tr.start("store-01", "masters/store-01/a.mov", null);
  assert.equal(j.state, "starting");
  assert.equal(j.podId, null);
  // A status poll meanwhile neither fails it nor lets a second job start.
  assert.equal((await tr.status())!.state, "starting");
  await assert.rejects(tr.start("store-02", "scenes/store-02/a.mp4", null), /still training/);
  release();
  const after = await tr.launched();
  assert.equal(after!.state, "running");
  assert.equal(after!.podId, "pod-1");
});

test("trainer: cancelled while RunPod is still creating it, the pod is terminated as soon as it exists", async () => {
  let release!: () => void;
  const f = fakes({ createGate: new Promise<void>((ok) => { release = ok; }) });
  const tr = createTrainer(f.deps);
  await tr.start("store-01", "masters/store-01/a.mov", null);
  assert.equal((await tr.cancel())!.state, "cancelled");
  release();
  const after = await tr.launched();
  assert.equal(after!.state, "cancelled");
  assert.equal(after!.podId, "pod-1");
  assert.equal(after!.podReleased, true);
  assert.equal(f.pods.size, 0);
});

test("trainer: cancelled mid-create and RunPod busy → the watcher still terminates the pod", async () => {
  let release!: () => void;
  const f = fakes({ createGate: new Promise<void>((ok) => { release = ok; }), terminateFails: 1 });
  const tr = createTrainer(f.deps);
  await tr.start("store-01", "masters/store-01/a.mov", null);
  await tr.cancel();
  release();
  assert.equal((await tr.launched())!.podReleased, false);
  const now = (await tr.status())!;
  assert.equal(now.state, "cancelled");
  assert.equal(now.podReleased, true);
  assert.equal(f.pods.size, 0);
});

test("trainer: a launch lost to a restart is failed after a while, so «Train» works again", async () => {
  let release!: () => void;
  const f = fakes({ createGate: new Promise<void>((ok) => { release = ok; }) });
  await createTrainer(f.deps).start("store-01", "masters/store-01/a.mov", null);
  // A new process (the redeploy) finds the job without a pod.
  const again = createTrainer(f.deps);
  assert.equal((await again.status())!.state, "starting");
  f.advanceClock(LAUNCH_STALE_MS + 1);
  const stale = await again.status();
  assert.equal(stale!.state, "failed");
  assert.match(stale!.error!, /restarted/);
  release();
});
