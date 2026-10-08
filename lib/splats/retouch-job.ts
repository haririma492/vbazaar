/**
 * THE RESTORED COPY, MADE ON OUR SERVER (founder, 2026-10-08: "really big
 * for commercialization"; "restore ONLY iranianplaza1"). One scene at a
 * time, when the operator asks: its web copy is retouched in 3D
 * (`retouch.ts`: new asphalt, clean bricks, stains, grime and floaters gone,
 * the same geometry), written as a .ply, made a streamed `.rad` by
 * `build-lod` (as `stream-job.ts`), uploaded as
 * `scenes/<id>/<id>-<stamp>-restored-lod.rad` and recorded as that scene's
 * `fileRestored` — no other scene is touched.
 *
 * The retouch runs as its own process (`scripts/retouch.mts`, Node ≥ 22.6),
 * so the site stays responsive and its memory is given back when it ends;
 * on an older Node it runs here, pausing between blocks of work.
 *
 * Measured (4 cores, synthetic 9M-splat street): retouch ~70 s and 1.5 GB,
 * build-lod --quick ~65 s and 1.7 GB, one after the other.
 *
 * Server only.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, readTour, uploadFile, writeTour } from "./r2";
import { retouch, type RetouchPreset, type Vec3 } from "./retouch";
import { readSplats, writePly } from "./splat-io";
import { sceneById, updateScene } from "./tour";

export type RetouchJob = {
  scene: string;
  preset: RetouchPreset;
  state: "working" | "done" | "failed";
  step: string;
  startedAt: number;
  finishedAt: number | null;
  /** The restored streamed copy's key, when done. */
  key: string | null;
  error: string | null;
};

const jobs = new Map<string, RetouchJob>();

export const retouchJob = (scene: string): RetouchJob | null => jobs.get(scene) ?? null;

export const isRetouchPreset = (v: unknown): v is RetouchPreset => v === "full" || v === "gentle";

const BIN = join(process.cwd(), "bin", "build-lod");
const CLI = join(process.cwd(), "scripts", "retouch.mts");

/** Node can run the .mts CLI itself (type stripping: 22.6 and later). */
function canStrip(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 6);
}

function run(cmd: string, args: string[], cwd: string, what: string, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let tail = "";
    const read = (b: Buffer) => {
      const text = b.toString();
      tail = (tail + text).slice(-2000);
      for (const line of text.split("\n")) if (line.trim()) onLine(line.trim());
    };
    p.stdout.on("data", read);
    p.stderr.on("data", read);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${what} stopped (${code}): ${tail.split("\n").slice(-3).join(" ")}`))));
  });
}

/**
 * Start making `scene`'s restored copy (if it is not already being made).
 * Returns at once; the job reports through `retouchJob`.
 */
export function startRetouchJob(scene: string, preset: RetouchPreset = "full"): RetouchJob {
  const running = jobs.get(scene);
  if (running?.state === "working") return running;
  const job: RetouchJob = { scene, preset, state: "working", step: "starting", startedAt: Date.now(), finishedAt: null, key: null, error: null };
  jobs.set(scene, job);
  void (async () => {
    const dir = mkdtempSync(join(tmpdir(), `sk-restore-${scene}-`));
    try {
      if (!existsSync(BIN)) throw new Error("the converter (bin/build-lod) is not on this server");
      const tour = await readTour();
      const s = sceneById(tour, scene);
      if (!s) throw new Error(`no scene «${scene}» in the tour`);
      // The sharpest web copy there is (the masters are not read here).
      const source = s.fileHQ ?? s.file;
      if (!/\.spz$/i.test(source)) throw new Error(`the scene's file is ${source.split(".").pop()}: the retouch reads an .spz web copy`);
      const input = join(dir, `${scene}.spz`);
      const restored = join(dir, `${scene}-restored.ply`);
      // The tour's `flip`: the file is y-down (a capture's own axes).
      const up: Vec3 = s.flip ? [0, -1, 0] : [0, 1, 0];
      job.step = `downloading ${source}`;
      await downloadToFile(source, input);
      job.step = `retouching ${Math.round(statSync(input).size / 1048576)} MB (a minute or two)`;
      if (canStrip() && existsSync(CLI)) {
        await run(process.execPath, ["--experimental-strip-types", "--no-warnings", CLI, input, restored, `--preset=${preset}`, `--up=${up.join(",")}`, "--max-sh=1"],
          process.cwd(), "the retouch", (line) => {
            if (/^(·|read |retouched|wrote )/.test(line)) job.step = `retouch: ${line.replace(/^·\s*/, "").slice(0, 140)}`;
          });
      } else {
        const splats = await readSplats(input, 1);
        const pause = () => new Promise<void>((r) => setImmediate(r));
        const { keep } = await retouch(splats, { preset, up }, { pause, step: (w) => (job.step = `retouch: ${w}`) });
        job.step = "retouch: writing";
        writePly(restored, splats, keep);
      }
      rmSync(input, { force: true });
      job.step = `streaming ${Math.round(statSync(restored).size / 1048576)} MB`;
      await run(BIN, ["--quick", "--max-sh=1", restored], dir, "build-lod", (line) => {
        if (/^(Read:|Removed|Wrote|Encoding)/.test(line)) job.step = line.slice(0, 160);
      });
      const out = readdirSync(dir).find((f) => f.endsWith("-lod.rad"));
      if (!out) throw new Error("the converter wrote no .rad file");
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const key = `scenes/${scene}/${scene}-${stamp}-restored-lod.rad`;
      job.step = `uploading ${Math.round(statSync(join(dir, out)).size / 1048576)} MB`;
      await uploadFile(key, join(dir, out));
      job.step = "saving the tour";
      // Read again: the tour may have changed while this ran. Only this scene.
      await writeTour(updateScene(await readTour(), scene, { fileRestored: key }));
      Object.assign(job, { state: "done", step: "done", key, finishedAt: Date.now() });
    } catch (e) {
      Object.assign(job, { state: "failed", error: (e as Error).message, finishedAt: Date.now() });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return job;
}
