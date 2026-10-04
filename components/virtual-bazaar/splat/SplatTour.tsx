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
 * It MEASURES each load — bytes, download, decode, splats, fps — on screen,
 * under «Copy report», and on `window.__splatReport`.
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
import { deviceQuaternion, hasDeviceOrientation, requestDeviceOrientation, screenAngle } from "../scene/deviceOrientation";

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
  /** The on-screen stick: x right, y down, each −1…1; (0, 0) stands still. */
  setMove: (x: number, y: number) => void;
};

/**
 * THE WALKING STICK — a phone has no W A S D. Drag the knob up to walk the way
 * you look, down to step back, sideways to sidestep; let go and you stop.
 * It is the only way a phone walks: the phone's motion (or a finger on the
 * scene) turns the view, the stick moves you through it.
 */
function WalkStick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const R = 44; // how far the knob travels from the centre, in px
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const move = (e: React.PointerEvent) => {
    const o = origin.current;
    if (!o || e.pointerId !== o.id) return;
    let x = e.clientX - o.x;
    let y = e.clientY - o.y;
    const d = Math.hypot(x, y);
    if (d > R) {
      x = (x / d) * R;
      y = (y / d) * R;
    }
    setKnob({ x, y });
    onMove(x / R, y / R);
  };
  const end = (e: React.PointerEvent) => {
    if (origin.current?.id !== e.pointerId) return;
    origin.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  return (
    <div
      role="slider"
      aria-label="Walk: drag up to go forward, down to go back"
      aria-valuenow={0}
      className="absolute bottom-20 right-5 h-32 w-32 touch-none select-none rounded-full border border-white/25 bg-black/40"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 rounded-full border border-amber-300/70 bg-amber-300/30"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
      <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 text-[11px] text-white/50">▲</span>
      <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-white/50">▼</span>
    </div>
  );
}

export default function SplatTour() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
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
    let gyroHave = false;
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
      const mesh = new sparkMod.SplatMesh({ fileBytes: bytes, fileName: new URL(src).pathname.split("/").pop() || "scene.spz" });
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
        } catch (e) {
          rep.error = (e as Error).message;
          publish();
          throw e;
        } finally {
          setLoading(null);
        }
      },
      pose: () => ({ position: camera.position.toArray() as Vec3, yaw, pitch }),
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
      setGyro(on) {
        gyroOn = on;
      },
      setMove(x, y) {
        stickX = x;
        stickY = y;
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
      if (pointers.size === 1 && !gyroOn) {
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.001));
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      deviceQuaternion(gyroQ, e.alpha, e.beta, e.gamma, screenAngle());
      gyroHave = true;
    };
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      rep.viewport = `${el.clientWidth}×${el.clientHeight}`;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("deviceorientation", onOrient);
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
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
      if (gyroOn && gyroHave) camera.quaternion.copy(gyroQ);
      else camera.quaternion.setFromEuler(look.set(-pitch, -yaw, 0));

      const speed = (keys.has("shift") ? 4 : 1.5) * dt;
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();
      if (keys.has("w") || keys.has("arrowup")) camera.position.addScaledVector(forward, speed);
      if (keys.has("s") || keys.has("arrowdown")) camera.position.addScaledVector(forward, -speed);
      if (keys.has("d") || keys.has("arrowright")) camera.position.addScaledVector(right, speed);
      if (keys.has("a") || keys.has("arrowleft")) camera.position.addScaledVector(right, -speed);
      if (keys.has("e")) camera.position.y += speed;
      if (keys.has("q")) camera.position.y -= speed;
      // The stick: up is forward (screen y grows downward).
      if (stickX || stickY) {
        camera.position.addScaledVector(forward, -stickY * 1.5 * dt);
        camera.position.addScaledVector(right, stickX * 1.5 * dt);
      }

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
        publish();
      }
    });

    return () => {
      disposed = true;
      engine.current = null;
      renderer.setAnimationLoop(null);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
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
    setEditing(params.get("edit") === "1" && Boolean(readAdminToken()));
    if (params.get("src")) {
      void engine.current?.show("__single", { position: [0, 0, 0], yaw: 0, pitch: 0 }).catch(() => {});
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

      {/* Where you are, and the measurements */}
      <div dir="ltr" className="pointer-events-none absolute left-3 top-3 max-w-[calc(100vw-24px)] space-y-1 rounded-xl bg-black/60 p-3 text-left font-mono text-[11px] leading-snug text-white/85">
        <div className="text-[12px] font-bold text-amber-200">{here ? `${here.title.en} · ${here.title.fa}` : "Splat test"}</div>
        <div className="break-all text-white/50">{r?.src}</div>
        {loading != null && <div>loading… {loading ? `${Math.round(loading * 100)}%` : ""}</div>}
        <div>size {fmtMB(r?.bytes ?? null)} · download {fmtMs(r?.downloadMs ?? null)} · decode {fmtMs(r?.decodeMs ?? null)}</div>
        <div>splats {r?.splats?.toLocaleString() ?? "—"} · first frame {fmtMs(r?.firstFrameMs ?? null)} · {r?.fps ?? "—"} fps</div>
        <div className="text-white/50">{r?.gpu} · dpr {r?.dpr} · {r?.viewport}</div>
        {(r?.error || error) && <div className="text-rose-300">{r?.error || error}</div>}
      </div>

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

      <WalkStick onMove={(x, y) => engine.current?.setMove(x, y)} />

      <div dir="ltr" className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        <button onClick={() => void toggleGyro()} className="rounded-full border border-white/25 bg-black/60 px-4 py-2 text-[13px] text-white/90">
          {gyro === "on" ? "Drag to look" : gyro === "refused" ? "Phone motion refused" : "Phone motion"}
        </button>
        <button onClick={() => void copyReport()} className="rounded-full border border-white/25 bg-black/60 px-4 py-2 text-[13px] text-white/90">
          {copied ? "Copied" : "Copy report"}
        </button>
      </div>
    </div>
  );
}
