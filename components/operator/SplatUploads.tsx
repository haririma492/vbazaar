"use client";

/**
 * «صحنه‌های سه‌بعدی» — the Virtual Bazaar's Gaussian-splat scenes, and the
 * tour that links them.
 *
 * 1. FILES. Pick one or many Splatica `.ply` files. Each gets a scene id
 *    (guessed from its name: `store-01.ply` → `store-01`), and in turn:
 *      • the .ply goes to R2 as the scene's MASTER (`masters/<scene>/`);
 *      • this browser converts it to `.spz` (Spark's `transcodeSpz`: spherical
 *        harmonics cut to degree 1, invisible splats dropped) and uploads that
 *        as the scene's WEB copy (`scenes/<scene>/<scene>-<date>.spz`);
 *      • the scene is added to the tour (or pointed at its new web copy).
 *    A ready `.spz`/`.sog` skips the first two steps.
 * 2. TOUR. Which scene a visitor starts in, and each scene's exits — the
 *    branches a visitor chooses between. Exits are PLACED in the viewer
 *    (`/vca/splat?edit=1`), standing where the marker should be.
 * 3. TRAIN (operator, 2026-10-09: a store owner with only an iPhone). A phone
 *    video (.mov kept private as a master, or .mp4) uploaded here becomes a
 *    splat on a rented GPU: «Train» next to it in «Files in R2». Our server
 *    starts the machine on Modal, it trains for a few tens of minutes, and
 *    the scene arrives in the tour with its route (`lib/splats/train.ts`).
 *
 * ⚠️ THE BROWSER SENDS FILES STRAIGHT TO R2, in 64 MiB parts, four at a time,
 * on URLs the server signs. A 2 GB master never passes through our host, and
 * an interrupted upload resumes (`lib/splats/keys.ts`, `partPlan`).
 *
 * ⚠️ CONVERTING A 2 GB PLY NEEDS ABOUT 4 GB OF MEMORY in this tab (measured:
 * 1 GB / 4M splats took 17 s and 1.8 GB). A desktop is fine; a phone is not.
 * If the tab runs out, untick «convert» — the master still uploads — and run
 * `node scripts/splats/convert.mjs` on a computer, then upload the .spz here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readAdminToken } from "@/lib/admin/useAdminMode";
import { isSceneId, isTrainVideo, isWalkVideo, kindOfFile, partRange, sceneIdFromFileName, splatKey, webFileName } from "@/lib/splats/keys";
import { routeFromCameras, routeFromColmapBinary, routeFromColmapText } from "@/lib/splats/cameras";
import { emptyTour, removeExit, removeScene, sceneById, updateScene, upsertScene, type Tour } from "@/lib/splats/tour";

const API = "/api/operator/splats";
const PARALLEL = 3;
const TRIES = 4;
/**
 * ⚠️ A DROPPED CONNECTION IS RETRIED UNTIL «PAUSE», not given up on: a home
 * upload link drops every few minutes, and pressing «Start again» each time
 * is the operator doing the computer's job. Waits back off to 30 s.
 */
const MAX_BACKOFF_MS = 30_000;
const RESUME_PREFIX = "sk-splat-upload:";

const BIG = "min-h-[44px] rounded-2xl px-4 text-[14px] font-bold disabled:opacity-40";
const PRIMARY = `${BIG} border border-amber-300/60 bg-amber-300/20 text-amber-100 active:bg-amber-300/35`;
const QUIET = `${BIG} border border-white/20 text-white/80 active:bg-white/10`;
const SMALL = "rounded-full border border-white/20 px-3 py-1 text-[12px] text-white/80 active:bg-white/10 disabled:opacity-40";
const FIELD = "sk-field w-full rounded-lg bg-black/30 px-2 py-2 text-[14px] text-[--sk-ink] placeholder:text-white/30 outline-none";
const CARD = "space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4";

type R2Summary = { webBucket: string; mastersBucket: string; mastersArePrivate: boolean; publicBase: string | null };
type Obj = { key: string; kind: "master" | "web"; size: number; lastModified: string | null; url: string | null };
type Resume = { scene: string; key: string; kind: "master" | "web"; uploadId: string; partSize: number; partCount: number };
/** The GPU training (`lib/splats/train.ts` TrainJob), as much as this screen shows. */
type TrainJob = {
  id: string; scene: string; video: string; gpu: string; timeoutMs: number;
  state: "starting" | "running" | "finishing" | "done" | "failed" | "cancelled";
  stage: string; words: string; percent: number | null; log: string[];
  startedAt: number; finishedAt: number | null; error: string | null; warning: string | null;
  webKey: string | null; routePoints: number | null;
};
type TrainSummary = { configured: boolean; gpu: string; gpuPricePerHour: number | null; timeoutHours: number };
const trainOver = (j: TrainJob | null) => !j || j.state === "done" || j.state === "failed" || j.state === "cancelled";
function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min ${String(r).padStart(2, "0")} s`;
}

type Step = "waiting" | "master" | "converting" | "web" | "done" | "error" | "paused";
type Item = {
  id: number;
  file: File;
  scene: string;
  title: string;
  convert: boolean;
  step: Step;
  sent: number;
  total: number;
  note: string;
};

class Stopped extends Error {}
class NoEtag extends Error {}
/** The browser can no longer read the picked file. */
class Unreadable extends Error {}
/** The PUT never got an answer: the network went away mid-part. */
class Dropped extends Error {}
/** R2 answered, with a refusal. 5xx and 408/429 are passing; the rest are not. */
class R2Status extends Error {
  constructor(readonly status: number) {
    super(`R2 answered ${status}`);
  }
  get passing() {
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

async function api<T = any>(body?: object): Promise<T> {
  const res = await fetch(API, {
    method: body ? "POST" : "GET",
    headers: { "x-admin-token": readAdminToken(), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not ours: a proxy's error page, shown in part below */
  }
  if (!res.ok || !json.ok) {
    const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(json.error || `HTTP ${res.status}${plain ? ` — ${plain}` : ""}`);
  }
  return json;
}

const resumeTag = (b: { name: string; size: number; lastModified?: number }, scene: string) =>
  `${RESUME_PREFIX}${scene}:${b.name}:${b.size}:${b.lastModified ?? 0}`;
function readResume(tag: string): Resume | null {
  try {
    const raw = window.localStorage.getItem(tag);
    return raw ? (JSON.parse(raw) as Resume) : null;
  } catch {
    return null;
  }
}
function writeResume(tag: string, r: Resume | null) {
  try {
    if (r) window.localStorage.setItem(tag, JSON.stringify(r));
    else window.localStorage.removeItem(tag);
  } catch {
    /* private mode: no resume, the upload still works */
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

/** PUT one part; resolves with R2's ETag. A missing ETag means the bucket's CORS does not expose it. */
/**
 * The fallback: the same part through our server (`/api/operator/splats/part`),
 * for when the browser may not PUT to R2 itself. Resolves with R2's ETag.
 */
function relayPart(key: string, uploadId: string, part: number, blob: Blob, onBytes: (loaded: number) => void, track: Set<XMLHttpRequest>) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    track.add(xhr);
    const q = new URLSearchParams({ key, uploadId, partNumber: String(part) });
    xhr.open("PUT", `${API}/part?${q}`);
    xhr.setRequestHeader("x-admin-token", readAdminToken());
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      track.delete(xhr);
      let json: { ok?: boolean; etag?: string; error?: string } = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* not ours */ }
      if (xhr.status >= 200 && xhr.status < 300 && json.etag) return resolve(json.etag);
      reject(xhr.status >= 500 || xhr.status === 0 ? new Dropped() : new Error(json.error || `Our server answered ${xhr.status}`));
    };
    xhr.onerror = () => { track.delete(xhr); reject(new Dropped()); };
    xhr.onabort = () => { track.delete(xhr); reject(new Stopped()); };
    xhr.send(blob);
  });
}

function putPart(url: string, blob: Blob, onBytes: (loaded: number) => void, track: Set<XMLHttpRequest>) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    track.add(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      track.delete(xhr);
      if (xhr.status < 200 || xhr.status >= 300) return reject(new R2Status(xhr.status));
      const etag = xhr.getResponseHeader("ETag");
      return etag ? resolve(etag) : reject(new NoEtag());
    };
    xhr.onerror = () => {
      track.delete(xhr);
      // The browser hides why (CORS and a dropped network look the same here);
      // its console says which.
      console.warn("[splat upload] PUT failed with no answer; the console line above, if any, names the reason");
      reject(new Dropped());
    };
    xhr.onabort = () => { track.delete(xhr); reject(new Stopped()); };
    xhr.send(blob);
  });
}

/**
 * One file to R2 as a multipart upload — resumed if this browser started the
 * same file for the same scene before. Returns the key and public url.
 */
async function uploadBlob(
  blob: Blob,
  name: string,
  scene: string,
  onProgress: (sent: number, total: number) => void,
  stop: { current: boolean },
  track: Set<XMLHttpRequest>,
  onNote: (note: string) => void = () => {},
): Promise<{ key: string; url: string | null }> {
  // ⚠️ CAN THE BROWSER STILL READ THE FILE? A file that changed after it was
  // picked (an export still being written, or written again under the same
  // name), is locked, or is an online-only OneDrive file cannot be read, and
  // every PUT of it then fails as if the network were down — to R2 and to our
  // own server alike — and the upload retried forever at 0 %. Read a byte at
  // each end first and say so plainly.
  try {
    await blob.slice(0, 1).arrayBuffer();
    await blob.slice(Math.max(0, blob.size - 1)).arrayBuffer();
  } catch {
    throw new Unreadable();
  }
  const tag = resumeTag({ name, size: blob.size, lastModified: (blob as File).lastModified }, scene);
  let rec = readResume(tag);
  const done = new Map<number, string>();
  if (rec) {
    try {
      const { parts } = await api<{ parts: Array<{ partNumber: number; etag: string }> }>({ action: "parts", key: rec.key, uploadId: rec.uploadId });
      for (const p of parts) done.set(p.partNumber, p.etag);
    } catch {
      rec = null; // expired or aborted elsewhere: start again
    }
  }
  if (!rec) {
    const s = await api<Resume>({ action: "start", scene, name, size: blob.size });
    rec = { scene, key: s.key, kind: s.kind, uploadId: s.uploadId, partSize: s.partSize, partCount: s.partCount };
    writeResume(tag, rec);
  }
  const r = rec;
  const size = (n: number) => { const [a, b] = partRange(n, blob.size, r.partSize); return b - a; };
  let sent = [...done.keys()].reduce((s, n) => s + size(n), 0);
  const live = new Map<number, number>();
  const tick = () => { let l = 0; live.forEach((v) => (l += v)); onProgress(sent + l, blob.size); };
  tick();

  // Shared by the workers: once one finds the direct PUT refused, all relay.
  const relay = { on: false };
  const queue = Array.from({ length: r.partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      const part = n;
      const [a, b] = partRange(part, blob.size, r.partSize);
      for (let attempt = 1; ; attempt++) {
        if (stop.current) throw new Stopped();
        try {
          const onBytes = (x: number) => { live.set(part, x); tick(); };
          let etag: string;
          if (relay.on) {
            etag = await relayPart(r.key, r.uploadId, part, blob.slice(a, b), onBytes, track);
          } else {
            const { url } = await api<{ url: string }>({ action: "sign", key: r.key, uploadId: r.uploadId, partNumber: part });
            etag = await putPart(url, blob.slice(a, b), onBytes, track);
          }
          live.delete(part);
          done.set(part, etag);
          sent += b - a;
          tick();
          break;
        } catch (e) {
          live.delete(part);
          if (e instanceof Stopped || stop.current) throw e;
          // Nothing has ever gone through directly: the browser may not PUT to
          // R2 (CORS, a proxy, an antivirus). Send the parts through our server
          // instead — slower, but it does not depend on the bucket's rules.
          const nothingYet = done.size === 0 && sent === 0;
          if ((e instanceof NoEtag || e instanceof Dropped) && nothingYet && !relay.on && attempt >= 2) {
            relay.on = true;
            onNote("The bucket refused this browser's direct upload, so it goes through our server instead (slower).");
            attempt = 0;
            continue;
          }
          // A real refusal from R2 (403, 404…) does not get better by asking again.
          if (e instanceof R2Status && !e.passing && attempt >= TRIES) throw e;
          // A file that became unreadable mid-way looks like a dropped network too.
          try {
            await blob.slice(a, Math.min(b, a + 1)).arrayBuffer();
          } catch {
            throw new Unreadable();
          }
          // Everything else is the connection (or our host for a moment): wait, and go on.
          const wait = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempt - 1));
          onNote(`Connection lost (${(e as Error).message || "no answer"}) — retrying part ${part} in ${Math.round(wait / 1000)} s, try ${attempt + 1}. It carries on by itself; «Pause» stops it.`);
          await new Promise((res) => setTimeout(res, wait));
          if (!stop.current) onNote("");
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, Math.max(1, queue.length)) }, worker));

  const out = await api<{ url: string | null }>({
    action: "complete", key: r.key, uploadId: r.uploadId,
    parts: [...done].map(([partNumber, etag]) => ({ partNumber, etag })),
  });
  writeResume(tag, null);
  return { key: r.key, url: out.url };
}

/** PLY → SPZ in this tab, with Spark's own encoder (the format the viewer reads best). */
async function convertToSpz(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const { transcodeSpz } = await import("@sparkjsdev/spark");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const out = await transcodeSpz({
    inputs: [{ fileBytes: bytes, pathOrUrl: file.name }],
    maxSh: 1,
    opacityThreshold: 0.02,
    version: 3, // Spark 2.3 reads SPZ v2/v3; v4 fails to decode.
  });
  return out.fileBytes as Uint8Array<ArrayBuffer>;
}

let nextId = 1;

/**
 * A reconstruction's camera export: read for the route, not uploaded. A .json
 * (cameras.json / transforms.json), or COLMAP's images.txt / images.bin from
 * sparse/0 (what Brush trains from).
 */
const isCameraFile = (name: string) => /\.(json|txt|bin)$/i.test(name);
/** A phone video picked to train from: kept privately as a master (.mov), never converted here. */
const isMovVideo = (name: string) => /\.mov$/i.test(name);

export default function SplatUploads() {
  const [r2, setR2] = useState<R2Summary | null>(null);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [tour, setTour] = useState<Tour>(emptyTour());
  const [tourDirty, setTourDirty] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const [corsHelp, setCorsHelp] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [trainInfo, setTrainInfo] = useState<TrainSummary | null>(null);
  const [trainJob, setTrainJob] = useState<TrainJob | null>(null);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [trainBusy, setTrainBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const stopRef = useRef(false);
  const xhrs = useRef(new Set<XMLHttpRequest>());
  const tourRef = useRef(tour);
  /** The tour as the server last gave it (the merge's base). */
  const serverTour = useRef(tour);
  const objectsRef = useRef<Obj[]>([]);
  tourRef.current = tour;

  const refresh = useCallback(async () => {
    try {
      const out = await api<{ r2: R2Summary; objects: Obj[]; tour: Tour; train?: TrainSummary }>();
      setR2(out.r2);
      setTrainInfo(out.train ?? null);
      setObjects(out.objects);
      objectsRef.current = out.objects;
      setTour(out.tour);
      serverTour.current = out.tour;
      setTourDirty(false);
      setListError(null);
    } catch (e) {
      setListError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── The GPU training (`lib/splats/train.ts`): the current or last one ──
  const loadTrain = useCallback(async () => {
    try {
      const { job } = await api<{ job: TrainJob | null }>({ action: "trainStatus" });
      setTrainJob(job);
      setTrainError(null);
      return job;
    } catch (e) {
      setTrainError((e as Error).message);
      return null;
    }
  }, []);
  useEffect(() => {
    void loadTrain();
  }, [loadTrain]);
  // While it runs: ask every 10 s (the machine reports every 30 s), the clock every second.
  const trainRunning = !trainOver(trainJob);
  useEffect(() => {
    if (!trainRunning) return;
    const ask = setInterval(() => {
      void loadTrain().then((j) => { if (j && trainOver(j)) void refresh(); });
    }, 10_000);
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => { clearInterval(ask); clearInterval(tick); };
  }, [trainRunning, loadTrain, refresh]);

  async function startTrain(o: Obj) {
    const folder = o.key.split("/")[1] ?? "";
    const scene = window.prompt(
      `Train a splat from ${o.key.split("/").pop()} on a rented GPU (${trainInfo?.gpu ?? "L4"}`
        + `${trainInfo?.gpuPricePerHour != null ? `, roughly $${trainInfo.gpuPricePerHour.toFixed(2)}/h` : ""}`
        + `, stops automatically after ${trainInfo?.timeoutHours ?? 3} h).\n\nScene id for it (it replaces that scene's file if it is already in the tour):`,
      folder,
    )?.trim().toLowerCase();
    if (!scene) return;
    if (!isSceneId(scene)) {
      setTrainError("Scene id: lowercase letters, digits, inner hyphens — «store-01».");
      return;
    }
    setTrainBusy(true);
    setTrainError(null);
    try {
      const { job } = await api<{ job: TrainJob }>({ action: "train", key: o.key, scene });
      setTrainJob(job);
      setClock(Date.now());
    } catch (e) {
      setTrainError((e as Error).message);
    } finally {
      setTrainBusy(false);
    }
  }

  async function cancelTrain() {
    if (!window.confirm("Stop the training? The GPU stops at once; what it has done so far is lost.")) return;
    setTrainBusy(true);
    try {
      const { job } = await api<{ job: TrainJob | null }>({ action: "trainCancel" });
      setTrainJob(job);
    } catch (e) {
      setTrainError((e as Error).message);
    } finally {
      setTrainBusy(false);
    }
  }

  const patch = (id: number, p: Partial<Item>) => setItems((all) => all.map((it) => (it.id === id ? { ...it, ...p } : it)));

  function addFiles(list: FileList | null) {
    if (!list) return;
    const added: Item[] = [];
    for (const file of Array.from(list)) {
      const kind = kindOfFile(file.name);
      const cameraFile = isCameraFile(file.name);
      if (!kind && !cameraFile) continue;
      // A camera file belongs to a scene already in the tour: the first one, until chosen.
      const scene = cameraFile ? tourRef.current.start || tourRef.current.scenes[0]?.id || "" : sceneIdFromFileName(file.name);
      added.push({
        id: nextId++, file, scene, title: "", convert: kind === "master" && !isMovVideo(file.name),
        step: "waiting", sent: 0, total: file.size, note: "",
      });
    }
    setItems((all) => [...all.filter((i) => i.step !== "done"), ...added]);
  }

  // Streamed copies being made on the server (`lib/splats/stream-job.ts`), by scene.
  type StreamJob = {
    state: "working" | "done" | "failed"; step: string; startedAt: number; finishedAt: number | null; error: string | null;
    /** The restore's report (`lib/splats/retouch.ts` RetouchReport), in part. */
    report?: {
      deep: {
        objects: { kind: "vehicle" | "small" | "person"; size?: [number, number, number] }[];
        rejected: { reason: string; splats: number; size: [number, number, number] }[];
      } | null;
    } | null;
  };
  const [streams, setStreams] = useState<Record<string, StreamJob | null>>({});
  async function makeStream(scene: string, sharp = false) {
    try {
      const { job } = await api<{ job: StreamJob }>({ action: "stream", scene, sharp });
      setStreams((x) => ({ ...x, [scene]: job }));
      // Ask how it goes every few seconds until it is done.
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        const { job: now } = await api<{ job: StreamJob | null }>({ action: "streamStatus", scene });
        setStreams((x) => ({ ...x, [scene]: now }));
        if (!now || now.state !== "working") break;
      }
      await refresh();
    } catch (e) {
      setStreams((x) => ({ ...x, [scene]: { state: "failed", step: "", startedAt: Date.now(), finishedAt: Date.now(), error: (e as Error).message } }));
    }
  }

  // Restored copies being made on the server (`lib/splats/retouch-job.ts`), by scene.
  const [retouches, setRetouches] = useState<Record<string, StreamJob | null>>({});
  // The scene's scale for the restore: metres one file unit stands for (Splatica's is arbitrary).
  const [unitM, setUnitM] = useState<Record<string, string>>({});
  async function makeRestored(scene: string, preset: "gentle" | "full" | "deep") {
    try {
      const metresPerUnit = Number(unitM[scene] || "1") || 1;
      const { job } = await api<{ job: StreamJob }>({ action: "retouch", scene, preset, metresPerUnit });
      setRetouches((x) => ({ ...x, [scene]: job }));
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        const { job: now } = await api<{ job: StreamJob | null }>({ action: "retouchStatus", scene });
        setRetouches((x) => ({ ...x, [scene]: now }));
        if (!now || now.state !== "working") break;
      }
      await refresh();
    } catch (e) {
      setRetouches((x) => ({ ...x, [scene]: { state: "failed", step: "", startedAt: Date.now(), finishedAt: Date.now(), error: (e as Error).message } }));
    }
  }

  async function saveTour(next: Tour) {
    // `base`: the tour as last read — the server merges, so a route recorded
    // in the viewer meanwhile is never overwritten by this page's older copy.
    const { tour: saved } = await api<{ tour: Tour }>({ action: "tour", tour: next, base: serverTour.current });
    serverTour.current = saved;
    tourRef.current = saved;
    setTour(saved);
    setTourDirty(false);
    return saved;
  }

  async function runOne(it: Item) {
    // ⚠️ A CAMERA FILE IS NOT UPLOADED: it is read here, in the browser, and
    // becomes the scene's route — the banked road visitors are drawn along
    // (`lib/splats/cameras.ts`, `lib/splats/path.ts`).
    if (isCameraFile(it.file.name)) {
      const scene = sceneById(tourRef.current, it.scene);
      if (!scene) throw new Error(`«${it.scene}» is not in the tour: upload its splat first, or pick the scene this camera file belongs to.`);
      let got: ReturnType<typeof routeFromCameras>;
      if (/\.bin$/i.test(it.file.name)) {
        got = routeFromColmapBinary(await it.file.arrayBuffer(), scene.flip);
        if (!got) throw new Error("No camera positions found in this file (expected COLMAP images.bin from sparse/0 — not cameras.bin or points3D.bin).");
      } else if (/\.txt$/i.test(it.file.name)) {
        got = routeFromColmapText(await it.file.text(), scene.flip);
        if (!got) throw new Error("No camera positions found in this file (expected COLMAP images.txt from sparse/0 — not cameras.txt or points3D.txt).");
      } else {
        let json: unknown;
        try {
          json = JSON.parse(await it.file.text());
        } catch {
          throw new Error("This file is not JSON.");
        }
        got = routeFromCameras(json, scene.flip);
        if (!got) throw new Error("No camera positions found in this file (expected cameras.json with «position», or transforms.json with «frames»).");
      }
      await saveTour(updateScene(tourRef.current, scene.id, { route: got.route }));
      patch(it.id, {
        step: "done",
        note: `Route set for «${scene.id}»: ${got.cameras} camera positions → ${got.route.length} points. Check it in the viewer's edit mode (blue line).`,
      });
      return;
    }
    const kind = kindOfFile(it.file.name)!;
    const progress = (step: Step) => (sent: number, total: number) => patch(it.id, { step, sent, total });
    const note = (text: string) => patch(it.id, { note: text });
    let webKey: string;
    if (kind === "master") {
      // ⚠️ A MASTER ALREADY IN R2 IS NOT SENT AGAIN. If the conversion failed
      // (a tab out of memory) or the page was closed after the upload, picking
      // the same file goes straight to converting instead of another 2 GB.
      const key = splatKey(it.scene, it.file.name)?.key;
      const there = objectsRef.current.find((o) => o.key === key && o.size === it.file.size);
      if (there) note("This master is already in R2 — not uploading it again.");
      else await uploadBlob(it.file, it.file.name, it.scene, progress("master"), stopRef, xhrs.current, note);
      // A phone video is kept (privately) to train from — not a splat, not in the tour yet.
      if (isMovVideo(it.file.name)) {
        patch(it.id, { step: "done", note: "Video uploaded (kept private). Press «Train» next to it in «Files in R2» below to make a splat from it." });
        return;
      }
      if (!it.convert) {
        patch(it.id, { step: "done", note: "Master uploaded. Not converted: upload its .spz when ready." });
        return;
      }
      patch(it.id, { step: "converting", sent: 0, total: 0, note: "" });
      const t = performance.now();
      const spz = await convertToSpz(it.file);
      const secs = ((performance.now() - t) / 1000).toFixed(1);
      const name = webFileName(it.scene, new Date());
      const blob = new Blob([spz], { type: "application/octet-stream" });
      patch(it.id, { note: `Converted in ${secs} s: ${formatBytes(it.file.size)} → ${formatBytes(spz.length)}` });
      webKey = (await uploadBlob(blob, name, it.scene, progress("web"), stopRef, xhrs.current, note)).key;
    } else {
      const sent = await uploadBlob(it.file, it.file.name, it.scene, progress("web"), stopRef, xhrs.current, note);
      webKey = sent.key;
      // A 360° walk video is not a splat scene: it stays out of the tour and
      // opens in its own viewer.
      if (isWalkVideo(it.file.name)) {
        patch(it.id, { step: "done", note: "Video uploaded. In «Files in R2» below: «Walk» opens it as a 360° walk video, «Train» makes a splat from it." });
        return;
      }
    }
    const title = it.title.trim();
    // ⚠️ A «…-hq» FILE IS THE SCENE'S SHARPER COPY for computers; phones keep
    // the scene's own file. It needs the scene to be in the tour already.
    if (/-hq\.(spz|sog|ksplat|splat|rad)$/i.test(it.file.name) && sceneById(tourRef.current, it.scene)) {
      await saveTour(updateScene(tourRef.current, it.scene, { fileHQ: webKey }));
      patch(it.id, { step: "done", note: `Set as «${it.scene}»'s sharper copy for computers.` });
      return;
    }
    let next = upsertScene(tourRef.current, it.scene, webKey, title ? { en: title, fa: title } : undefined);
    // ⚠️ A NEW MASTER RETIRES THE SCENE'S SHARPER COPY: that «…-hq» file was
    // made from the old master (e.g. before a restoration, `public/gpu/`), and
    // computers — and «Make the streamed copy», which prefers it — would keep
    // showing the old scene. Its streamed and restored copies were made from
    // the old one too: retired with it (press «Make the streamed copy» again).
    if (kind === "master") next = updateScene(next, it.scene, { fileHQ: null, fileRad: null, fileRestored: null });
    await saveTour(next);
    patch(it.id, { step: "done" });
  }

  async function runAll() {
    setRunning(true);
    setMessage(null);
    stopRef.current = false;
    // Keep the screen (and so the computer) awake while a 2 GB upload runs. Chrome and Edge; elsewhere a no-op.
    let wake: { release: () => Promise<void> } | null = null;
    try {
      wake = await (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } })
        .wakeLock?.request("screen") ?? null;
    } catch {
      /* refused (battery saver, hidden tab): carry on without it */
    }
    for (const it of items) {
      if (it.step === "done" || !isSceneId(it.scene)) continue;
      try {
        await runOne(it);
      } catch (e) {
        if (e instanceof Stopped) {
          patch(it.id, { step: "paused", note: "Paused. «Start» resumes from the last finished part." });
          break;
        }
        if (e instanceof Unreadable) {
          patch(it.id, {
            step: "error",
            note: "This browser cannot read the file any more: it changed after you picked it (an export still running, or exported again), another program has it open, or it is an online-only OneDrive file. Make sure the export has finished, «Remove» it here, and choose it again.",
          });
          break;
        }
        if (e instanceof Dropped) {
          patch(it.id, { step: "paused", note: "The connection to R2 dropped (Wi-Fi, or the computer slept) and did not come back for a few minutes. «Start again» resumes from the last finished part." });
          break;
        }
        if (e instanceof NoEtag) {
          setCorsHelp(true);
          patch(it.id, { step: "error", note: "The browser could not PUT to R2 — usually the bucket's CORS. Press «Allow this site to upload», then Start again." });
          break;
        }
        patch(it.id, { step: "error", note: (e as Error).message || "Failed (out of memory while converting? untick «convert»)." });
      }
    }
    void wake?.release().catch(() => {});
    setRunning(false);
    void refresh();
  }

  function pause() {
    stopRef.current = true;
    xhrs.current.forEach((x) => x.abort());
  }

  async function allowCors() {
    try {
      const { origins } = await api<{ origins: string[] }>({ action: "cors" });
      setMessage({ tone: "ok", text: `The bucket now accepts uploads from ${origins.join(", ")}.` });
    } catch (e) {
      setCorsHelp(true);
      setMessage({ tone: "bad", text: `Could not set CORS (${(e as Error).message}). Paste the rule below in Cloudflare → R2 → bucket → Settings → CORS policy.` });
    }
  }

  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy:", text);
    }
  }

  async function copyLink(o: Obj) {
    try {
      const { url } = await api<{ url: string }>({ action: "link", key: o.key });
      await copy(url, o.key);
    } catch (e) {
      setMessage({ tone: "bad", text: (e as Error).message });
    }
  }

  const editTour = (next: Tour) => {
    setTour(next);
    setTourDirty(true);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "https://sarekooche.com";
  const waiting = items.some((i) => i.step !== "done");
  const badIds = items.filter((i) => i.step !== "done" && !isSceneId(i.scene));

  return (
    <div className="space-y-6">
      <header>
        <a href="/operator" className="text-[13px] text-white/50">← اپراتور</a>
        <h1 className="sk-font mt-2 text-2xl font-bold text-amber-200">صحنه‌های سه‌بعدی</h1>
        <p dir="ltr" className="text-left text-[13px] text-white/50">
          Gaussian-splat scenes for the Virtual Bazaar, in Cloudflare R2, and the tour that links them.
        </p>
      </header>

      {r2 && !r2.mastersArePrivate && (
        <p dir="ltr" className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-left text-[13px] text-amber-100">
          Masters and scenes share bucket <code>{r2.webBucket}</code>. If it has public access on, the master .ply files
          are downloadable by anyone with their address. Set <code>R2_MASTERS_BUCKET</code> to a private bucket.
        </p>
      )}
      {listError && <p dir="ltr" className="rounded-xl border border-rose-300/40 bg-rose-300/10 p-3 text-left text-[13px] text-rose-200">{listError}</p>}

      {/* ── 1. Files ─────────────────────────────────────────────────── */}
      <section dir="ltr" className={`${CARD} text-left`}>
        <h2 className="text-[15px] font-bold text-white/90">1 · Upload scenes</h2>
        <p className="text-[12px] text-white/50">
          One or many Splatica <b>.ply</b> files (or ready <b>.spz / .sog</b>). Each becomes a scene: the .ply is kept as
          its master, converted here to .spz for the viewer, and added to the tour. A 360° <b>.mp4</b> becomes a walk
          video. A camera <b>.json</b> (cameras.json / transforms.json) or COLMAP <b>images.txt / images.bin</b> (from
          sparse/0, as used by Brush) becomes the chosen scene&apos;s route — the way visitors are drawn along. A
          phone video of a store (<b>.mov</b> from an iPhone, or <b>.mp4</b>) can be trained into a scene on a rented
          GPU: «Train» next to it in «Files in R2».
        </p>
        <input
          type="file"
          multiple
          accept=".ply,.spz,.sog,.ksplat,.splat,.rad,.mp4,.mov,.json,.txt,.bin"
          disabled={running}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          className="block w-full text-[14px] text-white/80 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-white/90"
        />

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((it) => {
              const isMaster = kindOfFile(it.file.name) === "master" && !isMovVideo(it.file.name);
              const pct = it.total ? (it.sent / it.total) * 100 : 0;
              const locked = running || it.step === "done";
              return (
                <li key={it.id} className="space-y-2 rounded-xl border border-white/10 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="break-all font-bold text-white/85">{it.file.name}</span>
                    <span className="text-white/45">{formatBytes(it.file.size)}</span>
                    <span className={`ms-auto rounded-full px-2 py-0.5 text-[11px] ${
                      it.step === "done" ? "bg-emerald-400/15 text-emerald-200" : it.step === "error" ? "bg-rose-400/15 text-rose-200" : "bg-white/10 text-white/70"}`}>
                      {{ waiting: "waiting", master: "uploading master", converting: "converting to .spz…", web: "uploading .spz", done: "done", error: "failed", paused: "paused" }[it.step]}
                    </span>
                    {!running && it.step !== "done" && (
                      <button className={SMALL} onClick={() => setItems((all) => all.filter((x) => x.id !== it.id))}>Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <label className="text-[12px] text-white/55">Scene id
                      <input className={`${FIELD} mt-1`} value={it.scene} disabled={locked} list="splat-scene-ids"
                        onChange={(e) => patch(it.id, { scene: e.target.value.trim().toLowerCase() })} />
                    </label>
                    <label className="text-[12px] text-white/55">Title (shown to visitors)
                      <input className={`${FIELD} mt-1`} value={it.title} disabled={locked} placeholder={sceneById(tour, it.scene)?.title.en ?? it.scene}
                        onChange={(e) => patch(it.id, { title: e.target.value })} />
                    </label>
                    {isMaster && (
                      <label className="flex items-end gap-2 pb-2 text-[12px] text-white/70">
                        <input type="checkbox" checked={it.convert} disabled={locked} onChange={(e) => patch(it.id, { convert: e.target.checked })} />
                        convert to .spz here
                      </label>
                    )}
                  </div>
                  {!isSceneId(it.scene) && <p className="text-[12px] text-rose-300">Scene id: lowercase letters, digits, inner hyphens — «hallway», «store-01».</p>}
                  {sceneById(tour, it.scene) && it.step === "waiting" && (
                    <p className="text-[12px] text-amber-200/80">«{it.scene}» is already in the tour: its exits stay, its file is replaced.</p>
                  )}
                  {(it.step === "master" || it.step === "web") && (
                    <div className="space-y-1">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-amber-300/70 transition-[width]" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[11px] tabular-nums text-white/55">{pct.toFixed(1)}% · {formatBytes(it.sent)} of {formatBytes(it.total)}</p>
                    </div>
                  )}
                  {it.note && <p className={`text-[12px] ${it.step === "error" ? "text-rose-300" : "text-white/60"}`}>{it.note}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <datalist id="splat-scene-ids">
          {["hallway", ...tour.scenes.map((s) => s.id), "store-01", "store-02", "store-03"].filter((v, i, a) => a.indexOf(v) === i).map((s) => <option key={s} value={s} />)}
        </datalist>

        <div className="flex flex-wrap gap-2">
          <button className={PRIMARY} disabled={running || !waiting || badIds.length > 0} onClick={() => void runAll()}>
            {items.some((i) => i.step === "paused" || i.step === "error") ? "Start again (resumes)" : "Start"}
          </button>
          {running && <button className={QUIET} onClick={pause}>Pause</button>}
        </div>

        {message && (
          <p className={`break-all text-[13px] ${message.tone === "ok" ? "text-emerald-300" : message.tone === "bad" ? "text-rose-300" : "text-white/70"}`}>{message.text}</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button className={SMALL} onClick={() => void allowCors()}>Allow this site to upload (bucket CORS)</button>
          <button className={SMALL} onClick={() => setCorsHelp((v) => !v)}>{corsHelp ? "Hide" : "Show"} the CORS rule</button>
        </div>
        {corsHelp && (
          <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 text-[11px] text-white/70">{JSON.stringify([
            { AllowedOrigins: [origin], AllowedMethods: ["GET", "HEAD", "PUT"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 3600 },
          ], null, 2)}</pre>
        )}
      </section>

      {/* ── 2. Tour ──────────────────────────────────────────────────── */}
      <section dir="ltr" className={`${CARD} text-left`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold text-white/90">2 · Tour — where visitors can go</h2>
          <a className={`${SMALL} ms-auto`} href="/vca/splat">Open the tour</a>
        </div>
        {tour.scenes.length === 0 ? (
          <p className="text-[13px] text-white/40">No scenes yet. Upload one above.</p>
        ) : (
          <>
            <label className="block text-[12px] text-white/55">Visitors start in
              <select className={`${FIELD} mt-1`} value={tour.start} onChange={(e) => editTour({ ...tour, start: e.target.value })}>
                {tour.scenes.map((s) => <option key={s.id} value={s.id}>{s.title.en} ({s.id})</option>)}
              </select>
            </label>
            <ul className="space-y-2">
              {tour.scenes.map((s) => (
                <li key={s.id} className="space-y-2 rounded-xl border border-white/10 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <b className="text-white/90">{s.id}</b>
                    <code className="break-all text-[11px] text-white/40">{s.file}</code>
                    <span className="ms-auto flex flex-wrap gap-2">
                      <a className={SMALL} href={`/vca/splat?scene=${s.id}`}>View</a>
                      <a className={SMALL} href={`/vca/splat?scene=${s.id}&edit=1`}>Place exits</a>
                      <button className={SMALL} onClick={() => { if (window.confirm(`Remove «${s.id}» from the tour? Its files stay in R2.`)) editTour(removeScene(tour, s.id)); }}>Remove</button>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <label className="text-[12px] text-white/55">Title (English)
                      <input className={`${FIELD} mt-1`} value={s.title.en} onChange={(e) => editTour(updateScene(tour, s.id, { title: { ...s.title, en: e.target.value } }))} />
                    </label>
                    <label className="text-[12px] text-white/55">عنوان (فارسی)
                      <input dir="rtl" className={`${FIELD} mt-1`} value={s.title.fa} onChange={(e) => editTour(updateScene(tour, s.id, { title: { ...s.title, fa: e.target.value } }))} />
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-[12px] text-white/70" title="Most reconstructions come out upside down; this turns them upright">
                      <input type="checkbox" checked={s.flip} onChange={(e) => editTour(updateScene(tour, s.id, { flip: e.target.checked }))} />
                      flip upright
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[12px] text-white/60">
                    <label className="flex items-center gap-2">
                      Pace
                      <select
                        className="rounded bg-black/30 px-2 py-1"
                        value={s.pace}
                        onChange={(e) => editTour(updateScene(tour, s.id, { pace: Number(e.target.value) }))}
                      >
                        <option value={0.5}>Stroll — window shopping</option>
                        <option value={0.75}>Easy walk</option>
                        <option value={1}>Normal</option>
                      </select>
                    </label>
                    <span>{s.place ? "Joined to the tour's world" : "A scene of its own (reached by exits)"}</span>
                    {s.fileHQ && <span>· sharper copy for computers ✓</span>}
                  </div>
                  {/* ⚠️ THE STREAMED COPY (architecture «C»): made on our server from
                      the web copy — the viewer then streams only what each view needs. */}
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    {(() => {
                      const job = streams[s.id];
                      const working = job?.state === "working";
                      return (
                        <>
                          <button
                            className="rounded-full border border-sky-300/60 bg-sky-400/15 px-3 py-1 text-sky-50 disabled:opacity-50"
                            disabled={working}
                            onClick={() => void makeStream(s.id)}
                          >
                            {working ? "Making the streamed copy…" : s.fileRad ? "Remake the streamed copy (fast)" : "Make the streamed copy (phone-safe, fast)"}
                          </button>
                          {!working && (
                            <button
                              className="rounded-full border border-violet-300/60 bg-violet-400/15 px-3 py-1 text-violet-50"
                              title="Spark's careful method: finer detail on computers. Several minutes; the file is about twice the size."
                              onClick={() => void makeStream(s.id, true)}
                            >
                              Make a sharp streamed copy (slow)
                            </button>
                          )}
                          {s.fileRad && !working && (
                            <span className="text-emerald-300">
                              ✓ {s.fileRad.endsWith("-sharp-lod.rad") ? "sharp" : "fast"} streamed copy — phones and computers stream it
                            </span>
                          )}
                          {working && <span className="text-white/60">{job.step}</span>}
                          {job?.state === "failed" && <span className="text-rose-300">not made: {job.error}</span>}
                          {job?.state === "done" && <span className="text-emerald-300">done in {Math.round(((job.finishedAt ?? 0) - job.startedAt) / 1000)} s</span>}
                        </>
                      );
                    })()}
                  </div>
                  {/* ⚠️ THE RESTORED COPY (founder: "restore ONLY iranianplaza1"): one scene at a
                      time, on our server — same geometry, cleaner colour. Visitors see it once made;
                      «Show as filmed» puts the scene back (the restored file stays in R2). */}
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    {(() => {
                      const job = retouches[s.id];
                      const working = job?.state === "working";
                      return (
                        <>
                          {/* ⚠️ THE SCENE'S SCALE (founder's iranianplaza1, 2026-10-08: «removed nothing»
                              — the whole plaza measured ~8 × 15 units: one unit is metres, not one). */}
                          {!working && (
                            <label className="flex items-center gap-1 text-white/70" title="How many metres one unit of this scene's file stands for. Cars, people, walls and doors are found by their size in metres.">
                              1 unit =
                              <input
                                className="w-14 rounded border border-white/20 bg-black/40 px-1 py-0.5 text-white"
                                inputMode="decimal"
                                value={unitM[s.id] ?? "1"}
                                onChange={(e) => setUnitM((x) => ({ ...x, [s.id]: e.target.value }))}
                              />
                              m
                            </label>
                          )}
                          {!working && (["gentle", "full", "deep"] as const).map((preset) => (
                            <button
                              key={preset}
                              className="rounded-full border border-amber-300/60 bg-amber-400/15 px-3 py-1 text-amber-50"
                              title={
                                preset === "deep" ? "Strongest: removes cars and people, new asphalt and walls, repainted doors"
                                : preset === "full" ? "Stronger: new-looking asphalt, grime and stains removed, no glare."
                                : "Lighter: stains and grime faded, character kept."
                              }
                              onClick={() => void makeRestored(s.id, preset)}
                            >
                              {s.fileRestored ? "Restore again" : "Restore this scene"} ({preset})
                            </button>
                          ))}
                          {working && <span className="text-white/60">Restoring… {job.step}</span>}
                          {s.fileRestored && !working && (
                            <>
                              <span className="text-amber-200">✓ visitors see the restored scene</span>
                              <a className="underline" href={`/vca/splat?scene=${encodeURIComponent(s.id)}&restored=0`} target="_blank" rel="noreferrer">compare as filmed</a>
                              <button className="underline" onClick={() => editTour(updateScene(tour, s.id, { fileRestored: null }))}>Show as filmed</button>
                            </>
                          )}
                          {job?.state === "failed" && <span className="text-rose-300">not restored: {job.error}</span>}
                          {job?.state === "done" && (
                            <span className="text-amber-200">
                              done in {Math.round(((job.finishedAt ?? 0) - job.startedAt) / 1000)} s
                              {(job as { metresPerUnit?: number }).metresPerUnit != null && ` · at 1 unit = ${(job as { metresPerUnit?: number }).metresPerUnit} m`}
                            </span>
                          )}
                          {job?.state === "done" && job.report?.deep && (
                            <span className="text-white/60">
                              removed{" "}
                              {(["vehicle", "small", "person"] as const)
                                .map((k) => [k, job.report!.deep!.objects.filter((o) => o.kind === k).length] as const)
                                .filter(([, c]) => c)
                                .map(([k, c]) => `${c} ${k === "vehicle" ? "car/van" : k === "small" ? "scooter/cart" : "person"}`)
                                .join(", ") || "nothing"}
                              ; kept {job.report.deep.rejected.length} other things standing
                            </span>
                          )}
                          {/* What it saw (founder, 2026-10-08: "removed nothing; kept 166 other things"): the
                              sizes tell whether the scene is in metres — the car rules assume it is. */}
                          {job?.state === "done" && job.report?.deep && job.report.deep.rejected.length > 0 && (
                            <details className="w-full text-white/60">
                              <summary className="cursor-pointer underline">what it kept, and why</summary>
                              <button
                                className="my-1 rounded-full border border-white/20 px-2 py-0.5"
                                onClick={() => void navigator.clipboard.writeText(JSON.stringify(job.report, null, 1))}
                              >
                                Copy the full report
                              </button>
                              <ul className="max-h-60 overflow-auto font-mono text-[11px]">
                                {[...job.report.deep.rejected]
                                  .sort((a, b) => b.splats - a.splats)
                                  .slice(0, 60)
                                  .map((r, i) => (
                                    <li key={i}>
                                      {r.size.map((v) => v.toFixed(2)).join(" × ")} · {r.splats.toLocaleString()} splats · {r.reason}
                                    </li>
                                  ))}
                              </ul>
                            </details>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <p className="text-[12px] text-white/55">
                    {s.route.length
                      ? `Route: ${s.route.length} points — visitors are drawn along it.`
                      : "No route yet: add the camera .json (or COLMAP images.txt / .bin) above, or record it in «Place exits»."}
                    {s.route.length > 0 && (
                      <button className="ms-2 underline" onClick={() => editTour(updateScene(tour, s.id, { route: [] }))}>clear</button>
                    )}
                  </p>
                  {s.exits.length === 0 ? (
                    <p className="text-[12px] text-white/40">No exits — a dead end. «Place exits» to add branches.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {s.exits.map((e) => (
                        <li key={e.id} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/80">
                          → {e.label.en} <span className="text-white/40">({e.to})</span>
                          <button aria-label={`Remove exit ${e.id}`} className="ms-1 text-white/50" onClick={() => editTour(removeExit(tour, s.id, e.id))}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button className={PRIMARY} disabled={!tourDirty} onClick={() => void saveTour(tour).catch((e) => setMessage({ tone: "bad", text: (e as Error).message }))}>
                Save tour
              </button>
              {tourDirty && <button className={QUIET} onClick={() => void refresh()}>Undo changes</button>}
            </div>
          </>
        )}
      </section>

      {/* ── 3. Train ─────────────────────────────────────────────────── */}
      {/* ⚠️ A RENTED GPU, PAID BY THE HOUR (lib/splats/train.ts): one training at a time, and
          Modal stops the machine by itself at the time limit whatever happens here. */}
      <section dir="ltr" className={`${CARD} text-left`}>
        <h2 className="text-[15px] font-bold text-white/90">3 · Train a scene from a phone video</h2>
        <p className="text-[12px] text-white/50">
          Upload the video above (an iPhone <b>.mov</b> or an <b>.mp4</b>), then press «Train» next to it in «Files in R2».
          A rented GPU works out where the phone was and trains the splat — usually under an hour — and the scene
          arrives in the tour with its route. GPU {trainInfo?.gpu ?? "L4"}
          {trainInfo?.gpuPricePerHour != null ? `, roughly $${trainInfo.gpuPricePerHour.toFixed(2)}/h` : ""}, stops
          automatically after {trainInfo?.timeoutHours ?? 3} h (price approximate; CPU and memory add a little). One
          training at a time.
        </p>
        {trainInfo && !trainInfo.configured && (
          <p className="rounded-xl border border-rose-300/40 bg-rose-300/10 p-3 text-[13px] text-rose-200">
            Training is not set up on this host: set <code>MODAL_TOKEN_ID</code> and <code>MODAL_TOKEN_SECRET</code> (Railway →
            Variables), then redeploy.
          </p>
        )}
        {trainError && <p className="break-words text-[13px] text-rose-300">{trainError}</p>}
        {trainJob && (() => {
          const j = trainJob;
          const running = !trainOver(j);
          const elapsed = (j.finishedAt ?? (running ? clock : j.startedAt)) - j.startedAt;
          return (
            <div className="space-y-2 rounded-xl border border-white/10 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <b className="text-white/90">«{j.scene}»</b>
                <code className="break-all text-[11px] text-white/40">{j.video}</code>
                <span className={`ms-auto rounded-full px-2 py-0.5 text-[11px] ${
                  j.state === "done" ? "bg-emerald-400/15 text-emerald-200" : j.state === "failed" ? "bg-rose-400/15 text-rose-200" : j.state === "cancelled" ? "bg-white/10 text-white/60" : "bg-amber-300/15 text-amber-100"}`}>
                  {{ starting: "starting", running: "training", finishing: "adding to the tour", done: "done", failed: "failed", cancelled: "cancelled" }[j.state]}
                </span>
              </div>
              <p className="text-[12px] text-white/70">
                {j.words || j.stage} · {formatElapsed(elapsed)}{running ? " so far" : ""} · GPU {j.gpu}
              </p>
              {running && j.percent != null && (
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-amber-300/70 transition-[width]" style={{ width: `${j.percent}%` }} />
                  </div>
                  <p className="text-[11px] tabular-nums text-white/55">{j.percent.toFixed(1)}%</p>
                </div>
              )}
              {j.state === "done" && (
                <p className="text-[12px] text-emerald-300">
                  In the tour as «{j.scene}»{j.routePoints ? `, with a route of ${j.routePoints} points` : ""}.{" "}
                  <a className="underline" href={`/vca/splat?scene=${encodeURIComponent(j.scene)}`}>Walk it</a> — then «Make the streamed copy» above for phones.
                </p>
              )}
              {j.warning && <p className="text-[12px] text-amber-200/80">{j.warning}</p>}
              {j.error && <p className="break-words text-[12px] text-rose-300">{j.error}</p>}
              {j.log.length > 0 && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-2 text-[10px] leading-snug text-white/60">{j.log.join("\n")}</pre>
              )}
              {running && j.state !== "finishing" && (
                <button className={QUIET} disabled={trainBusy} onClick={() => void cancelTrain()}>Cancel the training</button>
              )}
            </div>
          );
        })()}
      </section>

      {/* ── Files in R2 ─────────────────────────────────────────────── */}
      <section dir="ltr" className="space-y-2 text-left">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-white/90">Files in R2</h2>
          <button className={SMALL} onClick={() => void refresh()}>Refresh</button>
        </div>
        {objects.length === 0 && !listError && <p className="text-[13px] text-white/40">Nothing uploaded yet.</p>}
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
          {objects.map((o) => (
            <li key={o.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-[13px]">
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${o.kind === "master" ? "bg-sky-400/15 text-sky-200" : "bg-emerald-400/15 text-emerald-200"}`}>
                {o.kind === "master" ? "master" : "web"}
              </span>
              <code className="break-all text-white/85">{o.key}</code>
              <span className="tabular-nums text-white/50">{formatBytes(o.size)}</span>
              {o.lastModified && <span className="text-white/40">{new Date(o.lastModified).toLocaleString()}</span>}
              <span className="ms-auto flex flex-wrap gap-2">
                {o.kind === "web" && o.url && isWalkVideo(o.key) && <a className={SMALL} href={`/vca/walk?v=${encodeURIComponent(o.key)}`}>Walk</a>}
                {isTrainVideo(o.key) && (
                  <button
                    className="rounded-full border border-amber-300/60 bg-amber-400/15 px-3 py-1 text-[12px] text-amber-50 disabled:opacity-40"
                    disabled={trainBusy || trainRunning || trainInfo?.configured === false}
                    title={trainRunning ? "One training at a time" : trainInfo?.configured === false ? "Modal is not set up on this host" : "Train a splat from this video on a rented GPU"}
                    onClick={() => void startTrain(o)}
                  >
                    {trainBusy ? "Starting…" : "Train"}
                  </button>
                )}
                {/* A scene's file: walk the scene — its streamed copy when it has one. «View alone»
                    opens this very file whole: a 100 MB one never finished on a laptop (operator, 2026-10-08). */}
                {(() => {
                  const sc = o.kind === "web" ? tour.scenes.find((x) => [x.file, x.fileHQ, x.fileRad].includes(o.key)) : undefined;
                  return sc ? (
                    <a className={SMALL} href={`/vca/splat?scene=${encodeURIComponent(sc.id)}`}>
                      Walk «{sc.id}»{sc.fileRad ? " (streamed)" : ""}
                    </a>
                  ) : null;
                })()}
                {o.key.endsWith(".rad") && <span className="text-[11px] text-violet-200">streamed copy</span>}
                {o.kind === "web" && o.url && !isWalkVideo(o.key) && (
                  <a className={SMALL} href={`/vca/splat?src=${encodeURIComponent(o.url)}`} title={o.key.endsWith(".rad") ? "" : "This file whole, not streamed: a big one may not open on a laptop or phone."}>
                    View this file alone{!o.key.endsWith(".rad") && o.size > 60 * 1048576 ? " (whole — heavy)" : ""}
                  </a>
                )}
                {o.kind === "web" && o.url && <button className={SMALL} onClick={() => void copy(o.url!, o.key)}>{copied === o.key ? "Copied" : "Copy URL"}</button>}
                {o.kind === "master" && <button className={SMALL} onClick={() => void copyLink(o)}>{copied === o.key ? "Copied" : "Copy 24 h download link"}</button>}
              </span>
            </li>
          ))}
        </ul>
        {r2 && !r2.publicBase && <p className="text-[12px] text-white/40">Set NEXT_PUBLIC_SPLAT_BASE_URL to the bucket&apos;s public address to view scenes.</p>}
      </section>
    </div>
  );
}
