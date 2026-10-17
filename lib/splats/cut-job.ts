/**
 * CUT AND STITCH A WALK VIDEO, ON OUR SERVER (the rules: `cut.ts`). ffmpeg
 * (in the image for the captioning) reads only the kept parts of the video
 * from R2 by a signed address, joins them, and the result replaces the file
 * under the same key. The first cut keeps the original (`<key>.original`) and
 * the walk as it was (`cuts/<key>.json`, private), so «Put the original back»
 * restores both. The phone copy, when there is one, is cut the same way.
 *
 * One job at a time (4K encoding takes the server's CPU); its progress is
 * kept here for the walk's edit page to ask after. Server only.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyWebObject, presignGetAny, readMastersText, readWalks, uploadFile, webObjectExists, writeMastersJson, writeWalks } from "./r2";
import { checkParts, cutArgs, keptSeconds, originalKeyOf, remapWalk, sayTime, type Part } from "./cut";
import { isWalkKey, parseWalks, phoneKeyOf, walkOf, type Walk } from "./walks";

export type CutJob = {
  key: string;
  kind: "cut" | "restore";
  state: "working" | "done" | "failed";
  step: string;
  /** 0–100 while encoding. */
  percent: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Doors and dots that were in parts cut away. */
  dropped: string[];
  /** The new video's length. */
  seconds: number | null;
};

let last: CutJob | null = null;

export const cutJob = (key: string): CutJob | null => (last && last.key === key ? last : null);

const SIGNED_SECONDS = 6 * 60 * 60;
const backupKeyOf = (key: string) => `cuts/${key}.json`;

function run(bin: string, args: string[], onOut?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = "", tail = "";
    p.stdout.on("data", (b: Buffer) => {
      const text = b.toString();
      out += text;
      if (onOut) for (const line of text.split("\n")) if (line.trim()) onOut(line.trim());
    });
    p.stderr.on("data", (b: Buffer) => { tail = (tail + b.toString()).slice(-1500); });
    p.on("error", (e) => reject(new Error(`${bin} is not on this server (${e.message})`)));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin} stopped (${code}): ${tail.trim().split("\n").slice(-2).join(" ")}`))));
  });
}

async function durationOf(src: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", src]);
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("the video's length could not be read");
  return d;
}

function busy(): CutJob | null {
  return last?.state === "working" ? last : null;
}

function begin(key: string, kind: CutJob["kind"]): CutJob {
  last = { key, kind, state: "working", step: "starting", percent: 0, startedAt: Date.now(), finishedAt: null, error: null, dropped: [], seconds: null };
  return last;
}

/** The walk saved with `change` applied to its entry, read fresh (someone may have saved meanwhile). */
async function saveWalk(key: string, change: (w: Walk) => Walk): Promise<void> {
  const now = await readWalks();
  const walk = walkOf(now, key) ?? { doors: [] };
  const next = parseWalks({ ...now, walks: { ...now.walks, [key]: change(walk) } });
  await writeWalks(next, now);
}

/** Start cutting `key` down to `parts`. Refused while another cut runs. */
export function startCutJob(key: string, rawParts: unknown): CutJob {
  const running = busy();
  if (running) throw new Error(`another cut is running (${running.key.split("/").pop()}): wait for it to finish`);
  if (!isWalkKey(key)) throw new Error("only a 360° walk video from the bucket (scenes/…/….mp4) can be cut here");
  const job = begin(key, "cut");
  void (async () => {
    const dir = mkdtempSync(join(tmpdir(), "sk-cut-"));
    try {
      job.step = "reading the video";
      if (!(await webObjectExists(key))) throw new Error(`«${key}» is not in the bucket`);
      const src = await presignGetAny(key, SIGNED_SECONDS);
      const duration = await durationOf(src);
      const { parts, problems } = checkParts(rawParts, duration);
      if (problems.length) throw new Error(problems.join(" "));
      const total = keptSeconds(parts);

      // The phone copy is cut the same way, when there is one.
      const phone = phoneKeyOf(key);
      const files = [key, ...((await webObjectExists(phone)) ? [phone] : [])];

      // The first cut keeps the original video(s) and the walk as it was.
      job.step = "keeping the original";
      const before = walkOf(await readWalks(), key) ?? { doors: [] };
      if (!(await readMastersText(backupKeyOf(key)))) await writeMastersJson(backupKeyOf(key), before);
      for (const f of files) if (!(await webObjectExists(originalKeyOf(f)))) await copyWebObject(f, originalKeyOf(f));

      for (const [i, f] of files.entries()) {
        const out = join(dir, `cut-${i}.mp4`);
        const what = i ? "the phone copy" : "the video";
        job.percent = 0;
        job.step = `cutting ${what}: ${parts.map((p) => `${sayTime(p.from)}–${sayTime(p.to)}`).join(" + ")}`;
        await run("ffmpeg", cutArgs(await presignGetAny(f, SIGNED_SECONDS), parts, out), (line) => {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (m) job.percent = Math.min(99, Math.round((Number(m[1]) / 1e6 / total) * 100));
        });
        job.step = `saving ${what} (${Math.round(statSync(out).size / 1048576)} MB)`;
        await uploadFile(f, out, "video/mp4");
      }

      job.step = "moving the doors and dots";
      let dropped: string[] = [];
      await saveWalk(key, (w) => {
        const r = remapWalk(w, parts as Part[]);
        dropped = r.dropped;
        return { ...r.walk, rev: (w.rev ?? 0) + 1 };
      });
      Object.assign(job, { state: "done", step: "done", percent: 100, dropped, seconds: total, finishedAt: Date.now() });
    } catch (e) {
      Object.assign(job, { state: "failed", error: (e as Error).message, finishedAt: Date.now() });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return job;
}

/** Whether `key` has an original kept by a cut. */
export const hasOriginal = (key: string) => webObjectExists(originalKeyOf(key));

/** Put the original video(s) and the walk as it was before the first cut back. */
export function startRestoreJob(key: string): CutJob {
  const running = busy();
  if (running) throw new Error(`a cut is running (${running.key.split("/").pop()}): wait for it to finish`);
  if (!isWalkKey(key)) throw new Error("not a walk video");
  const job = begin(key, "restore");
  void (async () => {
    try {
      job.step = "putting the original back";
      if (!(await webObjectExists(originalKeyOf(key)))) throw new Error("there is no original kept for this video (it was never cut here)");
      for (const f of [key, phoneKeyOf(key)]) {
        if (await webObjectExists(originalKeyOf(f))) await copyWebObject(originalKeyOf(f), f, "video/mp4");
      }
      job.step = "putting the doors and dots back";
      const saved = await readMastersText(backupKeyOf(key));
      const before = saved ? (JSON.parse(saved) as Walk) : null;
      // The walk as it was, but what was set since (its sound, its projection) stays.
      await saveWalk(key, (w) => ({
        ...w, ...(before ? { doors: before.doors, ...(before.items ? { items: before.items } : {}) } : {}), rev: (w.rev ?? 0) + 1,
      }));
      Object.assign(job, { state: "done", step: "done", percent: 100, finishedAt: Date.now() });
    } catch (e) {
      Object.assign(job, { state: "failed", error: (e as Error).message, finishedAt: Date.now() });
    }
  })();
  return job;
}
