// THE SHADOW AGENT (owner, 2026-11-03: "lets call this agent 'The Shadow
// agent' and let to activate when during the ?edit=1 the operator ask for it"; "an agent that is delicate with
// good dexterity to recognize the shadow of the walking photographer
// everywhere mostly on glasses … and sometimes on stainless steel fridges";
// "my face and posture is so obvious on store window glasses"; treatment A,
// soften; ceiling $0.30 a scene).
//
//   Finder   Claude looks at the walk's horizon band, three moments a look,
//            one moment every 2 s, and boxes the operator's reflections.
//   Fixer    ffmpeg blurs those spots in the web and phone copies, under a
//            mask carried smoothly between the looks (`reflectRules.ts`).
//   Checker  Claude looks again at the softened moments; where the person is
//            still recognisable, the Fixer softens wider and harder (2 rounds).
//
// The copies are kept first as `<file>.before-reflections` and every run
// starts from them, so running again never blurs twice, and «undo» puts them
// back. Server only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyWebObject, presignGetAny, readWalks, uploadFile, webObjectExists, writeWalks } from "@/lib/splats/r2";
import { phoneKeyOf } from "@/lib/splats/walks";
import { probe, run } from "./media";
import { findReflections, stillReflected, type Purse } from "./ai";
import {
  BAND_BOTTOM, BAND_TOP, MASK_FPS, MASK_H, MASK_W, STRIP_H, STRIP_W, boxesAt, looks, maskFrame, stripBoxToSeen, type Seen,
} from "./reflectRules";

/** $0.30 a scene (owner, 2026-11-03), in cents; the Checker's share is kept back. */
export const REFLECT_CENTS = 30;
const CHECK_RESERVE = 5;
const BEFORE = ".before-reflections";
export const beforeKeyOf = (key: string) => `${key}${BEFORE}`;

let running = false;
/** What the Shadow agent is doing, for the edit page to show (one walk at a time). */
export type ShadowStatus = { key: string; state: "working" | "done" | "failed"; note: string; at: string } | null;
let status: ShadowStatus = null;
export const shadowStatus = () => status;

/** Start the Shadow agent on a walk, behind the answer; its progress is `shadowStatus()`. */
export function startShadowAgent(walkKey: string, limitCents = REFLECT_CENTS): string | null {
  if (running) return "The Shadow agent is busy with another walk: try again in a few minutes.";
  let spent = 0;
  const purse: Purse = { spent: () => spent, limit: limitCents, add: async (c) => { spent += c; } };
  const set = (state: "working" | "done" | "failed", note: string) => { status = { key: walkKey, state, note, at: new Date().toISOString() }; };
  set("working", "Starting…");
  void softenReflections(walkKey, purse, async (note) => set("working", note))
    .then((note) => set("done", note))
    .catch((e) => set("failed", e instanceof Error ? e.message : String(e)));
  return null;
}

/** The band's strip of moment `t`, stacked for several moments, as one JPEG. */
async function strips(src: string, ts: number[]): Promise<Uint8Array> {
  const rows = STRIP_W / 2; // the panorama's height when it is STRIP_W wide
  const y = Math.round(((90 - BAND_TOP) / 180) * rows);
  const inputs = ts.flatMap((t) => ["-ss", t.toFixed(2), "-i", src]);
  const chains = ts.map((_, i) => `[${i}:v]scale=${STRIP_W}:${rows},crop=${STRIP_W}:${STRIP_H}:0:${y}[s${i}]`);
  const graph = ts.length > 1 ? `${chains.join(";")};${ts.map((_, i) => `[s${i}]`).join("")}vstack=inputs=${ts.length}` : chains[0].replace(/\[s0\]$/, "");
  return new Uint8Array(await run("ffmpeg", ["-v", "error", ...inputs, "-filter_complex", graph, "-frames:v", "1", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]));
}

/** The mask over the whole walk, MASK_FPS frames a second. */
function maskVideo(seen: Seen[], seconds: number, margin: number): Uint8Array {
  const n = Math.ceil(seconds * MASK_FPS) + 1;
  const out = new Uint8Array(n * MASK_W * MASK_H);
  for (let i = 0; i < n; i++) out.set(maskFrame(boxesAt(seen, i / MASK_FPS, margin)), i * MASK_W * MASK_H);
  return out;
}

/** One copy re-made from its kept original with the spots under the mask blurred. */
async function soften(srcUrl: string, out: string, mask: Uint8Array, crf: number, blur: number): Promise<void> {
  await run("ffmpeg", [
    "-v", "error", "-y", "-i", srcUrl,
    "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${MASK_W}x${MASK_H}`, "-r", String(MASK_FPS), "-i", "pipe:0",
    "-filter_complex",
    `[0:v]split[a][b];[b]scale=iw/8:ih/8,boxblur=${blur}:2,scale=iw*8:ih*8[bl];` +
      `[1:v][a]scale2ref=flags=bilinear[m][a2];[m]gblur=sigma=12,format=gray[mf];` +
      `[bl][mf]alphamerge[blm];[a2][blm]overlay=eof_action=repeat:format=auto[v]`,
    "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-g", "10", "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-an", "-movflags", "+faststart", out,
  ], { input: mask });
}

/** Find the operator's reflections in a 360° walk and soften them. Returns what it did, in a sentence. */
export async function softenReflections(walkKey: string, purse: Purse, say: (note: string) => Promise<void>): Promise<string> {
  if (running) return "The Shadow agent is busy with another walk: try again in a few minutes.";
  running = true;
  const dir = mkdtempSync(join(tmpdir(), "reflect-"));
  try {
    const walk = (await readWalks()).walks[walkKey];
    if (!walk) return "No such walk.";
    if (walk.projection === "flat" || walk.projection === "eac") return "Not a 360° panorama: nothing to soften.";
    const files = [phoneKeyOf(walkKey), walkKey];
    const have = [];
    for (const f of files) if (await webObjectExists(f)) have.push(f);
    if (!have.length) return "The walk's video is not in the bucket.";
    // Keep the copies as they are now, once; every run starts from them.
    for (const f of have) if (!(await webObjectExists(beforeKeyOf(f)))) await copyWebObject(f, beforeKeyOf(f), "video/mp4");
    const src = await presignGetAny(beforeKeyOf(have[0]), 6 * 3600);
    const { seconds } = await probe(src);
    if (!seconds) return "The walk's video could not be read.";

    // Finder.
    const groups = looks(seconds);
    const seen: Seen[] = [];
    let looked = 0;
    for (const ts of groups) {
      if (purse.spent() >= purse.limit - CHECK_RESERVE) break;
      await say(`Looking for the operator's reflection… ${Math.round((looked / groups.length) * 100)}%`);
      const found = await findReflections(purse, await strips(src, ts), ts.length, STRIP_W, STRIP_H);
      for (const f of found) {
        if (f.confidence < 0.5) continue;
        const s = stripBoxToSeen(ts[f.strip - 1], f.box);
        if (s) seen.push(s);
      }
      looked++;
    }
    seen.sort((a, b) => a.t - b.t);
    const partly = looked < groups.length ? ` (the $${(purse.limit / 100).toFixed(2)} ceiling stopped the looking at ${Math.round((looked / groups.length) * 100)}% of the walk)` : "";
    if (!seen.length) return `No reflection of the operator found${partly}.`;

    // Fixer, then Checker; a second, wider and harder round where the person still shows.
    let margin = 0.35, blur = 6, still: number[] = [];
    let rounds = 0;
    const checkAt = [...new Set(seen.map((s) => s.t))].slice(0, 9).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 3)) === 0).slice(0, 3);
    for (rounds = 1; rounds <= 2; rounds++) {
      const mask = maskVideo(seen, seconds, margin);
      const outs: string[] = [];
      for (const f of have) {
        await say(`Softening ${seen.length} reflections in the ${f === walkKey ? "web" : "phone"} copy (round ${rounds})…`);
        const out = join(dir, `${rounds}-${f === walkKey ? "web" : "phone"}.mp4`);
        await soften(await presignGetAny(beforeKeyOf(f), 6 * 3600), out, mask, f === walkKey ? 18 : 21, blur);
        outs.push(out);
      }
      for (let i = 0; i < have.length; i++) await uploadFile(have[i], outs[i], "video/mp4");
      if (purse.spent() >= purse.limit) break;
      await say("Checking the softened walk…");
      still = await stillReflected(purse, await strips(outs[0], checkAt), checkAt.length, STRIP_W, STRIP_H);
      if (!still.length) break;
      margin = 0.7;
      blur = 12;
    }

    // The player asks for the new files past the "forever" cache.
    const walks = await readWalks();
    const w = walks.walks[walkKey];
    if (w) await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, rev: (w.rev ?? 0) + 1 } } }, walks);
    const cost = `$${(purse.spent() / 100).toFixed(2)}`;
    return `Softened ${seen.length} sightings of the operator's reflection${partly}; ${still.length ? `still recognisable at ${still.length} of ${checkAt.length} checked moments after 2 rounds` : "the check found none left"} (${cost} spent). «Undo» puts the walk back as it was.`;
  } finally {
    running = false;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Put the copies back as they were before the Shadow agent. */
export async function undoReflections(walkKey: string): Promise<string> {
  let n = 0;
  for (const f of [walkKey, phoneKeyOf(walkKey)]) {
    if (await webObjectExists(beforeKeyOf(f))) { await copyWebObject(beforeKeyOf(f), f, "video/mp4"); n++; }
  }
  if (!n) return "Nothing to undo: the Shadow agent never changed this walk.";
  const walks = await readWalks();
  const w = walks.walks[walkKey];
  if (w) await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, rev: (w.rev ?? 0) + 1 } } }, walks);
  return "Put back as it was before the Shadow agent.";
}
