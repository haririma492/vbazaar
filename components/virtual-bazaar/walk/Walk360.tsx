"use client";

/**
 * THE 360° WALK — the real video, not a reconstruction.
 *
 * The operator walked the place with an Insta360; this plays that walk back as
 * an equirectangular video wrapped round the visitor, at the camera's own
 * quality. The visitor cannot step off the path the camera took, but along it
 * everything is exactly as filmed:
 *
 *   stick up      walk on (the video plays forward; further up, faster)
 *   stick down    walk back (it plays backward)
 *   let go        stand still (it pauses)
 *   stick ←/→, a finger, or the phone itself   look round
 *   the bar at the bottom                      jump along the path
 *
 * ⚠️ BACKWARD IS SEEKING, NOT PLAYING. No browser plays a video in reverse, so
 * walking back steps `currentTime` down one seek at a time. It is only smooth
 * when the video has a keyframe every few frames: `scripts/splats/walk-video.md`
 * gives the ffmpeg line (`-g 10`). A camera's own file (a keyframe every
 * second or two) walks back in jerks.
 *
 * STEPPING INTO A SHOP (founder, 2026-10-10: "360 video mp4 quality and choice
 * to break away and enter in a shop"). `scenes/walks.json`
 * (`lib/splats/walks.ts`) puts DOORS on a walk: a moment of the video and a
 * direction in it. Near one, looking its way, «Step inside» cross-fades to
 * the shop's own video at its start; «Back to the street» cross-fades back to
 * the street at the door, facing the street. The shop's video starts loading
 * 6 s before its door, so the step is immediate.
 *
 *   ⚠️ ONE VIDEO PLAYS AT A TIME. The next one only loads (paused) while the
 *   visitor nears a door; the one left behind is released — its decoder
 *   memory too — as soon as the cross-fade ends. Two 8K videos at once crash
 *   a phone.
 *
 *   ⚠️ THE SPHERE TURNS, NOT THE VISITOR. Each video's sphere has a `spin`, so
 *   whatever the visitor faces when they step in becomes the shop video's
 *   forward (and the street's "away from the door" on return): the view never
 *   jumps. Doors are stored in the video's OWN frame (`yaw`, positive right),
 *   so `videoYaw = heading + spin`.
 *
 *   A SHOP FILMED WITH A PHONE (founder, 2026-10-10: the first interiors are
 *   iPhone videos) is FLAT, not 360°: a door to a phone video (`.mov`, kept
 *   privately by the uploader and shown through `/api/splats/walks/video`),
 *   a door ticked «flat», or any video that is not 2:1 is shown full screen
 *   as a plain <video> over the sphere — the same stick, the same fades, no
 *   looking round.
 *
 *   /vca/walk                               the walk visitors start on (walks.json `start`)
 *   /vca/walk?v=scenes/<scene>/<file>.mp4   a video in the scenes bucket
 *   /vca/walk?src=<url>                     any video (https, or this site); no doors
 *   …&debug=1                               resolution, buffering, rate
 *   …&edit=1                                place doors (operator token, like /vca/splat)
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import WalkStick from "../splat/WalkStick";
import { deviceQuaternion, hasDeviceOrientation, requestDeviceOrientation, screenAngle } from "../scene/deviceOrientation";
import { readAdminToken } from "@/lib/admin/useAdminMode";
import {
  DEFAULT_PITCH, PRELOAD_DT, addDoor, angleDiff, doorsAround, signAt, sortPins, type SignPin, doorsNear, emptyWalks, isFlatDoor, isPhoneCopy, isPhoneVideoKey, isVideoKey, isWalkKey,
  looksFlat, parseWalks, phoneKeyOf, removeDoor, returnPoint, setStart, updateDoor, walkOf, wrapAngle, type WalkDoor, type Walks,
} from "@/lib/splats/walks";

/** «Slow / Normal / Fast»: how fast full stick plays the walk (1 = as filmed). */
const SPEEDS = [
  { label: "آهسته · Slow", rate: 0.5 },
  { label: "معمولی · Normal", rate: 1 },
  { label: "تند · Fast", rate: 2 },
];
const SPEED_KEY = "sk-walk-speed";
/** Full steering turns this fast (rad/s). */
const TURN_RATE = 0.8;
/** How long starting, stopping and turning take to settle (s). */
const EASE_S = 0.35;
/** Below this the walk stands still. */
const DEAD = 0.04;
/** Forward slower than this is stepped like backward: browsers play no slower smoothly. */
const MIN_PLAY_RATE = 0.25;
/** The cross-fade between the street and a shop (ms). */
const FADE_MS = 400;
/** A door's sign floats this far out, in the direction its pins give (`signAt`). */
const MARK_R = 20;
const UP = new THREE.Vector3(0, 1, 0);
/** `?v=` as it was always accepted (a little looser than `isWalkKey`). */
const V_RE = /^scenes\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/;

function safeSrc(raw: string): string | null {
  try {
    const u = new URL(raw, window.location.href);
    if (u.protocol === "https:" || u.origin === window.location.origin) return u.href;
    if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) return u.href;
  } catch {
    /* fall through */
  }
  return null;
}

let basePromise: Promise<string | null> | null = null;
/** The scenes bucket's public address (`/api/splats/config`), asked once. */
function sceneBase(): Promise<string | null> {
  basePromise ??= fetch("/api/splats/config", { cache: "no-store" })
    .then((r) => r.json() as Promise<{ base: string | null }>)
    .then(({ base }) => (base ? base.replace(/\/+$/, "") : null))
    .catch(() => null);
  return basePromise;
}

const isTouch = () => (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) ?? false;

const phoneCopies = new Map<string, Promise<boolean>>();
/** Whether the lighter phone copy (`<name>-phone.mp4`) was uploaded next to a walk: one HEAD, remembered. */
function hasPhoneCopy(url: string): Promise<boolean> {
  let p = phoneCopies.get(url);
  if (!p) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    p = fetch(url, { method: "HEAD", signal: ac.signal, cache: "no-store" }).then((r) => r.ok).catch(() => false).finally(() => clearTimeout(timer));
    phoneCopies.set(url, p);
  }
  return p;
}

/**
 * Where a video key is played from. A phone (a touch screen) gets the 4K
 * `-phone.mp4` copy when one was uploaded next to the original — same
 * timeline, same frame, so the doors fit both. A phone video of a shop
 * (`masters/…`) comes through the server's short-lived link.
 */
async function srcFor(key: string): Promise<string | null> {
  if (isPhoneVideoKey(key)) return `/api/splats/walks/video?key=${encodeURIComponent(key)}`;
  const base = await sceneBase();
  if (!base) return null;
  if (isTouch() && !isPhoneCopy(key)) {
    const phone = `${base}/${phoneKeyOf(key)}`;
    if (await hasPhoneCopy(phone)) return phone;
  }
  return `${base}/${key}`;
}

async function loadWalks(): Promise<Walks> {
  try {
    const res = await fetch("/api/splats/walks", { cache: "no-store" });
    const json = await res.json();
    return json?.ok ? parseWalks(json.walks) : emptyWalks();
  } catch {
    // ⚠️ NO WALKS IS NOT AN ERROR: the single-video walk works without them.
    return emptyWalks();
  }
}

const mmss = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "–:––");
const shortKey = (k: string | null) => (k ? k.replace(/^(scenes|masters)\//, "") : "(a video by address)");

/** One video on screen (or loading for it): a sphere round the visitor, or flat over everything. */
type Layer = {
  key: string | null;
  video: HTMLVideoElement;
  /** Flat by its door or its key; else decided by its shape when its size is known. */
  forcedFlat: boolean;
  flat: boolean;
  spin: number;
  texture: THREE.VideoTexture | null;
  material: THREE.MeshBasicMaterial | null;
  mesh: THREE.Mesh | null;
  ready: Promise<void>;
  fail: (why: string) => void;
  released: boolean;
  purpose: "main" | "door" | "back";
};

/** What the screen shows about the engine, a few times a second. */
type View = {
  key: string | null;
  inside: number;
  flat: boolean;
  near: WalkDoor[];
  atEnd: boolean;
  busy: boolean;
};

type Engine = {
  video: () => HTMLVideoElement;
  setMove: (x: number, y: number) => void;
  setGyro: (on: boolean) => void;
  setSpeed: (rate: number) => void;
  setWalks: (w: Walks) => void;
  enter: (door: WalkDoor) => void;
  back: () => void;
  /** Where the visitor is, in the current video's own frame (the operator's «Door here»). */
  here: () => { key: string | null; t: number; yaw: number; flat: boolean };
  /** Jump to a door's moment and face it. */
  goTo: (door: WalkDoor) => void;
  /** Edit mode: the next tap on the picture is a sign pin (null: taps are a visitor's again). */
  setPick: (f: ((pin: SignPin) => void) | null) => void;
  /** Edit mode: the door being placed, its sign shown as it is pinned. */
  setPreview: (door: WalkDoor | null) => void;
};

/** A door's sign — «Step inside · name» (and the Persian name) on an amber card — drawn once. */
function signTexture(en: string, fa?: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 300;
  const g = c.getContext("2d")!;
  const r = 36;
  g.beginPath();
  g.moveTo(r, 8);
  g.arcTo(632, 8, 632, 292, r);
  g.arcTo(632, 292, 8, 292, r);
  g.arcTo(8, 292, 8, 8, r);
  g.arcTo(8, 8, 632, 8, r);
  g.closePath();
  g.fillStyle = "rgba(120,72,6,0.72)";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "rgba(252,211,77,0.95)";
  g.stroke();
  g.textAlign = "center";
  g.fillStyle = "rgba(255,251,235,1)";
  g.shadowColor = "rgba(0,0,0,0.8)";
  g.shadowBlur = 8;
  g.font = "700 54px system-ui, sans-serif";
  g.fillText("Step inside ›", 320, fa ? 92 : 112);
  g.font = "600 50px system-ui, sans-serif";
  g.fillText(en.length > 20 ? `${en.slice(0, 19)}…` : en, 320, fa ? 168 : 200);
  if (fa) {
    g.font = "600 46px system-ui, sans-serif";
    g.direction = "rtl";
    g.fillText(`ورود · ${fa.length > 18 ? `${fa.slice(0, 17)}…` : fa}`, 320, 246);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function Walk360() {
  const host = useRef<HTMLDivElement>(null);
  const flatHost = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "walking" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [time, setTime] = useState({ now: 0, total: 0 });
  const [speedIx, setSpeedIx] = useState(1);
  const [gyro, setGyro] = useState<"off" | "on" | "refused">("off");
  const [debug, setDebug] = useState(false);
  const [info, setInfo] = useState("");
  const [view, setView] = useState<View>({ key: null, inside: 0, flat: false, near: [], atEnd: false, busy: false });
  const [walks, setWalks] = useState<Walks>(emptyWalks());
  const [editing, setEditing] = useState(false);
  /** The walks as last read from (or saved to) the server: the `base` of a merged save. */
  const serverWalks = useRef<Walks>(emptyWalks());

  useEffect(() => {
    const el = host.current;
    const flatEl = flatHost.current;
    if (!el || !flatEl) return;
    const params = new URLSearchParams(window.location.search);
    setDebug(params.get("debug") === "1");
    // ?debug=1&fade=<ms>: a slower cross-fade, to look at it (and screenshot it).
    const fadeMs = params.get("debug") === "1" && Number(params.get("fade")) > 0 ? Math.min(10000, Number(params.get("fade"))) : FADE_MS;
    setEditing(params.get("edit") === "1" && Boolean(readAdminToken()));
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, el.clientWidth / el.clientHeight, 0.1, 200);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const geometry = new THREE.SphereGeometry(50, 128, 64);
    geometry.scale(-1, 1, 1); // seen from inside

    let walksNow: Walks = emptyWalks();
    let current: Layer | null = null;
    let pending: Layer | null = null;
    /** The doors stepped through, innermost last: «Back to the street» pops one. */
    const trail: Array<{ key: string; door: WalkDoor }> = [];
    let busy = false;
    let fade: { from: Layer; to: Layer; start: number; done: () => void } | null = null;

    // ── A video: made, loaded (paused, at its moment), shown, released ────
    const errorText = (l: Layer) => {
      if (l.key && /\.mov$/i.test(l.key)) {
        return "This browser cannot play this shop's video (an iPhone .mov, usually HEVC: Safari plays it, Chrome often does not). Export it from the iPhone as an .mp4 (H.264, «Most Compatible») and upload that.";
      }
      if (l.purpose === "main") return "The walk video could not be loaded. Is the bucket's CORS set, and is the file an MP4 (H.264)?";
      return "This video could not be loaded in this browser. An .mp4 in H.264 plays everywhere.";
    };

    function makeLayer(opts: { key: string | null; src?: string | null; t?: number; flat?: boolean; purpose: Layer["purpose"] }): Layer {
      const phoneVideo = Boolean(opts.key && isPhoneVideoKey(opts.key));
      const video = document.createElement("video");
      // A sphere's WebGL texture needs the bucket's CORS. A phone video is
      // only ever shown flat (a plain <video>), so it asks for none — its
      // signed link is to the private bucket.
      if (!phoneVideo) video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "auto";
      video.loop = false;
      Object.assign(video.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", background: "#000", opacity: "0" });
      const forcedFlat = Boolean(opts.flat) || phoneVideo;
      const at = Math.max(0, opts.t ?? 0);
      const layer: Layer = {
        key: opts.key, video, forcedFlat, flat: forcedFlat, spin: 0, texture: null, material: null, mesh: null,
        ready: Promise.resolve(), fail: () => {}, released: false, purpose: opts.purpose,
      };
      layer.ready = new Promise<void>((resolve, reject) => {
        let settled = false;
        const timers: number[] = [];
        const finish = (why?: string) => {
          if (settled) return;
          settled = true;
          timers.forEach((t) => window.clearTimeout(t));
          if (why) reject(new Error(why));
          else resolve();
        };
        layer.fail = finish;
        const check = () => {
          if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - Math.min(at, video.duration || at)) < 0.5) finish();
        };
        video.addEventListener("loadedmetadata", () => {
          layer.flat = forcedFlat || looksFlat(video.videoWidth, video.videoHeight);
          if (at > 0) video.currentTime = Math.min(at, Math.max(0, video.duration - 0.05));
          check();
        });
        for (const ev of ["loadeddata", "canplay", "seeked"]) video.addEventListener(ev, check);
        video.addEventListener("error", () => finish(errorText(layer)));
        // iOS may not decode a frame of a video nobody plays: play a moment, then stand.
        timers.push(window.setTimeout(() => {
          if (settled || layer.released || video.readyState >= 2) return;
          video.play().then(() => {
            video.pause();
            video.currentTime = at;
          }).catch(() => {});
        }, 1500));
        timers.push(window.setTimeout(() => finish("The video took too long to load."), 45000));
      });
      layer.ready.catch(() => {}); // a preload nobody used fails quietly
      void (async () => {
        const src = opts.src !== undefined ? opts.src : opts.key ? await srcFor(opts.key) : null;
        if (layer.released) return;
        if (!src) return layer.fail("No address for the video: is NEXT_PUBLIC_SPLAT_BASE_URL set?");
        video.src = src;
        video.load();
      })();
      return layer;
    }

    /** Put a loaded layer on screen, invisible: the cross-fade brings it in. */
    function show(l: Layer, opacity: number) {
      if (l.flat) {
        l.video.style.opacity = String(opacity);
        flatEl!.appendChild(l.video);
        return;
      }
      const texture = new THREE.VideoTexture(l.video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.anisotropy = maxAniso;
      texture.needsUpdate = true; // the paused frame, before any new one is presented
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      // The middle of an equirectangular frame is where the camera faced; turn
      // it to −Z, where a three.js camera looks at yaw 0 — then by its spin.
      mesh.rotation.y = -Math.PI / 2 + l.spin;
      Object.assign(l, { texture, material, mesh });
      scene.add(mesh);
    }

    /** Let go of a video entirely — its download and its decoder memory. */
    function release(l: Layer | null) {
      if (!l || l.released) return;
      l.released = true;
      l.fail("released");
      l.video.pause();
      l.video.removeAttribute("src");
      l.video.load();
      l.video.remove();
      if (l.mesh) scene.remove(l.mesh);
      l.texture?.dispose();
      l.material?.dispose();
      l.mesh = null;
    }

    const lookDir = new THREE.Vector3();
    /** Which way the visitor faces: 0 is −Z, positive right. */
    const heading = () => {
      camera.getWorldDirection(lookDir);
      return Math.atan2(lookDir.x, -lookDir.z);
    };
    const videoYaw = () => (current ? wrapAngle(heading() + current.spin) : 0);

    function crossFade(from: Layer, to: Layer): Promise<void> {
      // A flat video always lies over the sphere: going from flat back to a
      // sphere, the sphere is drawn whole underneath and the flat one fades out.
      show(to, to.flat || !from.flat ? 0 : 1);
      if (to.mesh) to.mesh.renderOrder = 1;
      if (from.mesh) from.mesh.renderOrder = 0;
      return new Promise((done) => (fade = { from, to, start: performance.now(), done }));
    }

    async function switchTo(to: Layer, spinFor: (l: Layer) => number) {
      const from = current!;
      busy = true;
      report(true);
      from.video.pause();
      rate = 0;
      stepDebt = 0;
      try {
        await to.ready;
      } catch (e) {
        release(to);
        busy = false;
        if ((e as Error).message !== "released") setNotice((e as Error).message);
        report(true);
        return false;
      }
      if (disposed) return false;
      to.spin = spinFor(to);
      await crossFade(from, to);
      current = to;
      release(from);
      if (to.mesh) to.mesh.renderOrder = 0;
      setInfo(`${to.video.videoWidth}×${to.video.videoHeight} · ${mmss(to.video.duration)}${to.flat ? " · flat" : ""}`);
      busy = false;
      return true;
    }

    async function enter(door: WalkDoor) {
      if (busy || !current?.key) return;
      const fromKey = current.key;
      let to = pending && pending.key === door.to && pending.purpose === "door" ? pending : null;
      pending = to ? null : pending;
      if (!to) {
        release(pending);
        pending = null;
        to = makeLayer({ key: door.to, t: 0, flat: isFlatDoor(door), purpose: "door" });
      }
      if (isFlatDoor(door)) to.forcedFlat = to.flat = true;
      // What the visitor faces now becomes the shop video's forward.
      const h = heading();
      if (await switchTo(to, () => -h)) trail.push({ key: fromKey, door });
      report(true);
    }

    async function back() {
      const top = trail[trail.length - 1];
      if (busy || !top || !current) return;
      const rp = returnPoint(top.door);
      let to = pending && pending.key === top.key && pending.purpose === "back" ? pending : null;
      pending = to ? null : pending;
      if (!to) {
        release(pending);
        pending = null;
        to = makeLayer({ key: top.key, t: rp.t, purpose: "back" });
      }
      // The street's "away from the door" appears where the visitor faces now.
      const h = heading();
      if (await switchTo(to, () => rp.yaw - h)) trail.pop();
      report(true);
    }

    // ── Telling the screen ────────────────────────────────────────────────
    let shownAt = 0;
    let lastView = "";
    function report(force = false) {
      const now = performance.now();
      if (!force && now - shownAt < 250) return;
      shownAt = now;
      const v = current?.video;
      if (v) setTime({ now: v.currentTime, total: v.duration });
      const walk = walkOf(walksNow, current?.key);
      const near = current && !busy && v && v.readyState >= 1 ? doorsNear(walk, v.currentTime, videoYaw(), current.flat ? { dyaw: 4 } : {}) : [];
      const atEnd = Boolean(v && trail.length && Number.isFinite(v.duration) && v.currentTime >= v.duration - 0.3);
      const next: View = { key: current?.key ?? null, inside: trail.length, flat: current?.flat ?? false, near, atEnd, busy };
      const s = JSON.stringify(next);
      if (s !== lastView) {
        lastView = s;
        setView(next);
      }
    }

    // ── Doors on the sphere, and the next video loading ahead ─────────────
    // ⚠️ THE SIGN IS ON THE DOOR, AND IT IS THE BUTTON (founder, 2026-10-10:
    // "I need ability to move the Step Inside rectangle exactly where the door
    // is"). Each door's «Step inside» card sits where `signAt` says — between
    // the pins the operator put on the door — and a tap on it steps inside.
    const markers = new Map<string, { sprite: THREE.Sprite; door: WalkDoor }>();
    let preview: WalkDoor | null = null;
    let pick: ((pin: SignPin) => void) | null = null;
    function updateDoors() {
      const v = current?.video;
      const walk = walkOf(walksNow, current?.key);
      const t = v?.currentTime ?? 0;
      const around = current && !busy && v && v.readyState >= 1 ? doorsAround(walk, t) : [];
      const shown = preview && current && !current.flat ? [...around.filter((d) => d.id !== preview!.id), preview] : around;
      const want = new Set<string>();
      if (current && !current.flat) {
        for (const d of shown) {
          const sign = signAt(d, t);
          if (!sign) continue;
          const id = `${current.key}#${d.id}#${d.label.en}#${d.label.fa ?? ""}`;
          want.add(id);
          let m = markers.get(id);
          if (!m) {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(d.label.en, d.label.fa), depthTest: false, depthWrite: false, transparent: true }));
            sprite.scale.set(7.4, 3.45, 1);
            sprite.renderOrder = 10;
            m = { sprite, door: d };
            markers.set(id, m);
            scene.add(sprite);
          }
          m.door = d;
          const h = sign.yaw - current.spin;
          const cp = Math.cos(sign.pitch);
          m.sprite.position.set(Math.sin(h) * cp * MARK_R, Math.sin(sign.pitch) * MARK_R, -Math.cos(h) * cp * MARK_R);
          (m.sprite.material as THREE.SpriteMaterial).opacity = d === preview ? 0.85 : 1;
        }
      }
      for (const [id, m] of markers) {
        if (want.has(id)) continue;
        const s = m.sprite;
        scene.remove(s);
        (s.material as THREE.SpriteMaterial).map?.dispose();
        s.material.dispose();
        markers.delete(id);
      }

      if (busy || !current) return;
      // ⚠️ ONE AHEAD, NEVER MORE: the nearest door's shop, or the street to go back to.
      let wantKey: { key: string; t: number; flat: boolean; purpose: Layer["purpose"] } | null = null;
      if (around[0]) wantKey = { key: around[0].to, t: 0, flat: isFlatDoor(around[0]), purpose: "door" };
      const top = trail[trail.length - 1];
      if (!wantKey && top && v && Number.isFinite(v.duration) && v.duration - t < PRELOAD_DT) {
        wantKey = { key: top.key, t: returnPoint(top.door).t, flat: false, purpose: "back" };
      }
      if (pending && (!wantKey || pending.key !== wantKey.key || pending.purpose !== wantKey.purpose)) {
        release(pending);
        pending = null;
      }
      if (!pending && wantKey) pending = makeLayer(wantKey);
    }

    engine.current = {
      video: () => current?.video ?? document.createElement("video"),
      setMove(x, y) {
        stickX = x;
        stickY = y;
      },
      setGyro(on) {
        gyroOn = on;
      },
      setSpeed(r) {
        maxRate = r;
      },
      setWalks(w) {
        walksNow = w;
      },
      enter: (d) => void enter(d),
      setPick(f) {
        pick = f;
      },
      setPreview(d) {
        preview = d;
      },
      back: () => void back(),
      here: () => ({ key: current?.key ?? null, t: current?.video.currentTime ?? 0, yaw: videoYaw(), flat: current?.flat ?? false }),
      goTo(door) {
        if (!current || busy) return;
        current.video.pause();
        rate = 0;
        current.video.currentTime = door.t;
        const sign = signAt(door, door.t, Infinity) ?? { yaw: door.yaw, pitch: DEFAULT_PITCH };
        if (!current.flat) turnYaw += angleDiff(sign.yaw - current.spin, heading());
        pitch = sign.pitch;
      },
    };

    // ── The first video: ?src, ?v, or the walk visitors start on ──────────
    void (async () => {
      const w = await loadWalks();
      if (disposed) return;
      walksNow = w;
      serverWalks.current = w;
      setWalks(w);
    })();
    void (async () => {
      const raw = params.get("src");
      let layer: Layer | null = null;
      if (raw) {
        layer = makeLayer({ key: null, src: safeSrc(raw), purpose: "main" });
      } else {
        let key = params.get("v") || "";
        if (!key) key = (await loadWalks()).start ?? "";
        if (disposed) return;
        if (V_RE.test(key) || isWalkKey(key)) layer = makeLayer({ key, purpose: "main" });
      }
      if (!layer) {
        setPhase("error");
        setError("No walk video: open with ?v=scenes/<scene>/<file>.mp4 (from /operator/splats).");
        return;
      }
      current = layer;
      layer.video.addEventListener("loadedmetadata", () => {
        if (current !== layer) return;
        setTime({ now: layer!.video.currentTime, total: layer!.video.duration });
        setInfo(`${layer!.video.videoWidth}×${layer!.video.videoHeight} · ${mmss(layer!.video.duration)}${layer!.flat ? " · flat" : ""}`);
      });
      try {
        await layer.ready;
      } catch (e) {
        if (disposed || layer.released) return;
        setPhase("error");
        setError((e as Error).message);
        return;
      }
      if (disposed) return;
      show(layer, 1);
      report(true);
      setPhase((p) => (p === "loading" ? "ready" : p));
    })();

    let stickX = 0;
    let stickY = 0;
    let maxRate = SPEEDS[1].rate;
    let gyroOn = false;
    let gyroHave = false;
    const gyroQ = new THREE.Quaternion();
    const turnQ = new THREE.Quaternion();
    let yaw = 0;
    let pitch = 0;
    let turnYaw = 0;
    let velTurn = 0;
    let rate = 0; // eased walk rate: + forward, − back, in "times as filmed"
    let stepDebt = 0; // seconds of stepping owed while a seek was in flight

    // ── Looking: finger, wheel/pinch, phone ───────────────────────────────
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const zoom = (f: number) => {
      camera.fov = THREE.MathUtils.clamp(camera.fov * f, 30, 100);
      camera.updateProjectionMatrix();
    };
    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    let tapFrom: { x: number; y: number; at: number } | null = null;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tapFrom = pointers.size === 1 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
    };
    // A tap (not a drag): on a door's sign, step inside; in edit mode while
    // pinning, the spot tapped is where the sign goes at this moment.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function onTap(x: number, y: number) {
      if (!current || current.flat || busy) return;
      const r = canvas.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (pick) {
        const d = raycaster.ray.direction;
        const worldYaw = Math.atan2(d.x, -d.z);
        pick({ t: current.video.currentTime, yaw: wrapAngle(worldYaw + current.spin), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) });
        return;
      }
      const hit = raycaster.intersectObjects([...markers.values()].map((m) => m.sprite), false)[0];
      const m = hit && [...markers.values()].find((x) => x.sprite === hit.object);
      if (m && m.door !== preview) void enter(m.door);
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      // A flat video has no "round" to look at.
      if (pointers.size === 1 && !(gyroOn && gyroHave) && !current?.flat) {
        const k = (camera.fov / el.clientHeight) * (Math.PI / 180);
        yaw += (e.clientX - prev.x) * k;
        pitch = THREE.MathUtils.clamp(pitch + (e.clientY - prev.y) * k, -1.45, 1.45);
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoom(pinch / d);
        pinch = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      if (tapFrom && e.type === "pointerup" && Math.hypot(e.clientX - tapFrom.x, e.clientY - tapFrom.y) < 8 && performance.now() - tapFrom.at < 500) onTap(e.clientX, e.clientY);
      tapFrom = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoom(Math.exp(THREE.MathUtils.clamp(px, -40, 40) * 0.0006));
    };
    const onBlur = () => keys.clear();
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      deviceQuaternion(gyroQ, e.alpha, e.beta, e.gamma, screenAngle());
      gyroHave = true;
    };
    const keys = new Set<string>();
    const typing = (t: EventTarget | null) => {
      const tag = (t as HTMLElement | null)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return; // the operator typing a door's name is not walking
      if (e.type === "keydown") keys.add(e.key.toLowerCase());
      else keys.delete(e.key.toLowerCase());
    };
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);

    // ── The loop: look, then walk the video ───────────────────────────────
    const clock = new THREE.Clock();
    const look = new THREE.Euler(0, 0, 0, "YXZ");
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const ease = 1 - Math.exp(-dt / EASE_S);
      const shape = (v: number) => Math.sign(v) * v * v;

      let wantTurn = shape(stickX);
      if (keys.has("d") || keys.has("arrowright")) wantTurn = 1;
      if (keys.has("a") || keys.has("arrowleft")) wantTurn = -1;
      if (current?.flat) wantTurn = 0;
      velTurn += (wantTurn * TURN_RATE - velTurn) * ease;
      turnYaw += velTurn * dt;
      if (gyroOn && gyroHave) camera.quaternion.copy(turnQ.setFromAxisAngle(UP, -turnYaw)).multiply(gyroQ);
      else camera.quaternion.setFromEuler(look.set(-pitch, -(yaw + turnYaw), 0));

      let wantRate = shape(-stickY);
      if (keys.has("w") || keys.has("arrowup")) wantRate = 1;
      if (keys.has("s") || keys.has("arrowdown")) wantRate = -1;
      if (busy) wantRate = 0;
      rate += (wantRate * maxRate - rate) * ease;

      const video = current?.video;
      if (video && !busy && video.readyState >= 2 && Number.isFinite(video.duration)) {
        if (rate >= MIN_PLAY_RATE) {
          // Walking on at a pace a browser plays smoothly: let it play.
          video.playbackRate = Math.min(4, rate);
          if (video.paused && video.currentTime < video.duration - 0.05) void video.play().catch(() => {});
          stepDebt = 0;
        } else {
          if (!video.paused) video.pause();
          if (Math.abs(rate) > DEAD) {
            // Walking back, or creeping on: step the time, one seek in flight at a time.
            stepDebt += rate * dt;
            if (!video.seeking && Math.abs(stepDebt) >= 1 / 60) {
              const to = THREE.MathUtils.clamp(video.currentTime + stepDebt, 0, video.duration);
              stepDebt = 0;
              if (to !== video.currentTime) video.currentTime = to;
            }
          } else stepDebt = 0;
        }
      }

      if (fade) {
        const k = Math.min(1, (performance.now() - fade.start) / fadeMs);
        const { from, to } = fade;
        if (to.flat) to.video.style.opacity = String(k);
        else if (from.flat) from.video.style.opacity = String(1 - k);
        else if (to.material) to.material.opacity = k;
        if (k >= 1) {
          const done = fade.done;
          fade = null;
          done();
        }
      }

      updateDoors();
      renderer.render(scene, camera);
      report();
    });

    return () => {
      disposed = true;
      engine.current = null;
      renderer.setAnimationLoop(null);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      release(current);
      release(pending);
      for (const { sprite } of markers.values()) {
        (sprite.material as THREE.SpriteMaterial).map?.dispose();
        sprite.material.dispose();
      }
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  // Walking speed, remembered on this device.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SPEED_KEY);
      const saved = raw == null ? NaN : Number(raw);
      if (Number.isInteger(saved) && saved >= 0 && saved < SPEEDS.length) setSpeedIx(saved);
    } catch {
      /* private mode: Normal */
    }
  }, []);
  useEffect(() => {
    engine.current?.setSpeed(SPEEDS[speedIx].rate);
  }, [speedIx]);
  useEffect(() => {
    engine.current?.setWalks(walks);
  }, [walks]);

  /**
   * «Start walking». ⚠️ ONE TAP, TWO PERMISSIONS, IN THIS ORDER: iOS only
   * shares the phone's motion when asked inside a tap, before any other await;
   * then the video is started once so later play() calls are allowed.
   */
  async function start() {
    const v = engine.current?.video();
    // Phone motion only on a touch screen: a computer reports the API but has
    // no sensor, and would be left unable to look with the mouse.
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const ok = touch && hasDeviceOrientation() && (await requestDeviceOrientation());
    engine.current?.setGyro(ok);
    setGyro(ok ? "on" : "off");
    if (v) {
      try {
        await v.play();
        v.pause();
      } catch {
        /* the stick will try again */
      }
    }
    setPhase("walking");
  }

  async function toggleGyro() {
    if (gyro === "on") {
      engine.current?.setGyro(false);
      return setGyro("off");
    }
    const ok = hasDeviceOrientation() && (await requestDeviceOrientation());
    engine.current?.setGyro(ok);
    setGyro(ok ? "on" : "refused");
  }

  const door = view.near[0];

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={host} className="absolute inset-0" />
      {/* A flat (phone) video of a shop is shown here, over the sphere. */}
      <div ref={flatHost} className="pointer-events-none absolute inset-0" />

      {phase === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] text-white/85">
          در حال آماده‌سازی… · Getting ready…
        </div>
      )}
      {phase === "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <button onClick={() => void start()} className="rounded-full border border-amber-300/70 bg-amber-300/25 px-8 py-4 text-[18px] font-bold text-amber-50">
            شروع قدم زدن · Start walking
          </button>
        </div>
      )}
      {phase === "error" && (
        <div dir="ltr" className="absolute inset-x-4 top-16 rounded-xl bg-black/75 p-3 text-center text-[14px] text-rose-200">{error}</div>
      )}
      {notice && (
        <button dir="ltr" onClick={() => setNotice(null)} className="absolute inset-x-4 top-16 z-20 rounded-xl bg-black/80 p-3 text-center text-[14px] text-rose-200">
          {notice} <span className="text-white/50">(tap to close)</span>
        </button>
      )}

      {debug && (
        <div dir="ltr" className="pointer-events-none absolute bottom-16 left-3 rounded-xl bg-black/60 p-2 font-mono text-[11px] text-white/80">
          {info} · {mmss(time.now)} · {shortKey(view.key)}
        </div>
      )}

      {phase === "walking" && (
        <>
          <WalkStick onMove={(x, y) => engine.current?.setMove(x, y)} />
          <button
            dir="ltr"
            onClick={() => {
              const next = (speedIx + 1) % SPEEDS.length;
              setSpeedIx(next);
              try { window.localStorage.setItem(SPEED_KEY, String(next)); } catch { /* fine */ }
            }}
            className="absolute bottom-[15.5rem] right-5 w-40 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 text-[12px] text-white/85"
          >
            {SPEEDS[speedIx].label}
          </button>
          {!view.flat && (
            <button
              dir="ltr"
              onClick={() => void toggleGyro()}
              className="absolute bottom-[18rem] right-5 w-40 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 text-[12px] text-white/85"
            >
              {gyro === "on" ? "نگاه با انگشت · Look by finger" : gyro === "refused" ? "گوشی اجازه نداد" : "نگاه با گوشی · Look by phone"}
            </button>
          )}

          {/* A door in reach: step inside. */}
          {/* In a 360° walk the sign on the door is the button; a flat video has no round to put it in. */}
          {door && !view.busy && view.flat && (
            <button
              dir="ltr"
              onClick={() => engine.current?.enter(door)}
              className="absolute bottom-24 left-4 z-10 max-w-[calc(100%-14rem)] rounded-2xl border border-amber-300/80 bg-amber-300/30 px-5 py-3 text-left text-amber-50 shadow-lg backdrop-blur-sm sm:max-w-sm"
            >
              <span className="block text-[17px] font-bold">Step inside · {door.label.en}</span>
              {door.label.fa && <span dir="rtl" className="block text-right text-[15px] text-amber-100/90">ورود · {door.label.fa}</span>}
            </button>
          )}

          {/* Inside a shop: the way back, always. */}
          {view.inside > 0 && !view.busy && !view.atEnd && (
            <button
              dir="ltr"
              onClick={() => engine.current?.back()}
              className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-white/40 bg-black/65 px-5 py-2 text-[15px] font-semibold text-white"
            >
              ← Back to the street · بازگشت به خیابان
            </button>
          )}
          {view.inside > 0 && view.atEnd && !view.busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
              <button
                dir="ltr"
                onClick={() => engine.current?.back()}
                className="rounded-full border border-amber-300/80 bg-amber-300/30 px-8 py-4 text-[18px] font-bold text-amber-50"
              >
                ← Back to the street · بازگشت به خیابان
              </button>
            </div>
          )}
          {view.busy && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-[13px] text-white/80">
              …
            </div>
          )}

          {/* Where along the walk: drag to jump. */}
          <div dir="ltr" className="absolute inset-x-4 bottom-5 flex items-center gap-3 sm:right-56">
            <span className="w-10 text-right font-mono text-[12px] text-white/70">{mmss(time.now)}</span>
            <input
              type="range"
              min={0}
              max={Number.isFinite(time.total) ? time.total : 0}
              step={0.1}
              value={time.now}
              onChange={(e) => {
                const v = engine.current?.video();
                if (v) v.currentTime = Number(e.target.value);
              }}
              aria-label="Where along the walk"
              className="h-8 flex-1 accent-amber-300"
            />
            <span className="w-10 font-mono text-[12px] text-white/70">{mmss(time.total)}</span>
          </div>
        </>
      )}

      {editing && phase !== "loading" && (
        <DoorEditor
          engine={engine}
          walks={walks}
          viewKey={view.key}
          onChange={setWalks}
          serverWalks={serverWalks}
        />
      )}
    </div>
  );
}

// ── The operator's door editor (?edit=1, with the admin token) ────────────────

/** The door being placed, as the walk draws it (its sign, while pinning). */
function draftDoor(d: { id?: string; t: number; yaw: number; en: string; fa: string; to: string; pins: SignPin[] }): WalkDoor {
  return {
    id: d.id ?? "__draft", t: d.t, yaw: d.yaw, to: d.to || "scenes/draft/draft.mp4",
    label: d.fa.trim() ? { en: d.en.trim() || "…", fa: d.fa.trim() } : { en: d.en.trim() || "…" },
    ...(d.pins.length ? { pins: d.pins } : {}),
  };
}

type VideoChoice = { key: string; label: string };

function DoorEditor({ engine, walks, viewKey, onChange, serverWalks }: {
  engine: React.MutableRefObject<Engine | null>;
  walks: Walks;
  viewKey: string | null;
  onChange: (w: Walks) => void;
  serverWalks: React.MutableRefObject<Walks>;
}) {
  const [open, setOpen] = useState(true);
  const [videos, setVideos] = useState<VideoChoice[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  type Draft = { id?: string; t: number; yaw: number; en: string; fa: string; to: string; flat: boolean; pins: SignPin[]; pinning: boolean };
  const [draft, setDraft] = useState<null | Draft>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  // The uploaded videos a door may lead to: the operator API's own listing.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/operator/splats", { headers: { "x-admin-token": readAdminToken() }, cache: "no-store" });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const list: VideoChoice[] = [];
        for (const o of json.objects as Array<{ key: string; kind: string }>) {
          if (o.kind === "web" && isWalkKey(o.key) && !isPhoneCopy(o.key)) list.push({ key: o.key, label: `${shortKey(o.key)} (360°)` });
          else if (o.kind === "master" && isPhoneVideoKey(o.key)) list.push({ key: o.key, label: `${shortKey(o.key)} (phone video, flat)` });
        }
        list.sort((a, b) => a.key.localeCompare(b.key));
        setVideos(list);
      } catch (e) {
        setListError(`The list of uploaded videos could not be read: ${(e as Error).message}`);
        setVideos([]);
      }
    })();
  }, []);

  // The door being placed: its sign shown as it is pinned, and taps on the
  // picture are pins while «Pin the sign» is on.
  const pinning = Boolean(draft?.pinning);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setPick(pinning ? (pin) => setDraft((d) => (d ? { ...d, pins: sortPins([...d.pins.filter((q) => Math.abs(q.t - pin.t) >= 0.05), pin]) } : d)) : null);
    return () => e.setPick(null);
  }, [engine, pinning]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setPreview(draft ? draftDoor(draft) : null);
    return () => e.setPreview(null);
  }, [engine, draft]);

  const walk = walkOf(walks, viewKey);
  const change = (w: Walks) => {
    onChange(w);
    setDirty(true);
    setStatus(null);
  };

  function doorHere() {
    const h = engine.current?.here();
    if (!h?.key) return setStatus({ tone: "bad", text: "Doors can only be placed on a video from the bucket (?v=…), not one opened by address." });
    engine.current?.video().pause();
    const first = (videos?.find((v) => v.key !== h.key && isWalkKey(v.key)) ?? videos?.find((v) => v.key !== h.key))?.key ?? "";
    setDraft({ t: h.t, yaw: h.yaw, en: "", fa: "", to: first, flat: isPhoneVideoKey(first), pins: [], pinning: true });
  }

  function saveDraft() {
    if (!draft || !viewKey) return;
    if (!draft.en.trim()) return setStatus({ tone: "bad", text: "The door needs an English label." });
    if (!isVideoKey(draft.to) || draft.to === viewKey) return setStatus({ tone: "bad", text: "Choose the shop's video in «Leads to»." });
    // With pins, the door's moment and heading are its middle pin's.
    const mid = draft.pins.length ? draft.pins[Math.floor((draft.pins.length - 1) / 2)] : null;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const fields = {
      t: Math.round((mid?.t ?? draft.t) * 100) / 100,
      yaw: r3(mid?.yaw ?? draft.yaw),
      ...(mid ? { pitch: r3(mid.pitch), pins: draft.pins.map((q) => ({ t: Math.round(q.t * 100) / 100, yaw: r3(q.yaw), pitch: r3(q.pitch) })) } : {}),
      label: draft.fa.trim() ? { en: draft.en.trim(), fa: draft.fa.trim() } : { en: draft.en.trim() },
      to: draft.to,
      ...(draft.flat && !isPhoneVideoKey(draft.to) ? { flat: true } : {}),
    };
    // An edit replaces «flat» too: unticked is no flag (dropped when saved).
    if (draft.id) change(updateDoor(walks, viewKey, draft.id, { flat: undefined, pitch: undefined, pins: undefined, ...fields }));
    else change(addDoor(walks, viewKey, fields));
    setDraft(null);
  }

  async function save() {
    setStatus({ tone: "ok", text: "Saving…" });
    try {
      const res = await fetch("/api/operator/splats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
        // `base`: the walks as last read — the server merges (`mergeWalks`).
        body: JSON.stringify({ action: "walksSave", walks, base: serverWalks.current }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const saved = parseWalks(json.walks);
      serverWalks.current = saved;
      onChange(saved);
      setDirty(false);
      const conflicts: string[] = json.conflicts ?? [];
      setStatus(conflicts.length
        ? { tone: "warn", text: `Saved, but someone else changed the walks meanwhile:\n${conflicts.join("\n")}` }
        : { tone: "ok", text: "Saved. Visitors see these doors now." });
    } catch (e) {
      setStatus({ tone: "bad", text: (e as Error).message });
    }
  }

  const isStart = Boolean(viewKey && walks.start === viewKey);
  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const field = "w-full rounded-md border border-white/20 bg-black/50 px-2 py-1 text-[13px] text-white";

  return (
    <div dir="ltr" className="absolute left-3 top-3 z-30 w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-white/20 bg-black/80 p-3 text-[13px] text-white/90 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <b>Doors · edit mode</b>
        <button className={btn} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <div className="mt-2 max-h-[70vh] space-y-2 overflow-y-auto">
          <div className="truncate text-[11px] text-white/60">This walk: {shortKey(viewKey)}{walk?.doors.length ? ` · ${walk.doors.length} door(s)` : ""}</div>
          {listError && <div className="text-rose-300">{listError}</div>}

          {!draft && (
            <button className={`${btn} w-full border-amber-300/60 bg-amber-300/20 py-2 text-[13px] font-semibold`} disabled={!viewKey} onClick={doorHere}>
              Door here (this moment, the way I look)
            </button>
          )}

          {draft && (
            <div className="space-y-1.5 rounded-lg border border-amber-300/40 p-2">
              <div className="text-[11px] text-white/60">
                At {mmss(draft.t)} ({draft.t.toFixed(2)} s), heading {Math.round((draft.yaw * 180) / Math.PI)}° in the video
              </div>
              <input className={field} placeholder="English label (e.g. Ali's Bakery)" value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} autoFocus />
              <input className={field} dir="rtl" placeholder="برچسب فارسی (optional)" value={draft.fa} onChange={(e) => setDraft({ ...draft, fa: e.target.value })} />
              <label className="block text-[11px] text-white/60">Leads to</label>
              <select className={field} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value, flat: isPhoneVideoKey(e.target.value) })}>
                <option value="">— choose the shop's video —</option>
                {(videos ?? []).filter((v) => v.key !== viewKey).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
              {videos === null && <div className="text-[11px] text-white/50">Reading the uploaded videos…</div>}
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={draft.flat || isPhoneVideoKey(draft.to)} disabled={isPhoneVideoKey(draft.to)} onChange={(e) => setDraft({ ...draft, flat: e.target.checked })} />
                Flat video (filmed with a phone, not 360°)
              </label>
              <div className="space-y-1 rounded-md border border-white/15 p-1.5">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[12px]">Sign on the door</b>
                  <button className={`${btn} ${draft.pinning ? "border-amber-300/70 bg-amber-300/25" : ""}`} onClick={() => setDraft({ ...draft, pinning: !draft.pinning })}>
                    {draft.pinning ? "Pinning: on" : "Pin the sign"}
                  </button>
                </div>
                {draft.pinning && (
                  <div className="text-[11px] leading-snug text-white/65">
                    Tap the door in the picture: the sign goes there at this moment. Walk on a little (stick, or W/S) and tap the door again —
                    2 or 3 pins: where it comes into view, in the middle, where it leaves. The sign follows the door between pins.
                  </div>
                )}
                {draft.pins.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {draft.pins.map((q) => (
                      <span key={q.t} className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]">
                        {mmss(q.t)}.{Math.floor((q.t % 1) * 10)}
                        <button className="ms-1 text-white/60" title="Remove this pin" onClick={() => setDraft({ ...draft, pins: draft.pins.filter((x) => x !== q) })}>×</button>
                      </span>
                    ))}
                    <button className="text-[11px] text-white/50 underline" onClick={() => setDraft({ ...draft, pins: [] })}>clear</button>
                  </div>
                ) : (
                  <div className="text-[11px] text-white/45">No pins: the sign stands at the heading you looked when you pressed «Door here».</div>
                )}
              </div>
              <div className="flex gap-2">
                <button className={`${btn} border-amber-300/60`} onClick={saveDraft}>{draft.id ? "Apply" : "Add door"}</button>
                {draft.id && (
                  <button className={btn} onClick={() => { const h = engine.current?.here(); if (h) setDraft({ ...draft, t: h.t, yaw: h.yaw }); }}>
                    Move here
                  </button>
                )}
                <button className={btn} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          )}

          <ul className="space-y-1">
            {(walk?.doors ?? []).map((d) => (
              <li key={d.id} className="rounded-md bg-white/5 p-1.5">
                <div className="truncate">
                  <span className="font-mono text-white/60">{mmss(d.t)}</span> {d.label.en}
                  {d.label.fa && <span className="text-white/60"> · {d.label.fa}</span>}
                </div>
                <div className="truncate text-[11px] text-white/50">→ {shortKey(d.to)}{isFlatDoor(d) ? " (flat)" : ""}</div>
                <div className="mt-1 flex gap-1.5">
                  <button className={btn} onClick={() => engine.current?.goTo(d)}>Go to</button>
                  <button className={btn} onClick={() => setDraft({ id: d.id, t: d.t, yaw: d.yaw, en: d.label.en, fa: d.label.fa ?? "", to: d.to, flat: isFlatDoor(d), pins: d.pins ?? [], pinning: false })}>Edit</button>
                  <button className={btn} onClick={() => { if (viewKey && window.confirm(`Delete the door «${d.label.en}»?`)) change(removeDoor(walks, viewKey, d.id)); }}>Delete</button>
                </div>
              </li>
            ))}
            {walk && !walk.doors.length && <li className="text-white/50">No doors on this walk yet.</li>}
          </ul>

          <button className={`${btn} w-full`} disabled={!viewKey || !isWalkKey(viewKey) || isStart} onClick={() => viewKey && change(setStart(walks, viewKey))}>
            {isStart ? "✓ Visitors start on this walk" : "Set as the street walk visitors start on"}
          </button>
          <button className={`${btn} w-full border-emerald-300/60 bg-emerald-300/20 py-2 text-[13px] font-semibold`} onClick={() => void save()}>
            Save{dirty ? " (unsaved changes)" : ""}
          </button>
          {status && (
            <div className={`whitespace-pre-wrap text-[12px] ${status.tone === "bad" ? "text-rose-300" : status.tone === "warn" ? "text-amber-200" : "text-emerald-200"}`}>
              {status.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
