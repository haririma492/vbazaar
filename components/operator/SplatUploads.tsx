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
import { isSceneId, kindOfFile, partRange, sceneIdFromFileName, webFileName } from "@/lib/splats/keys";
import { emptyTour, removeExit, removeScene, sceneById, updateScene, upsertScene, type Tour } from "@/lib/splats/tour";

const API = "/api/operator/splats";
const PARALLEL = 4;
const TRIES = 4;
/** A dropped connection (Wi-Fi, a laptop dozing) is retried for about three minutes before giving up. */
const DROP_TRIES = 10;
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
/** The PUT never got an answer: the network went away mid-part. */
class Dropped extends Error {}

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
function putPart(url: string, blob: Blob, onBytes: (loaded: number) => void, track: Set<XMLHttpRequest>) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    track.add(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      track.delete(xhr);
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`R2 answered ${xhr.status}`));
      const etag = xhr.getResponseHeader("ETag");
      return etag ? resolve(etag) : reject(new NoEtag());
    };
    xhr.onerror = () => { track.delete(xhr); reject(new Dropped()); };
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
): Promise<{ key: string; url: string | null }> {
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

  const queue = Array.from({ length: r.partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      const part = n;
      const [a, b] = partRange(part, blob.size, r.partSize);
      for (let attempt = 1; ; attempt++) {
        if (stop.current) throw new Stopped();
        try {
          const { url } = await api<{ url: string }>({ action: "sign", key: r.key, uploadId: r.uploadId, partNumber: part });
          const etag = await putPart(url, blob.slice(a, b), (x) => { live.set(part, x); tick(); }, track);
          live.delete(part);
          done.set(part, etag);
          sent += b - a;
          tick();
          break;
        } catch (e) {
          live.delete(part);
          if (e instanceof Stopped || stop.current) throw e;
          // Nothing has ever gone through: a refused PUT is the bucket's CORS, and retrying will not help.
          const nothingYet = done.size === 0 && sent === 0;
          if ((e instanceof NoEtag || e instanceof Dropped) && nothingYet && attempt >= 2) throw new NoEtag();
          // Parts went through before, so a dropped one is the network: keep trying for a while.
          if (attempt >= (e instanceof Dropped ? DROP_TRIES : TRIES)) throw e;
          await new Promise((res) => setTimeout(res, Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempt - 1))));
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
  const stopRef = useRef(false);
  const xhrs = useRef(new Set<XMLHttpRequest>());
  const tourRef = useRef(tour);
  tourRef.current = tour;

  const refresh = useCallback(async () => {
    try {
      const out = await api<{ r2: R2Summary; objects: Obj[]; tour: Tour }>();
      setR2(out.r2);
      setObjects(out.objects);
      setTour(out.tour);
      setTourDirty(false);
      setListError(null);
    } catch (e) {
      setListError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = (id: number, p: Partial<Item>) => setItems((all) => all.map((it) => (it.id === id ? { ...it, ...p } : it)));

  function addFiles(list: FileList | null) {
    if (!list) return;
    const added: Item[] = [];
    for (const file of Array.from(list)) {
      const kind = kindOfFile(file.name);
      if (!kind) continue;
      added.push({
        id: nextId++, file, scene: sceneIdFromFileName(file.name), title: "", convert: kind === "master",
        step: "waiting", sent: 0, total: file.size, note: "",
      });
    }
    setItems((all) => [...all.filter((i) => i.step !== "done"), ...added]);
  }

  async function saveTour(next: Tour) {
    const { tour: saved } = await api<{ tour: Tour }>({ action: "tour", tour: next });
    setTour(saved);
    setTourDirty(false);
    return saved;
  }

  async function runOne(it: Item) {
    const kind = kindOfFile(it.file.name)!;
    const progress = (step: Step) => (sent: number, total: number) => patch(it.id, { step, sent, total });
    let webKey: string;
    if (kind === "master") {
      await uploadBlob(it.file, it.file.name, it.scene, progress("master"), stopRef, xhrs.current);
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
      webKey = (await uploadBlob(blob, name, it.scene, progress("web"), stopRef, xhrs.current)).key;
    } else {
      webKey = (await uploadBlob(it.file, it.file.name, it.scene, progress("web"), stopRef, xhrs.current)).key;
    }
    const title = it.title.trim();
    await saveTour(upsertScene(tourRef.current, it.scene, webKey, title ? { en: title, fa: title } : undefined));
    patch(it.id, { step: "done" });
  }

  async function runAll() {
    setRunning(true);
    setMessage(null);
    stopRef.current = false;
    for (const it of items) {
      if (it.step === "done" || !isSceneId(it.scene)) continue;
      try {
        await runOne(it);
      } catch (e) {
        if (e instanceof Stopped) {
          patch(it.id, { step: "paused", note: "Paused. «Start» resumes from the last finished part." });
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
          its master, converted here to .spz for the viewer, and added to the tour.
        </p>
        <input
          type="file"
          multiple
          accept=".ply,.spz,.sog,.ksplat,.splat,.rad"
          disabled={running}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          className="block w-full text-[14px] text-white/80 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-white/90"
        />

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((it) => {
              const isMaster = kindOfFile(it.file.name) === "master";
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
              <span className="ms-auto flex gap-2">
                {o.kind === "web" && o.url && <a className={SMALL} href={`/vca/splat?src=${encodeURIComponent(o.url)}`}>View alone</a>}
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
