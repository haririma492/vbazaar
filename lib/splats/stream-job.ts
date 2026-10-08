/**
 * THE STREAMED COPY, MADE ON OUR SERVER (operator, 2026-10-08, architecture
 * «C»: "do the C"). A scene's web copy (.spz) becomes a level-of-detail
 * `.rad`: Spark's own `build-lod` (bin/build-lod, built from Spark v2.3.1 —
 * the version the viewer runs — as one static Linux binary, no GPU). The
 * viewer then reads only the parts of it the view needs, by byte range,
 * within a fixed memory budget: no phone runs out of memory, a computer is no
 * longer asked to draw every splat every frame, and nothing waits for the
 * whole file.
 *
 * One job per scene at a time, in this server process; its progress is kept
 * here for the operator's screen to ask after. Measured: 3M splats in ~10 s
 * and ~0.5 GB of memory (`--quick`), so a 6–7M-splat scene in under a minute.
 *
 * Server only.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, readTour, uploadFile, writeTour } from "./r2";
import { sceneById, updateScene } from "./tour";

export type StreamJob = {
  scene: string;
  state: "working" | "done" | "failed";
  step: string;
  startedAt: number;
  finishedAt: number | null;
  /** The streamed copy's key, when done. */
  key: string | null;
  error: string | null;
};

const jobs = new Map<string, StreamJob>();

export const streamJob = (scene: string): StreamJob | null => jobs.get(scene) ?? null;

const BIN = join(process.cwd(), "bin", "build-lod");

function run(args: string[], cwd: string, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, args, { cwd });
    let tail = "";
    const read = (b: Buffer) => {
      const text = b.toString();
      tail = (tail + text).slice(-2000);
      for (const line of text.split("\n")) if (line.trim()) onLine(line.trim());
    };
    p.stdout.on("data", read);
    p.stderr.on("data", read);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`build-lod stopped (${code}): ${tail.split("\n").slice(-3).join(" ")}`))));
  });
}

/**
 * Start making `scene`'s streamed copy (if it is not already being made).
 * Returns at once; the job reports through `streamJob`.
 */
export function startStreamJob(scene: string): StreamJob {
  const running = jobs.get(scene);
  if (running?.state === "working") return running;
  const job: StreamJob = { scene, state: "working", step: "starting", startedAt: Date.now(), finishedAt: null, key: null, error: null };
  jobs.set(scene, job);
  void (async () => {
    const dir = mkdtempSync(join(tmpdir(), `sk-rad-${scene}-`));
    try {
      if (!existsSync(BIN)) throw new Error("the converter (bin/build-lod) is not on this server");
      const tour = await readTour();
      const s = sceneById(tour, scene);
      if (!s) throw new Error(`no scene «${scene}» in the tour`);
      // The sharpest web copy there is; level of detail makes it safe for phones.
      const source = s.fileHQ ?? s.file;
      if (/\.rad$/.test(source)) throw new Error("the scene's file is already a streamed copy");
      const ext = source.split(".").pop() ?? "spz";
      const input = join(dir, `${scene}.${ext}`);
      job.step = `downloading ${source}`;
      await downloadToFile(source, input);
      job.step = `converting ${Math.round(statSync(input).size / 1048576)} MB`;
      // --quick: the fast level-of-detail method; SH kept to degree 1 (as the web copies).
      await run(["--quick", "--max-sh=1", input], dir, (line) => {
        if (/^(Read:|Removed|Wrote|Encoding)/.test(line)) job.step = line.slice(0, 160);
      });
      const out = readdirSync(dir).find((f) => f.endsWith("-lod.rad"));
      if (!out) throw new Error("the converter wrote no .rad file");
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const key = `scenes/${scene}/${scene}-${stamp}-lod.rad`;
      job.step = `uploading ${Math.round(statSync(join(dir, out)).size / 1048576)} MB`;
      await uploadFile(key, join(dir, out));
      job.step = "saving the tour";
      // Read again: the tour may have changed while this ran.
      await writeTour(updateScene(await readTour(), scene, { fileRad: key }));
      Object.assign(job, { state: "done", step: "done", key, finishedAt: Date.now() });
    } catch (e) {
      Object.assign(job, { state: "failed", error: (e as Error).message, finishedAt: Date.now() });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return job;
}
