// Training a splat from a phone video on a rented GPU (Modal): keys, the
// sandbox's status, how a job moves on, and the trainer with Modal and R2
// replaced by fakes.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_JOB_KEY, LAUNCH_STALE_MS, DEFAULT_IMAGE, IMAGE_COMMANDS, advance, createTrainer, modalConfigured, newJobId, parseStatus, sandboxParams,
  trainConfig, trainKeys, trainVideoOf, type ModalLike, type TrainDeps, type TrainJob,
} from "./train.ts";
import { isSplatKey } from "./keys.ts";
import { routeFromCameras } from "./cameras.ts";

const HOUR = 3_600_000;

/** Start a job and wait for its background launch, as the page's next status poll would see it. */
async function launch(tr: ReturnType<typeof createTrainer>, scene: string, video: string, title: string | null) {
  await tr.start(scene, video, title);
  return tr.launched();
}

test("settings: L4 for 3 h by default, env can change them within bounds", () => {
  const c = trainConfig({});
  assert.equal(c.gpu, "L4");
  assert.equal(c.gpuPricePerHour, 0.8);
  assert.equal(c.timeoutMs, 3 * HOUR);
  assert.equal(c.image, DEFAULT_IMAGE);
  assert.equal(c.frames, 350);
  assert.equal(c.iterations, 30000);
  const d = trainConfig({ MODAL_TRAIN_GPU: "A10G", MODAL_TRAIN_TIMEOUT_HOURS: "2", MODAL_TRAIN_FRAMES: "9999", MODAL_TRAIN_CPU: "nope" });
  assert.equal(d.gpu, "A10G");
  assert.equal(d.timeoutMs, 2 * HOUR);
  assert.equal(d.frames, 350, "out of bounds: the default");
  assert.equal(d.cpu, 4);
  assert.equal(trainConfig({ MODAL_TRAIN_GPU: "B300" }).gpuPricePerHour, null, "unknown GPU: no price shown");
  assert.equal(modalConfigured({ MODAL_TOKEN_ID: "ak-1", MODAL_TOKEN_SECRET: " " }), false);
  assert.equal(modalConfigured({ MODAL_TOKEN_ID: "ak-1", MODAL_TOKEN_SECRET: "as-2" }), true);
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

test("status.json: what the sandbox wrote, made safe; anything else is no status", () => {
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
    sandboxId: "sb-1", state: "running", stage: "starting", words: "", percent: null, log: [], startedAt: 0, finishedAt: null,
    error: null, keys: trainKeys("store-01", "20261009-142233-aaaa")!, webKey: null, routePoints: null, warning: null, ...p,
  };
}
const st = (p: object) => parseStatus(JSON.stringify({ stage: "training", ...p }));

test("how a job moves on", () => {
  // Running: the sandbox's stage and progress are shown.
  let j = advance(job({ state: "starting" }), st({ percent: 42.5, log: ["x"] }), null, 10);
  assert.equal(j.state, "running");
  assert.equal(j.percent, 42.5);
  assert.deepEqual(j.log, ["x"]);
  // Done and exited cleanly (or already gone): hand over.
  assert.equal(advance(job(), st({ stage: "done" }), 0, 10).state, "finishing");
  assert.equal(advance(job(), st({ stage: "done" }), "gone", 10).state, "finishing");
  // It said why it failed.
  j = advance(job(), st({ stage: "failed", error: "COLMAP could not work out where the phone was." }), 1, 99);
  assert.equal(j.state, "failed");
  assert.equal(j.error, "COLMAP could not work out where the phone was.");
  assert.equal(j.finishedAt, 99);
  // Killed by Modal's time limit (poll() answers 124) before it could say anything.
  assert.match(advance(job(), st({}), 124, 10).error!, /time limit \(3 h\)/);
  assert.match(advance(job(), null, 137, 3 * HOUR).error!, /time limit/);
  assert.match(advance(job(), null, 1, 10).error!, /exit 1/);
  assert.match(advance(job(), null, "gone", 10).error!, /gone/);
  // «done» written but a non-zero exit is not a success.
  assert.equal(advance(job(), st({ stage: "done" }), 2, 10).state, "failed");
  // Finished jobs, and one being handed over, stay as they are.
  for (const state of ["done", "failed", "cancelled", "finishing"] as const) {
    const before = job({ state });
    assert.equal(advance(before, st({ stage: "failed", error: "late" }), 1, 10), before);
  }
});

test("the sandbox gets presigned URLs and the scripts, never an R2 credential", () => {
  const c = trainConfig({});
  const p = sandboxParams(c, job(), { video: "https://r2/v?sig", status: "https://r2/s?sig", ply: "https://r2/p?sig", cameras: "https://r2/c?sig", log: "https://r2/l?sig" }, { sh: "echo hi", py: "print('ü')" });
  assert.equal(p.gpu, "L4");
  assert.equal(p.timeoutMs, 3 * HOUR);
  assert.deepEqual(p.command, ["bash", "-c", "echo hi", "modal-train"]);
  assert.equal(p.env.SK_VIDEO_EXT, "mov");
  assert.equal(p.env.SK_STATUS_URL, "https://r2/s?sig");
  assert.equal(Buffer.from(p.env.SK_FRAME_PY_B64, "base64").toString("utf8"), "print('ü')");
  assert.ok(Object.keys(p.env).every((k) => !/^(R2|AWS|MODAL)_/.test(k)));
  assert.deepEqual(p.tags, { purpose: "splat-train", scene: "store-01", job: "20261009-142233-aaaa" });
});

// ── The trainer, with fakes ─────────────────────────────────────────────────

function fakes(opts: { configured?: boolean; createFails?: boolean; createGate?: Promise<void> } = {}) {
  const r2 = new Map<string, string>();
  const calls: string[] = [];
  const sandbox = { exit: null as number | null, terminated: false };
  let created: Record<string, any> | null = null;
  const modal: ModalLike = {
    apps: { fromName: async (name, p) => { calls.push(`app ${name} ${p?.createIfMissing}`); return { appId: "ap-1" }; } },
    images: {
      fromRegistry: (tag) => {
        calls.push(`image ${tag}`);
        return { dockerfileCommands: (c: string[]) => { calls.push(`layer ${c.length}`); return { tag }; } };
      },
    },
    sandboxes: {
      create: async (_app, _image, params) => {
        if (opts.createGate) await opts.createGate;
        if (opts.createFails) throw new Error("no GPUs left");
        created = params;
        return { sandboxId: "sb-42" };
      },
      fromId: async (id) => {
        if (id !== "sb-42") throw Object.assign(new Error("gone"), { name: "NotFoundError" });
        return {
          poll: async () => sandbox.exit,
          terminate: async () => { sandbox.terminated = true; sandbox.exit = 137; },
        };
      },
    },
  };
  let t = Date.UTC(2026, 9, 9, 14, 0, 0);
  const handed: TrainJob[] = [];
  const deps: TrainDeps = {
    config: trainConfig({}),
    modal: async () => modal,
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
  return { deps, r2, calls, sandbox, handed, created: () => created, advanceClock: (ms: number) => { t += ms; } };
}
const settle = () => new Promise((r) => setImmediate(r));

test("trainer: start, report, finish and hand over", async () => {
  const f = fakes();
  const tr = createTrainer(f.deps);
  const j = await launch(tr, "store-01", "masters/store-01/IMG_1.mov", " Our store ");
  assert.equal(j.state, "running");
  assert.equal(j.sandboxId, "sb-42");
  assert.equal(j.title, "Our store");
  assert.deepEqual(f.calls, ["app sarekooche-splat-train true", `image ${DEFAULT_IMAGE}`, `layer ${IMAGE_COMMANDS.length}`]);
  const p = f.created()!;
  assert.equal(p.gpu, "L4");
  // Every link outlives the 3 h limit by an hour.
  assert.equal(p.env.SK_VIDEO_URL, "https://r2.example/masters/store-01/IMG_1.mov?get&exp=14400");
  assert.equal(p.env.SK_PLY_URL, `https://r2.example/${j.keys.ply}?put&exp=14400`);
  assert.ok(f.r2.has(CURRENT_JOB_KEY), "kept in R2 too");

  // One at a time.
  await assert.rejects(tr.start("store-02", "scenes/store-02/a.mp4", null), (e: Error & { status?: number }) => e.status === 409 && /still training/.test(e.message));

  // The sandbox reports.
  f.r2.set(j.keys.status, JSON.stringify({ stage: "training", words: "Training the splat", percent: 37, log: ["12000 (37.00%)"] }));
  let now = (await tr.status())!;
  assert.equal(now.state, "running");
  assert.equal(now.percent, 37);
  assert.equal(now.words, "Training the splat");

  // It finishes: hand over, once.
  f.r2.set(j.keys.status, JSON.stringify({ stage: "done", words: "Done", percent: 100 }));
  f.sandbox.exit = 0;
  f.advanceClock(50 * 60_000);
  now = (await tr.status())!;
  assert.equal(now.state, "finishing");
  await tr.status();
  await settle();
  assert.equal(f.handed.length, 1);
  now = (await tr.status())!;
  assert.equal(now.state, "done");
  assert.equal(now.webKey, "scenes/store-01/store-01-x.spz");
  assert.equal(now.routePoints, 12);
  assert.equal(now.finishedAt! - now.startedAt, 50 * 60_000);

  // And the next one may start.
  const next = await launch(tr, "store-02", "scenes/store-02/a.mp4", null);
  assert.equal(next.state, "running");
  assert.equal(next.scene, "store-02");
});

test("trainer: refused without Modal's token, or for a file that is not a video", async () => {
  const tr = createTrainer(fakes({ configured: false }).deps);
  await assert.rejects(tr.start("store-01", "masters/store-01/a.mov", null), (e: Error & { status?: number }) => e.status === 503 && /MODAL_TOKEN_ID/.test(e.message));
  const ok = createTrainer(fakes().deps);
  await assert.rejects(ok.start("store-01", "masters/store-01/a.ply", null), (e: Error & { status?: number }) => e.status === 400);
  await assert.rejects(ok.start("Store 1", "masters/store-01/a.mov", null), (e: Error & { status?: number }) => e.status === 400);
});

test("trainer: Modal refusing to start is a failed job, not a stuck one", async () => {
  const f = fakes({ createFails: true });
  const tr = createTrainer(f.deps);
  const j = await launch(tr, "store-01", "masters/store-01/a.mov", null);
  assert.equal(j.state, "failed");
  assert.match(j.error!, /no GPUs left/);
  assert.equal(JSON.parse(f.r2.get(CURRENT_JOB_KEY)!).state, "failed");
});

test("trainer: cancel stops the sandbox", async () => {
  const f = fakes();
  const tr = createTrainer(f.deps);
  await launch(tr, "store-01", "masters/store-01/a.mov", null);
  const c = (await tr.cancel())!;
  assert.equal(c.state, "cancelled");
  assert.ok(f.sandbox.terminated);
  assert.equal((await tr.status())!.state, "cancelled", "stays cancelled");
});

test("trainer: a restarted server picks the job up from R2, failure reason included", async () => {
  const f = fakes();
  await launch(createTrainer(f.deps), "store-01", "masters/store-01/a.mov", null);
  const again = createTrainer(f.deps); // a redeploy: nothing in memory
  const j = (await again.status())!;
  assert.equal(j.state, "running");
  await assert.rejects(again.start("store-02", "scenes/store-02/a.mp4", null), /still training/);
  const key = j.keys.status;
  f.r2.set(key, JSON.stringify({ stage: "failed", error: "Training stopped with an error (see the log)." }));
  f.sandbox.exit = 1;
  const failed = (await again.status())!;
  assert.equal(failed.state, "failed");
  assert.equal(failed.error, "Training stopped with an error (see the log).");
});

test("trainer: after a restart mid hand-over, the hand-over runs again", async () => {
  const f = fakes();
  const j = await launch(createTrainer(f.deps), "store-01", "masters/store-01/a.mov", null);
  f.r2.set(CURRENT_JOB_KEY, JSON.stringify({ ...j, state: "finishing" }));
  const again = createTrainer(f.deps);
  assert.equal((await again.status())!.state, "finishing");
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
  f.sandbox.exit = 0;
  await tr.status();
  await settle();
  const now = (await tr.status())!;
  assert.equal(now.state, "failed");
  assert.match(now.error!, /out of memory/);
  assert.ok(now.error!.includes(j.keys.ply));
});

test("cameras.json as modal-frame.py writes it becomes a route", () => {
  const cameras = Array.from({ length: 20 }, (_, i) => ({ id: i, img_name: `frame_${String(i + 1).padStart(5, "0")}.png`, position: [i * 0.3, 0.2, -i * 0.4] }));
  const r = routeFromCameras({ frame: "colmap", cameras: [...cameras].reverse() }, true)!;
  assert.equal(r.cameras, 20);
  assert.deepEqual(r.route[0], [0, -0.2, 0], "filming order, turned upright as the splat is (flip)");
  assert.ok(r.route.length >= 10);
});

test("trainer: «Train» answers before Modal does (the first image pull outlasts the CDN's ~100 s)", async () => {
  let release!: () => void;
  const f = fakes({ createGate: new Promise<void>((ok) => { release = ok; }) });
  const tr = createTrainer(f.deps);
  const j = await tr.start("store-01", "masters/store-01/a.mov", null);
  assert.equal(j.state, "starting");
  assert.equal(j.sandboxId, null);
  // A status poll meanwhile neither fails it nor lets a second job start.
  assert.equal((await tr.status())!.state, "starting");
  await assert.rejects(tr.start("store-02", "scenes/store-02/a.mp4", null), /still training/);
  release();
  const after = await tr.launched();
  assert.equal(after!.state, "running");
  assert.equal(after!.sandboxId, "sb-42");
});

test("trainer: cancelled while Modal is still starting it, the sandbox is stopped as soon as it exists", async () => {
  let release!: () => void;
  const f = fakes({ createGate: new Promise<void>((ok) => { release = ok; }) });
  const tr = createTrainer(f.deps);
  await tr.start("store-01", "masters/store-01/a.mov", null);
  assert.equal((await tr.cancel())!.state, "cancelled");
  release();
  const after = await tr.launched();
  assert.equal(after!.state, "cancelled");
  assert.equal(f.sandbox.terminated, true);
});

test("trainer: a launch lost to a restart is failed after a while, so «Train» works again", async () => {
  let release!: () => void;
  const f = fakes({ createGate: new Promise<void>((ok) => { release = ok; }) });
  await createTrainer(f.deps).start("store-01", "masters/store-01/a.mov", null);
  // A new process (the redeploy) finds the job without a sandbox.
  const again = createTrainer(f.deps);
  assert.equal((await again.status())!.state, "starting");
  f.advanceClock(LAUNCH_STALE_MS + 1);
  const stale = await again.status();
  assert.equal(stale!.state, "failed");
  assert.match(stale!.error!, /restarted/);
  release();
});
