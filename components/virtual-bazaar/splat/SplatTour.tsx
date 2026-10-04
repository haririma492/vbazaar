"use client";

/**
 * THE SPLAT TOUR — the Virtual Bazaar as real places: Gaussian-splat scenes
 * (reconstructed from 360° footage) linked by exits the visitor chooses.
 *
 * The scenes and their links are the tour (`lib/splats/tour.ts`), read from
 * `NEXT_PUBLIC_SPLAT_BASE_URL/scenes/tour.json`. Each scene shows its exits as
 * markers in the scene AND as a list of buttons; either takes the visitor
 * there. «Back» returns them to the exact spot they left (the trail), and so
 * does the browser's back button.
 *
 * Rendering is Spark (`@sparkjsdev/spark`, World Labs): its `SplatMesh` is an
 * ordinary `THREE.Object3D` in OUR scene, with OUR camera and controls, so the
 * markers (and later the shop UI) live beside the splats. Not mkkellogg's
 * `gaussian-splats-3d`: its last release was January 2025, its Viewer wants
 * the render loop to itself, and its README lists mobile performance and large
 * scenes as known problems. Not an iframe or a hosted viewer: navigation,
 * hotspots and the shop stay ours.
 *
 * ⚠️ SCENES STAY LOADED. A scene once visited is hidden, not thrown away, so
 * going back is instant and keeps no second download.
 *
 * It MEASURES each load — bytes, download, decode, splats, fps — on
 * `window.__splatReport`, and on screen with «Copy report» under ?debug=1 (or
 * the operator's ?edit=1). A visitor sees only the place, its name and the stick.
 *
 *   /vca/splat                  the tour, from its start scene
 *   /vca/splat?scene=store-01   the tour, from that scene
 *   /vca/splat?edit=1           place exits and start poses (operator token)
 *   /vca/splat?src=<url>        one file alone, no tour (?flip=0 if it is y-up)
 *
 * Controls: drag to look; wheel or pinch to zoom; W A S D / arrows or the
 * on-screen stick to walk, Q E down and up (Shift: faster); «Phone motion»
 * turns the view with the phone.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { readAdminToken } from "@/lib/admin/useAdminMode";
import {
  addExit, emptyTour, enter, leave, parseTour, removeExit, sceneById, updateScene,
  type Exit, type Pose, type Tour, type Trail, type Vec3,
} from "@/lib/splats/tour";
import WalkStick from "./WalkStick";
import { LEVEL_SPEED, holdAngles, startTilt, stepTilt, stickHold, type TiltState } from "@/lib/splats/tilt";
import { buildWalkMap, guide, type WalkMap } from "@/lib/splats/walkmap";
import { deviceQuaternion, hasDeviceOrientation, headingOf, needsPermission, requestDeviceOrientation, screenAngle } from "../scene/deviceOrientation";

/** Baked in at build time when it was set then; otherwise asked of the server at load (`/api/splats/config`). */
const BUILT_BASE = (process.env.NEXT_PUBLIC_SPLAT_BASE_URL || "").trim().replace(/\/+$/, "");

async function splatBase(): Promise<string> {
  if (BUILT_BASE) return BUILT_BASE;
  try {
    const res = await fetch("/api/splats/config", { cache: "no-store" });
    const { base } = (await res.json()) as { base: string | null };
    return (base || "").trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}
const FADE_MS = 250;
const DECODE_TIMEOUT_MS = 120_000;

type Report = {
  scene: string;
  src: string;
  bytes: number | null;
  downloadMs: number | null;
  decodeMs: number | null;
  firstFrameMs: number | null;
  splats: number | null;
  fps: number | null;
  gpu: string;
  dpr: number;
  viewport: string;
  error: string | null;
  /** The walk map: its size and scale, or why there is none. */
  walkMap?: string;
};

declare global {
  interface Window {
    __splatReport?: Report;
    /** Where the camera stands now — for a scripted browser checking that walking walks. */
    __splatPose?: () => Pose | undefined;
  }
}

/** `?src=`: https anywhere, http only for a local test server, or a path on this site. */
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

function gpuName(gl: WebGL2RenderingContext | WebGLRenderingContext): string {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

const fmtMB = (n: number | null) => (n == null ? "—" : `${(n / 1024 / 1024).toFixed(2)} MB`);
const fmtMs = (n: number | null) => (n == null ? "—" : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);

/** A marker: a glowing ring with the exit's name under it, always facing the camera. */
function makeMarker(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(252, 211, 77, 0.25)";
  g.strokeStyle = "rgba(252, 211, 77, 0.95)";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(256, 80, 56, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.font = "bold 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillStyle = "rgba(0,0,0,0.6)";
  const w = Math.min(500, g.measureText(text).width + 40);
  g.fillRect(256 - w / 2, 160, w, 64);
  g.fillStyle = "#fff";
  g.fillText(text, 256, 208, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.8, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

type Engine = {
  show: (sceneId: string, pose: Pose) => Promise<void>;
  pose: () => Pose;
  pointAhead: (meters: number) => Vec3;
  setMarkers: (exits: Exit[]) => void;
  setGyro: (on: boolean) => void;
  /** Walk by tilting (`lib/splats/tilt.ts`): on captures the hold as "standing still". */
  setTilt: (on: boolean) => void;
  /** Take the phone's present hold as "standing still" again. */
  recentre: () => void;
  /** The current scene's walk map, and where the visitor stands on it, for the 🗺 view. */
  mapView: () => { map: WalkMap; x: number; z: number; heading: number } | null;
  /** The on-screen stick: x right, y down, each −1…1; (0, 0) stands still. */
  setMove: (x: number, y: number) => void;
  /** Walking speed, metres per second at full stick. */
  setSpeed: (mps: number) => void;
};

/** «Slow / Normal / Fast»: metres per second at full stick, remembered on this device. */
const SPEEDS = [
  { label: "آهسته · Slow", mps: 0.35 },
  { label: "معمولی · Normal", mps: 0.8 },
  { label: "تند · Fast", mps: 1.6 },
];
const SPEED_KEY = "sk-splat-speed";
/** On a phone: "tilt" (the default) or "stick", the visitor's last choice. */
const MODE_KEY = "sk-splat-mode";
/** Full steering turns this fast (rad/s): about 45° a second, a slow look round. */
const TURN_RATE = 0.8;
/** How long starting, stopping and turning take to settle (s). */
const EASE_S = 0.35;
const UP = new THREE.Vector3(0, 1, 0);


export default function SplatTour() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [tiltOn, setTiltOn] = useState(false);
  const [tiltLevel, setTiltLevel] = useState(0);
  const tiltLevelRef = useRef(0);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [fade, setFade] = useState(false);
  const [gyro, setGyro] = useState<"off" | "on" | "refused">("off");
  const [copied, setCopied] = useState(false);
  const [tour, setTour] = useState<Tour | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [trail, setTrail] = useState<Trail>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [debug, setDebug] = useState(false);
  // 🗺 The walk map seen from above, the visitor on it.
  const [showMap, setShowMap] = useState(false);
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!showMap) return;
    const draw = () => {
      const cv = mapCanvas.current;
      const view = engine.current?.mapView();
      if (!cv) return;
      const g = cv.getContext("2d")!;
      const W = cv.width, H = cv.height;
      g.fillStyle = "rgba(0,0,0,0.65)";
      g.fillRect(0, 0, W, H);
      if (!view) {
        g.fillStyle = "rgba(255,255,255,0.6)";
        g.font = "12px system-ui";
        g.fillText("…", W / 2 - 4, H / 2);
        return;
      }
      const { map: m, x, z, heading } = view;
      // About 30 m across, centred on the visitor, forward up.
      const span = 30 * m.unitsPerMetre;
      const px = W / span;
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate(-heading);
      const reach = Math.ceil(span / m.cell / 1.2);
      const c0 = Math.floor((x - m.x0) / m.cell), r0 = Math.floor((z - m.z0) / m.cell);
      for (let r = r0 - reach; r <= r0 + reach; r++) {
        if (r < 0 || r >= m.rows) continue;
        for (let c = c0 - reach; c <= c0 + reach; c++) {
          if (c < 0 || c >= m.cols) continue;
          const k = r * m.cols + c;
          if (!m.known[k]) continue;
          g.fillStyle = m.solid[k] ? "rgba(252,211,77,0.85)" : "rgba(255,255,255,0.12)";
          const sx = (m.x0 + c * m.cell - x) * px, sz = (m.z0 + r * m.cell - z) * px;
          g.fillRect(sx, sz, Math.ceil(m.cell * px), Math.ceil(m.cell * px));
        }
      }
      g.restore();
      // The visitor, facing up.
      g.fillStyle = "#38bdf8";
      g.beginPath();
      g.moveTo(W / 2, H / 2 - 9);
      g.lineTo(W / 2 - 6, H / 2 + 6);
      g.lineTo(W / 2 + 6, H / 2 + 6);
      g.closePath();
      g.fill();
    };
    draw();
    const t = window.setInterval(draw, 200);
    return () => window.clearInterval(t);
  }, [showMap]);
  // Walk by tilting is for a phone in the hand.
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false), []);
  /**
   * ⚠️ ON A PHONE, TILTING IS THE DEFAULT (operator, 2026-10-04) — unless the
   * visitor switched to the joystick, which this device remembers. Android
   * starts it by itself; iOS shares the phone's motion only from a tap, so it
   * gets one «Start» card, whose tap is that request.
   */
  const [needStart, setNeedStart] = useState(false);
  const rememberMode = (mode: "tilt" | "stick") => {
    try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* fine */ }
  };
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    if (!touch || !sceneReady || tiltOn) return;
    let mode: string | null = null;
    try { mode = window.localStorage.getItem(MODE_KEY); } catch { /* private mode: the default */ }
    if (mode === "stick" || !hasDeviceOrientation()) return;
    if (needsPermission()) setNeedStart(true);
    else void toggleTilt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, sceneReady]);
  const [edit, setEdit] = useState({ to: "", label: "", saved: "" });
  const tourRef = useRef<Tour | null>(null);
  const baseRef = useRef("");
  const trailRef = useRef<Trail>([]);
  const currentRef = useRef<string | null>(null);
  const exitHandler = useRef<(exit: Exit) => void>(() => {});
  tourRef.current = tour;
  trailRef.current = trail;
  currentRef.current = current;

  // ── The renderer, camera, controls and splat loading ───────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const params = new URLSearchParams(window.location.search);
    let disposed = false;
    // Only a change of speed level re-renders the page.
    const onTiltLevel = (level: number) => {
      if (tiltLevelRef.current === level) return;
      tiltLevelRef.current = level;
      setTiltLevel(level);
    };
    const t0 = performance.now();

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const rep: Report = {
      scene: "", src: "", bytes: null, downloadMs: null, decodeMs: null, firstFrameMs: null, splats: null, fps: null,
      gpu: gpuName(renderer.getContext()), dpr: renderer.getPixelRatio(), viewport: `${el.clientWidth}×${el.clientHeight}`, error: null,
    };
    const publish = () => {
      window.__splatReport = { ...rep };
      setReport({ ...rep });
    };
    publish();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101014);
    const camera = new THREE.PerspectiveCamera(70, el.clientWidth / el.clientHeight, 0.05, 500);
    const markers = new THREE.Group();
    scene.add(markers);
    let yaw = 0;
    let pitch = 0;
    let gyroOn = false;
    let stickX = 0;
    let stickY = 0;
    let walkSpeed = SPEEDS[1].mps;
    let velFwd = 0; // m/s, eased toward what the stick asks
    let velTurn = 0; // rad/s, likewise
    let turnYaw = 0; // how far the steering has turned the view
    const turnQ = new THREE.Quaternion();
    let gyroHave = false;
    // Walk by tilting: the hold, smoothed; a few readings to learn "standing still".
    let tiltOn = false;
    let stickDrive: TiltState = startTilt(0);
    // Where the body is turning to; `turnYaw` glides there (a car does not snap round).
    let turnTarget = 0;
    let tilt: TiltState | null = null;
    let calib: number[] = [];
    let smooth: { pitch: number; roll: number } | null = null;
    const gyroQ = new THREE.Quaternion();

    // Spark arrives as its own chunk (2.6 MB): only this page pays for it.
    let sparkMod: typeof import("@sparkjsdev/spark") | null = null;
    let spark: SparkRenderer | null = null;
    const sparkReady = import("@sparkjsdev/spark").then((m) => {
      if (disposed) return;
      sparkMod = m;
      spark = new m.SparkRenderer({ renderer });
      scene.add(spark);
    });

    const meshes = new Map<string, SplatMesh>();
    // Each scene's walk map, read once from its points (null while reading, or when no floor was found).
    const maps = new Map<string, WalkMap | null>();
    let currentId = "";
    function readWalkMap(mesh: SplatMesh, flipped: boolean, eye: Vec3): WalkMap | null {
      const n = mesh.packedSplats?.numSplats ?? mesh.extSplats?.numSplats ?? 0;
      if (!n) return null;
      const pts = new Float32Array(n * 3);
      let k = 0;
      try {
        mesh.forEachSplat((_i, c, _s, _q, opacity) => {
          if (opacity < 0.15) return; // faint haze is not a wall
          // The splat is turned upright (180° about x) when flipped: y and z change sign.
          pts[k++] = c.x;
          pts[k++] = flipped ? -c.y : c.y;
          pts[k++] = flipped ? -c.z : c.z;
        });
      } catch {
        return null;
      }
      return buildWalkMap(pts.subarray(0, k), eye);
    }
    let firstFrameAt: number | null = null;

    async function loadMesh(id: string, src: string, flip: boolean): Promise<SplatMesh> {
      const have = meshes.get(id);
      if (have) {
        Object.assign(rep, { scene: id, src, error: null });
        publish();
        return have;
      }
      await sparkReady;
      if (!sparkMod) throw new Error("Spark did not load.");
      Object.assign(rep, { scene: id, src, bytes: null, downloadMs: null, decodeMs: null, splats: null, error: null });
      publish();

      const tFetch = performance.now();
      const res = await fetch(src);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${src}`);
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        setLoading(total ? got / total : 0);
      }
      const bytes = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      rep.bytes = got;
      rep.downloadMs = performance.now() - tFetch;
      publish();

      const tDecode = performance.now();
      // ⚠️ FULL-PRECISION SPLATS (`extSplats`). Spark's default packing keeps
      // each centre as a 16-bit float: fine for an object on a table, coarse
      // and blocky for a street tens of metres across. Twice the GPU memory
      // (32 bytes a splat: 64 MB for 2M), which phones have. `?precision=low`
      // shows the default packing, to compare.
      const mesh = new sparkMod.SplatMesh({
        fileBytes: bytes,
        fileName: new URL(src).pathname.split("/").pop() || "scene.spz",
        extSplats: params.get("precision") !== "low",
      });
      if (flip) mesh.quaternion.set(1, 0, 0, 0); // y-down reconstruction → y-up world
      scene.add(mesh);
      // Spark logs a decode failure in its worker and never settles: give up after a while.
      let timer = 0;
      await Promise.race([
        mesh.initialized,
        new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(
            "The file did not decode. If it is .spz, write it as SPZ v3 (splat-transform --spz-version 3).")), DECODE_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      rep.decodeMs = performance.now() - tDecode;
      rep.splats = mesh.packedSplats?.numSplats ?? mesh.extSplats?.numSplats ?? null;
      if (firstFrameAt == null) firstFrameAt = performance.now();
      publish();
      meshes.set(id, mesh);
      return mesh;
    }

    const applyPose = (p: Pose) => {
      camera.position.set(...p.position);
      yaw = p.yaw;
      pitch = p.pitch;
      turnYaw = 0;
      turnTarget = 0;
      stickDrive = startTilt(0);
      velFwd = 0;
      velTurn = 0;
    };

    let markerExits: Exit[] = [];
    engine.current = {
      async show(id, pose) {
        let src: string | null;
        let flip = true;
        if (id === "__single") {
          src = safeSrc(params.get("src") || "");
          flip = params.get("flip") !== "0";
        } else {
          const s = tourRef.current ? sceneById(tourRef.current, id) : null;
          src = s && baseRef.current ? `${baseRef.current}/${s.file}` : null;
          flip = s?.flip ?? true;
        }
        if (!src) throw new Error("No such scene, or NEXT_PUBLIC_SPLAT_BASE_URL is not set.");
        setLoading(0);
        try {
          const mesh = await loadMesh(id, src, flip);
          mesh.quaternion.set(flip ? 1 : 0, 0, 0, flip ? 0 : 1);
          meshes.forEach((m, k) => (m.visible = k === id));
          applyPose(pose);
          currentId = id;
          if (!maps.has(id)) {
            maps.set(id, null);
            // After the first frames are up: reading millions of points takes a moment.
            window.setTimeout(() => {
              if (disposed) return;
              const t = performance.now();
              const wm = readWalkMap(mesh, flip, camera.position.toArray() as Vec3);
              maps.set(id, wm);
              rep.walkMap = wm
                ? `${wm.cols}×${wm.rows} cells, ${(1 / wm.unitsPerMetre).toFixed(2)} m/unit, ${Math.round(performance.now() - t)} ms`
                : "no floor found: walking is not guided";
              publish();
            }, 400);
          }
        } catch (e) {
          rep.error = (e as Error).message;
          publish();
          throw e;
        } finally {
          setLoading(null);
        }
      },
      // Where the body is turning to, not mid-glide: a saved pose (start, back) faces the way chosen.
      pose: () => ({ position: camera.position.toArray() as Vec3, yaw: yaw + turnTarget, pitch }),
      pointAhead(m) {
        const d = new THREE.Vector3();
        camera.getWorldDirection(d);
        return camera.position.clone().addScaledVector(d, m).toArray() as Vec3;
      },
      setMarkers(exits) {
        markerExits = exits;
        markers.children.forEach((c) => {
          const s = c as THREE.Sprite;
          s.material.map?.dispose();
          s.material.dispose();
        });
        markers.clear();
        for (const e of exits) {
          const m = makeMarker(e.label.en);
          m.position.set(...e.at);
          m.userData.exitId = e.id;
          markers.add(m);
        }
      },
      setTilt(on) {
        tiltOn = on;
        tilt = null;
        calib = [];
        smooth = null;
        if (!on) onTiltLevel(0);
      },
      recentre() {
        tilt = null;
        calib = [];
      },
      mapView() {
        const map = maps.get(currentId);
        if (!map) return null;
        return { map, x: camera.position.x, z: camera.position.z, heading: -headingOf(camera.quaternion) };
      },
      setGyro(on) {
        gyroOn = on;
      },
      setMove(x, y) {
        stickX = x;
        stickY = y;
        // The stick drives like the phone (`stickHold`): its sideways push is
        // the steering twist, its push up the tilt back.
        const h = stickHold(x, y);
        const step = stepTilt(stickDrive, h.pitch, h.roll);
        stickDrive = step.state;
        turnTarget += step.turn * (Math.PI / 180);
      },
      setSpeed(mps) {
        walkSpeed = mps;
      },
    };

    window.__splatPose = () => engine.current?.pose();

    // ── Controls ───────────────────────────────────────────────────────────
    const keys = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (e.type === "keydown") keys.add(e.key.toLowerCase());
      else keys.delete(e.key.toLowerCase());
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let downAt: { x: number; y: number; t: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const zoom = (factor: number) => {
      camera.fov = THREE.MathUtils.clamp(camera.fov * factor, 25, 100);
      camera.updateProjectionMatrix();
    };
    const onDown = (e: PointerEvent) => {
      renderer.domElement.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downAt = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (pointers.size === 1 && !(gyroOn && gyroHave)) {
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
      // A tap (not a drag) on a marker takes its exit.
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 && performance.now() - downAt.t < 500) {
        const r = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hit = raycaster.intersectObjects(markers.children, false)[0];
        const exit = hit && markerExits.find((x) => x.id === hit.object.userData.exitId);
        if (exit) exitHandler.current(exit);
      }
      downAt = null;
    };
    // ⚠️ GENTLE ZOOM. A laptop touchpad's two-finger scroll fires dozens of
    // wheel events a second; each one is capped so the view cannot fly to
    // its zoom limits in a flick. Double-click puts the zoom back.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoom(Math.exp(THREE.MathUtils.clamp(px, -40, 40) * 0.0006));
    };
    const onDblClick = () => {
      camera.fov = 70;
      camera.updateProjectionMatrix();
    };
    // A key released while the window is not looking never says so: without
    // this, W stays "held" and the visitor walks off on their own.
    const onBlur = () => keys.clear();
    const onVisibility = () => {
      if (document.hidden) keys.clear();
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      deviceQuaternion(gyroQ, e.alpha, e.beta, e.gamma, screenAngle());
      gyroHave = true;
      if (!tiltOn) return;
      // Walk by tilting. Smoothed a little: a hand trembles.
      const h = holdAngles(e.beta, e.gamma, screenAngle());
      smooth = smooth ? { pitch: smooth.pitch + (h.pitch - smooth.pitch) * 0.3, roll: smooth.roll + (h.roll - smooth.roll) * 0.3 } : h;
      if (!tilt) {
        // The first readings after switching on are the comfortable hold.
        calib.push(smooth.pitch);
        if (calib.length >= 8) tilt = startTilt(calib.reduce((a, b) => a + b, 0) / calib.length);
        return;
      }
      const step = stepTilt(tilt, smooth.pitch, smooth.roll);
      tilt = step.state;
      turnTarget += step.turn * (Math.PI / 180); // the body turns; the hand coming back does not undo it
      onTiltLevel(tilt.level);
    };
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      rep.viewport = `${el.clientWidth}×${el.clientHeight}`;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    window.addEventListener("deviceorientation", onOrient);
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);
    canvas.style.touchAction = "none";

    // ── Loop ───────────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const look = new THREE.Euler(0, 0, 0, "YXZ");
    let frames = 0;
    let fpsSince = performance.now();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      // Steering (stick left/right) turns the view. With phone motion on it is
      // added to the phone's own heading, so both turn you.
      if (gyroOn && gyroHave && !tiltOn) camera.quaternion.copy(turnQ.setFromAxisAngle(UP, -turnYaw)).multiply(gyroQ);
      else camera.quaternion.setFromEuler(look.set(-pitch, -(yaw + turnYaw), 0));

      // ⚠️ WALK BY THE COMPASS HEADING, not by where the camera points. With the
      // phone tilted at the floor the pointing direction, flattened, swings
      // wildly and walking felt like spinning; the heading stays steady.
      const heading = headingOf(camera.quaternion);
      forward.set(-Math.sin(heading), 0, -Math.cos(heading));
      right.set(Math.cos(heading), 0, -Math.sin(heading));

      // ⚠️ DRIVEN LIKE A CAR, NOT A GAME: the stick's up/down is the pedal
      // (forward/back), its left/right the steering wheel (turn). Squared, so
      // a small push creeps; and eased, so starting, stopping and turning glide
      // instead of jerking. W/S and A/D (or the arrows) do the same.
      const shape = (v: number) => Math.sign(v) * v * v;
      // Up: the stick's stepped speed; down: reverse, as pushed. The phone's
      // tilt walks when the stick is left alone.
      let wantFwd = stickY < 0 ? LEVEL_SPEED[stickDrive.level] : -shape(stickY);
      if (tiltOn && tilt && !stickY) wantFwd = LEVEL_SPEED[tilt.level];
      // Only the keys turn continuously; the stick and the phone set a target.
      let wantTurn = 0;
      if (keys.has("w") || keys.has("arrowup")) wantFwd = 1;
      if (keys.has("s") || keys.has("arrowdown")) wantFwd = -1;
      if (keys.has("d") || keys.has("arrowright")) wantTurn = 1;
      if (keys.has("a") || keys.has("arrowleft")) wantTurn = -1;
      const boost = keys.has("shift") ? 2.5 : 1;
      const ease = 1 - Math.exp(-dt / EASE_S);
      // ⚠️ THE WALK MAP HELPS (`lib/splats/walkmap.ts`): walking forward, slow
      // to a stop at arm's length from a shop window or wall, and lean the
      // heading along the open way — unless the visitor is steering already.
      const map = maps.get(currentId) ?? null;
      if (map && wantFwd > 0) {
        const g = guide(map, camera.position.x, camera.position.z, -heading);
        wantFwd *= g.speed;
        const steering = Math.abs(stickX) > 0.1 || Math.abs(velTurn) > 0.05 || Math.abs(turnTarget - turnYaw) > 0.02;
        if (!steering) turnTarget += g.steer * dt * Math.min(1, wantFwd * 2);
      }
      velFwd += (wantFwd * walkSpeed * boost - velFwd) * ease;
      velTurn += (wantTurn * TURN_RATE - velTurn) * ease;
      if (Math.abs(velFwd) > 1e-4) camera.position.addScaledVector(forward, velFwd * dt);
      if (Math.abs(velTurn) > 1e-4) turnTarget += velTurn * dt;
      turnYaw += (turnTarget - turnYaw) * ease;
      if (keys.has("e")) camera.position.y += walkSpeed * dt;
      if (keys.has("q")) camera.position.y -= walkSpeed * dt;

      renderer.render(scene, camera);

      if (firstFrameAt != null && rep.firstFrameMs == null) {
        rep.firstFrameMs = performance.now() - t0;
        publish();
      }
      frames++;
      const now = performance.now();
      if (now - fpsSince >= 2000) {
        rep.fps = Math.round((frames * 1000) / (now - fpsSince));
        frames = 0;
        fpsSince = now;
        // ⚠️ A WEAK GRAPHICS CHIP DRAWS FEWER PIXELS, NOT FEWER FRAMES. At a
        // handful of frames a second every push of the stick lands late and
        // far, and walking feels out of control (a 2017 laptop chip, not a
        // phone). Below 20 fps the canvas renders at a lower resolution, step
        // by step, but never below the screen's own pixels; above 50 it climbs back.
        if (rep.firstFrameMs != null) {
          const pr = renderer.getPixelRatio();
          const top = Math.min(window.devicePixelRatio, 2);
          // Never below the screen's own pixels (1): halving them blurred the shop windows.
          const floor = Math.min(1, top);
          const next = rep.fps < 20 ? Math.max(floor, pr * 0.85) : rep.fps > 50 ? Math.min(top, pr * 1.15) : pr;
          if (Math.abs(next - pr) > 0.01) {
            renderer.setPixelRatio(next);
            renderer.setSize(el.clientWidth, el.clientHeight);
            rep.dpr = Math.round(next * 100) / 100;
          }
        }
        publish();
      }
    });

    return () => {
      disposed = true;
      engine.current = null;
      renderer.setAnimationLoop(null);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("deviceorientation", onOrient);
      meshes.forEach((m) => m.dispose());
      (spark as { dispose?: () => void } | null)?.dispose?.();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  // ── The tour: load it, start in its first scene ─────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const edit = params.get("edit") === "1" && Boolean(readAdminToken());
    setEditing(edit);
    setDebug(edit || params.get("debug") === "1");
    if (params.get("src")) {
      void engine.current?.show("__single", { position: [0, 0, 0], yaw: 0, pitch: 0 }).then(() => setSceneReady(true)).catch(() => {});
      return;
    }
    (async () => {
      baseRef.current = await splatBase();
      if (!baseRef.current) {
        setError("NEXT_PUBLIC_SPLAT_BASE_URL is not set on this host (Railway → Variables: the bucket's public address).");
        return;
      }
      try {
        // Through our server, not r2.dev: the public copy can be a cached, older tour (`/api/splats/tour`).
        const res = await fetch("/api/splats/tour", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; tour?: unknown; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error || `The tour could not be read (HTTP ${res.status}).`);
        const t = parseTour(body.tour);
        if (!t.scenes.length) throw new Error("The tour has no scenes yet. Upload one at /operator/splats.");
        setTour(t);
        tourRef.current = t;
        const first = sceneById(t, params.get("scene") || "") ?? sceneById(t, t.start)!;
        await engine.current?.show(first.id, first.start);
        setCurrent(first.id);
        setSceneReady(true);
        window.history.replaceState({ splatDepth: 0 }, "");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  // Markers follow the current scene's exits (and the editor's changes).
  const here = tour && current ? sceneById(tour, current) : null;
  useEffect(() => {
    engine.current?.setMarkers(here?.exits ?? []);
  }, [here]);

  // Walking speed: the visitor's last choice on this device.
  const [speedIx, setSpeedIx] = useState(1);
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
    engine.current?.setSpeed(SPEEDS[speedIx].mps);
  }, [speedIx]);

  async function go(sceneId: string, pose: Pose) {
    setFade(true);
    await new Promise((r) => setTimeout(r, FADE_MS));
    try {
      await engine.current?.show(sceneId, pose);
      setCurrent(sceneId);
    } finally {
      setFade(false);
    }
  }

  async function take(exit: Exit) {
    const t = tourRef.current;
    const from = currentRef.current;
    if (!t || !from || !engine.current) return;
    const step = enter(t, trailRef.current, from, engine.current.pose(), exit);
    if (!step) return;
    await go(step.scene, step.pose);
    setTrail(step.trail);
    // The browser's back button walks the same trail.
    window.history.pushState({ splatDepth: step.trail.length }, "", `?scene=${step.scene}${editing ? "&edit=1" : ""}`);
  }
  exitHandler.current = (e) => void take(e);

  async function back() {
    const step = leave(trailRef.current);
    if (!step) return;
    setTrail(step.trail);
    await go(step.scene, step.pose);
  }

  useEffect(() => {
    const onPop = () => void back();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  async function toggleGyro() {
    if (gyro === "on") {
      engine.current?.setGyro(false);
      return setGyro("off");
    }
    // iOS: the permission request must be the first await inside the tap.
    const ok = hasDeviceOrientation() && (await requestDeviceOrientation());
    engine.current?.setGyro(ok);
    setGyro(ok ? "on" : "refused");
  }

  /**
   * «Walk by tilting». ⚠️ The permission request comes first in the tap (iOS),
   * and the phone's look-round is switched off: in this mode the phone's
   * tilt walks and its twist turns the body, and the view stays level.
   */
  async function toggleTilt() {
    if (tiltOn) {
      engine.current?.setTilt(false);
      setTiltOn(false);
      rememberMode("stick");
      return;
    }
    const ok = hasDeviceOrientation() && (await requestDeviceOrientation());
    setNeedStart(false);
    if (!ok) {
      setGyro("refused");
      rememberMode("stick");
      return;
    }
    engine.current?.setGyro(false);
    setGyro("off");
    engine.current?.setTilt(true);
    setTiltOn(true);
    rememberMode("tilt");
  }

  async function copyReport() {
    const text = JSON.stringify({ ...report, userAgent: navigator.userAgent }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy:", text);
    }
  }

  // ── The operator's editor (?edit=1) ─────────────────────────────────────
  const changeTour = (t: Tour) => {
    setTour(t);
    setEdit((x) => ({ ...x, saved: "unsaved changes" }));
  };
  async function saveTour() {
    if (!tour) return;
    try {
      const res = await fetch("/api/operator/splats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
        body: JSON.stringify({ action: "tour", tour }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setTour(json.tour);
      setEdit((x) => ({ ...x, saved: "saved" }));
    } catch (e) {
      setEdit((x) => ({ ...x, saved: `not saved: ${(e as Error).message}` }));
    }
  }

  const r = report;
  const backTo = trail.length ? sceneById(tour ?? emptyTour(), trail[trail.length - 1].scene) : null;
  const others = tour?.scenes.filter((s) => s.id !== current) ?? [];

  return (
    <div className="fixed inset-0 bg-[#101014]">
      <div ref={host} className="absolute inset-0" />
      <div className={`pointer-events-none absolute inset-0 bg-black transition-opacity duration-200 ${fade ? "opacity-100" : "opacity-0"}`} />

      {/* ⚠️ A VISITOR SEES THE PLACE, NOT THE MACHINERY. The measurements are
          for us: ?debug=1 (or the operator's ?edit=1) shows them. */}
      {debug ? (
        <div dir="ltr" className="pointer-events-none absolute left-3 top-3 max-w-[calc(100vw-24px)] space-y-1 rounded-xl bg-black/60 p-3 text-left font-mono text-[11px] leading-snug text-white/85">
          <div className="text-[12px] font-bold text-amber-200">{here ? `${here.title.en} · ${here.title.fa}` : "Splat test"}</div>
          <div className="break-all text-white/50">{r?.src}</div>
          {loading != null && <div>loading… {loading ? `${Math.round(loading * 100)}%` : ""}</div>}
          <div>size {fmtMB(r?.bytes ?? null)} · download {fmtMs(r?.downloadMs ?? null)} · decode {fmtMs(r?.decodeMs ?? null)}</div>
          <div>splats {r?.splats?.toLocaleString() ?? "—"} · first frame {fmtMs(r?.firstFrameMs ?? null)} · {r?.fps ?? "—"} fps</div>
          <div className="text-white/50">{r?.gpu} · dpr {r?.dpr} · {r?.viewport}</div>
          {r?.walkMap && <div className="text-white/60">map {r.walkMap}</div>}
          {(r?.error || error) && <div className="text-rose-300">{r?.error || error}</div>}
        </div>
      ) : (
        <>
          {here && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/45 px-4 py-1.5 text-center text-[15px] text-white/90">
              {here.title.fa !== here.title.en ? `${here.title.fa} · ${here.title.en}` : here.title.en}
            </div>
          )}
          {loading != null && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/85">
              <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
                <div className="h-full bg-amber-300/80 transition-[width]" style={{ width: `${Math.round((loading || 0.02) * 100)}%` }} />
              </div>
              <div className="text-[15px]">در حال آماده‌سازی… · Getting ready…</div>
            </div>
          )}
          {(r?.error || error) && (
            <div className="absolute inset-x-4 top-16 rounded-xl bg-black/70 p-3 text-center text-[14px] text-rose-200">
              {r?.error || error}
            </div>
          )}
        </>
      )}

      {needStart && !tiltOn && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/45 px-6 text-center">
          <button onClick={() => void toggleTilt()} className="rounded-full border border-amber-300/70 bg-amber-300/25 px-8 py-4 text-[18px] font-bold text-amber-50">
            شروع · Start
          </button>
          <p className="max-w-xs text-[14px] leading-relaxed text-white/85">
            گوشی را راحت در دست بگیرید. کمی به عقب کج کنید تا راه بروید؛ مثل فرمان بچرخانید تا بپیچید.
            <br />
            <span dir="ltr">Hold the phone comfortably. Tilt it back a little to walk; turn it like a steering wheel to turn.</span>
          </p>
          <button
            onClick={() => { setNeedStart(false); rememberMode("stick"); }}
            className="text-[13px] text-white/60 underline"
          >
            جوی‌استیک · Use the joystick instead
          </button>
        </div>
      )}

      {tiltOn && (
        <div className="pointer-events-none absolute left-1/2 top-14 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5" aria-label={`Speed ${tiltLevel} of 3`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-2.5 w-2.5 rounded-full ${tiltLevel >= n ? "bg-amber-300" : "bg-white/25"}`} />
          ))}
        </div>
      )}

      {showMap && (
        <canvas ref={mapCanvas} width={180} height={180} className="pointer-events-none absolute left-3 top-14 rounded-xl border border-white/20" aria-label="Map of the walk, seen from above" />
      )}
      <button
        onClick={() => setShowMap((v) => !v)}
        aria-label="Map"
        className="absolute left-3 bottom-4 rounded-full border border-white/25 bg-black/60 px-3 py-2 text-[15px] text-white/90"
      >
        🗺
      </button>

      {/* Where you can go */}
      {(here?.exits.length || backTo) && (
        <div dir="ltr" className="absolute right-3 top-3 flex max-w-[45vw] flex-col items-end gap-2">
          {backTo && (
            <button onClick={() => window.history.back()} className="rounded-full border border-white/30 bg-black/70 px-4 py-2 text-[13px] text-white">
              ← {backTo.title.en}
            </button>
          )}
          {here?.exits.map((e) => (
            <button key={e.id} onClick={() => void take(e)} className="rounded-full border border-amber-300/60 bg-black/70 px-4 py-2 text-[13px] text-amber-100">
              {e.label.en} →
            </button>
          ))}
        </div>
      )}

      {/* Operator: place exits where you stand */}
      {editing && tour && here && (
        <div dir="ltr" className="absolute bottom-20 left-3 w-[min(360px,calc(100vw-24px))] space-y-2 rounded-xl bg-black/75 p-3 text-left text-[12px] text-white/85">
          <div className="font-bold text-amber-200">Edit «{here.id}» — walk to a spot, then:</div>
          <div className="flex gap-2">
            <select className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })}>
              <option value="">exit to…</option>
              {others.map((s) => <option key={s.id} value={s.id}>{s.title.en} ({s.id})</option>)}
            </select>
            <input className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1" placeholder="label (optional)" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={!edit.to} className="rounded-full border border-amber-300/60 px-3 py-1 disabled:opacity-40" onClick={() => {
              const lbl = edit.label.trim();
              changeTour(addExit(tour, here.id, edit.to, engine.current!.pointAhead(1.5), lbl ? { en: lbl, fa: lbl } : undefined));
              setEdit((x) => ({ ...x, label: "" }));
            }}>Add exit 1.5 m ahead</button>
            <button className="rounded-full border border-white/30 px-3 py-1" onClick={() => changeTour(updateScene(tour, here.id, { start: engine.current!.pose() }))}>
              Visitors start here
            </button>
            <button className="rounded-full border border-emerald-300/60 px-3 py-1 text-emerald-100" onClick={() => void saveTour()}>Save tour</button>
          </div>
          {here.exits.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-white/70">
              → {e.label.en} ({e.to}) <span className="text-white/40">[{e.at.map((v) => v.toFixed(1)).join(", ")}]</span>
              <button className="ms-auto text-rose-300" onClick={() => changeTour(removeExit(tour, here.id, e.id))}>remove</button>
            </div>
          ))}
          {edit.saved && <div className="text-white/50">{edit.saved}</div>}
        </div>
      )}

      {!(touch && tiltOn) && <WalkStick onMove={(x, y) => engine.current?.setMove(x, y)} />}
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

      <div dir="ltr" className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        {touch && (
          <button onClick={() => void toggleTilt()} className={`rounded-full border px-4 py-2 text-[13px] ${tiltOn ? "border-amber-300/70 bg-amber-300/25 text-amber-50" : "border-white/25 bg-black/60 text-white/90"}`}>
            {tiltOn ? "جوی‌استیک · Use joystick" : "راه رفتن با کج کردن · Walk by tilting"}
          </button>
        )}
        {tiltOn && (
          <button onClick={() => engine.current?.recentre()} className="rounded-full border border-white/25 bg-black/60 px-3 py-2 text-[13px] text-white/90" title="Hold the phone comfortably, then tap">
            ⟲ حالت راحت · Reset hold
          </button>
        )}
        {!tiltOn && <button onClick={() => void toggleGyro()} className="rounded-full border border-white/25 bg-black/60 px-4 py-2 text-[13px] text-white/90">
          {gyro === "on" ? "نگاه با انگشت · Look by finger" : gyro === "refused" ? "گوشی اجازه نداد · Phone motion refused" : "نگاه با گوشی · Look by phone"}
        </button>}
        {debug && (
          <button onClick={() => void copyReport()} className="rounded-full border border-white/25 bg-black/60 px-4 py-2 text-[13px] text-white/90">
            {copied ? "Copied" : "Copy report"}
          </button>
        )}
      </div>
    </div>
  );
}
