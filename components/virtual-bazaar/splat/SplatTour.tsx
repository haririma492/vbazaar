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
  addDoor, addExit, emptyTour, enter, leave, parseTour, removeDoor, removeExit, sceneById, updateScene,
  type Door, type Exit, type Pose, type Tour, type Trail, type Vec3,
} from "@/lib/splats/tour";
import { doorLane, inReach, keepInside, type Lane } from "@/lib/splats/corridor";
import WalkStick from "./WalkStick";
import { LEVEL_SPEED, holdAngles, startTilt, stepTilt, stickHold, type TiltState } from "@/lib/splats/tilt";
import { nearestOnRoute, recordStep, routePull } from "@/lib/splats/path";
import { IDENTITY, nudge, toLocal, toWorld, type Place } from "@/lib/splats/place";
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

/** A scene walked among: its route and doors in world coordinates, its walls (world units either side; 0 none), its pace. */
type Member = { id: string; route: Vec3[]; pace: number; half: number; doors: Door[] };
/** What Enter would go into now. */
type Reach = { kind: "door" | "exit"; id: string; label: string } | null;

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
  /** Start or stop recording the cameraman's route (edit mode); stopping returns it. */
  recordRoute: (on: boolean) => Vec3[];
  /**
   * The scenes the visitor walks among now: the current one, or every scene
   * placed in the tour's world when it is one of them — each with its route
   * (already in world coordinates) and pace. Routes are drawn in edit mode.
   */
  setWorld: (members: Member[], show: boolean) => void;
  /** Walls on (`lib/splats/corridor.ts`); off while the operator records a route or aligns. */
  setWalls: (on: boolean) => void;
  /** Enter / «Go in»: through the exit or shop door in reach. False when none is. */
  goIn: () => boolean;
  /** Show a scene placed at `place` (loading it if need be), see-through while being aligned. */
  showPlaced: (id: string, place: Place | null, aligning: boolean) => Promise<void>;
  /** Stop showing a scene (an alignment cancelled). */
  hide: (id: string) => void;
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
  const walkedInto = useRef<(id: string) => void>(() => {});
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
  const [recordingRoute, setRecordingRoute] = useState(false);
  // Edit mode: walk through the walls (to look a scene over), and the next shop door's name.
  const [wallsOff, setWallsOff] = useState(false);
  const [doorName, setDoorName] = useState("");
  // The Align tool: which scene is being joined to this one, where it sits now, and how big a nudge is.
  const [align, setAlign] = useState<{ id: string; place: Place; before: Place | null } | null>(null);
  const [alignTarget, setAlignTarget] = useState("");
  const [fine, setFine] = useState(true);
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
  const onReach = useRef<(r: Reach) => void>(() => {});
  const [reach, setReach] = useState<Reach>(null);
  onReach.current = setReach;
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
    // The routes walked among now (`lib/splats/path.ts`), each in world coordinates, and their line in edit mode.
    let world: Member[] = [];
    let pace = 1;
    // ⚠️ WALLS (`lib/splats/corridor.ts`): the lanes round the routes, and a
    // shop's side lane while its door is open.
    let wallsOn = true;
    let openDoor: { id: string; at: Vec3; lane: Lane } | null = null;
    let reach: Reach = null;
    let reachTarget: { exit?: Exit; door?: Door } = {};
    const setReachNow = (r: Reach) => {
      if (r?.id === reach?.id && r?.kind === reach?.kind) return;
      reach = r;
      onReach.current(r);
    };
    // The scene "here": set by show(), and by walking into another placed scene.
    let currentId = "";
    const onWalkedInto = (id: string) => walkedInto.current(id);
    let recording: Vec3[] | null = null;
    const routeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8, depthTest: false }));
    routeLine.renderOrder = 9;
    routeLine.visible = false;
    scene.add(routeLine);
    const drawRoute = (pts: Vec3[]) => {
      // A little below the eye, so it reads as a line on the ground ahead.
      routeLine.geometry.dispose();
      routeLine.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1] - 0.6, p[2])));
    };
    // Every route of the world at once (a break between scenes: LineSegments pairs).
    const drawWorld = () => {
      const pts: THREE.Vector3[] = [];
      for (const m of world) for (let i = 0; i + 1 < m.route.length; i++) {
        pts.push(new THREE.Vector3(m.route[i][0], m.route[i][1] - 0.6, m.route[i][2]));
        pts.push(new THREE.Vector3(m.route[i + 1][0], m.route[i + 1][1] - 0.6, m.route[i + 1][2]));
      }
      worldLine.geometry.dispose();
      worldLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      // The walls' edges, either side of each route (amber).
      const edges: THREE.Vector3[] = [];
      for (const m of world) {
        if (m.half <= 0) continue;
        for (let i = 0; i + 1 < m.route.length; i++) {
          const [ax, ay, az] = m.route[i];
          const [bx, by, bz] = m.route[i + 1];
          const L = Math.hypot(bx - ax, bz - az) || 1;
          const nx = (-(bz - az) / L) * m.half, nz = ((bx - ax) / L) * m.half;
          for (const k of [1, -1]) {
            edges.push(new THREE.Vector3(ax + nx * k, ay - 0.6, az + nz * k));
            edges.push(new THREE.Vector3(bx + nx * k, by - 0.6, bz + nz * k));
          }
        }
      }
      wallLine.geometry.dispose();
      wallLine.geometry = new THREE.BufferGeometry().setFromPoints(edges);
    };
    const wallLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.7, depthTest: false }));
    wallLine.renderOrder = 9;
    wallLine.visible = false;
    scene.add(wallLine);
    const worldLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8, depthTest: false }));
    worldLine.renderOrder = 9;
    worldLine.visible = false;
    scene.add(worldLine);
    /** Where a scene's file sits, and which way up, from the tour (computers get the sharper copy). */
    const sourceOf = (id: string) => {
      const s = tourRef.current ? sceneById(tourRef.current, id) : null;
      if (!s || !baseRef.current) return null;
      const desktop = !(window.matchMedia?.("(pointer: coarse)").matches ?? false);
      const file = desktop && s.fileHQ && params.get("hq") !== "0" ? s.fileHQ : s.file;
      return { src: `${baseRef.current}/${file}`, flip: s.flip, place: s.place as Place | null };
    };
    const FLIP_Q = new THREE.Quaternion(1, 0, 0, 0);
    /** Put a scene where its place says: scale, turn about up, move — after turning it upright. */
    const placeMesh = (mesh: SplatMesh, flip: boolean, place: Place | null) => {
      const p = place ?? IDENTITY;
      mesh.position.set(...p.offset);
      mesh.quaternion.setFromAxisAngle(UP, p.yaw);
      if (flip) mesh.quaternion.multiply(FLIP_Q);
      mesh.scale.setScalar(p.scale);
    };
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
      openDoor = null;
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
          const so = sourceOf(id);
          src = so?.src ?? null;
          flip = so?.flip ?? true;
        }
        if (!src) throw new Error("No such scene, or NEXT_PUBLIC_SPLAT_BASE_URL is not set.");
        setLoading(0);
        try {
          const mesh = await loadMesh(id, src, flip);
          currentId = id;
          const mine = id === "__single" ? null : sourceOf(id)?.place ?? null;
          placeMesh(mesh, flip, mine);
          mesh.opacity = 1;
          meshes.forEach((m, k) => (m.visible = k === id));
          applyPose(pose);
          // ⚠️ ONE WORLD: a scene placed in the tour's world brings the others
          // placed there along (after it is up), so the visitor walks from
          // one into the next with no jump.
          if (mine && tourRef.current) {
            for (const other of tourRef.current.scenes) {
              if (other.id === id || !other.place) continue;
              void engine.current?.showPlaced(other.id, other.place as Place, false).catch(() => {});
            }
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
      recordRoute(on) {
        if (on) {
          recording = [camera.position.toArray() as Vec3];
          drawRoute(recording);
          routeLine.visible = true;
          return recording;
        }
        const done = recording ?? [];
        recording = null;
        return done;
      },
      setWorld(members, show) {
        world = members.filter((m) => m.route.length > 1 || members.length === 1);
        pace = members[0]?.pace ?? 1;
        drawWorld();
        worldLine.visible = show && world.some((m) => m.route.length > 1);
        wallLine.visible = worldLine.visible;
        if (openDoor && !world.some((m) => m.doors.some((d) => d.id === openDoor!.id))) openDoor = null;
      },
      setWalls(on) {
        wallsOn = on;
      },
      goIn() {
        if (reachTarget.exit) {
          exitHandler.current(reachTarget.exit);
          return true;
        }
        const d = reachTarget.door;
        if (!d) return false;
        openDoor = { id: d.id, at: d.at, lane: doorLane(world.map((m) => m.route), d, Math.max(...world.map((m) => m.half), 1)) };
        // Turn to face in: the doorway is where they are going.
        const dx = d.at[0] - camera.position.x, dz = d.at[2] - camera.position.z;
        const want = Math.atan2(dx, -dz); // path heading; the view's is its negative
        const now = -headingOf(camera.quaternion);
        let off = (want - now) % (2 * Math.PI);
        if (off > Math.PI) off -= 2 * Math.PI;
        if (off <= -Math.PI) off += 2 * Math.PI;
        turnTarget += off;
        setReachNow(null);
        return true;
      },
      hide(id) {
        const m = meshes.get(id);
        if (m && id !== currentId) m.visible = false;
      },
      async showPlaced(id, place, aligning) {
        const so = sourceOf(id);
        if (!so) return;
        const mesh = meshes.get(id) ?? (await loadMesh(id, so.src, so.flip));
        placeMesh(mesh, so.flip, place ?? IDENTITY);
        mesh.opacity = aligning ? 0.55 : 1;
        mesh.visible = true;
        // The report is about the scene the visitor is in, not this one.
        if (currentId) Object.assign(rep, { scene: currentId });
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
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // Enter goes into the shop (or through the exit) in reach — on purpose only.
      if (e.type === "keydown" && e.key === "Enter" && !e.repeat) {
        if (engine.current?.goIn()) e.preventDefault();
        return;
      }
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
      // ⚠️ A FINGER (OR THE MOUSE) ALWAYS TURNS THE VIEW — on a desktop, on a
      // phone, while tilt-walking, and with the phone's own motion on, where
      // a sideways drag turns the body and the phone does the rest.
      if (pointers.size === 1) {
        const k = (camera.fov / el.clientHeight) * (Math.PI / 180);
        if (gyroOn && gyroHave) {
          turnTarget += (e.clientX - prev.x) * k;
          turnYaw = turnTarget;
        } else {
          yaw += (e.clientX - prev.x) * k;
          pitch = THREE.MathUtils.clamp(pitch + (e.clientY - prev.y) * k, -1.45, 1.45);
        }
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
      // ⚠️ THE CAMERAMAN'S ROUTE IS A BANKED ROAD (`lib/splats/path.ts`):
      // walking forward with no steering of their own, the visitor is drawn
      // gently along the route that was filmed. Any steering wins.
      // At a fork the nearest route wins: heading into the alley, its route
      // takes over and carries the visitor in — that is the branching.
      let nearest: { id: string; route: Vec3[]; pace: number } | null = null;
      let nearestDist = Infinity;
      for (const m of world) {
        if (m.route.length < 2) continue;
        const n = nearestOnRoute(m.route, camera.position.x, camera.position.z);
        if (n && n.dist < nearestDist) {
          nearestDist = n.dist;
          nearest = m;
        }
      }
      // In a shop (its door open, off the alley) the alley's route does not pull them out.
      const inShop = openDoor != null && (nearestDist > (world.find((m) => m.id === nearest?.id)?.half ?? 1));
      if (nearest && velFwd > 0.05 && !inShop) {
        const steering = Math.abs(stickX) > 0.08 || Math.abs(velTurn) > 0.05 || Math.abs(turnTarget - turnYaw) > 0.03 || pointers.size > 0;
        if (!steering) turnTarget += routePull(nearest.route, camera.position.x, camera.position.z, -heading) * dt * Math.min(1, velFwd / walkSpeed + 0.3);
      }
      // Walking from one placed scene into the next: it becomes the scene "here".
      if (nearest && nearest.id !== currentId && nearestDist < 3 && world.length > 1) {
        currentId = nearest.id;
        pace = nearest.pace;
        onWalkedInto(nearest.id);
      }
      velFwd += (wantFwd * walkSpeed * pace * boost - velFwd) * ease;
      velTurn += (wantTurn * TURN_RATE - velTurn) * ease;
      if (Math.abs(velFwd) > 1e-4) camera.position.addScaledVector(forward, velFwd * dt);
      if (Math.abs(velTurn) > 1e-4) turnTarget += velTurn * dt;
      turnYaw += (turnTarget - turnYaw) * ease;
      // ⚠️ WALLS: inside the lanes walking is free; at an edge the push out
      // is taken away (eased, so it is a soft wall), the step along kept —
      // the visitor slides along the shop fronts and is never stopped walking
      // down the alley. The eye follows the filmed height: no floor or
      // ceiling to go through. Looking round is never limited.
      const lanes: Lane[] = wallsOn ? world.filter((m) => m.half > 0 && m.route.length > 1).map((m) => ({ route: m.route, half: m.half })) : [];
      if (lanes.length && openDoor) lanes.push(openDoor.lane);
      if (lanes.length) {
        const k = keepInside(lanes, camera.position.x, camera.position.z);
        const firm = 1 - Math.exp(-dt / 0.05);
        if (k.outside > 0) {
          camera.position.x += (k.x - camera.position.x) * firm;
          camera.position.z += (k.z - camera.position.z) * firm;
        }
        if (k.y != null) camera.position.y += (k.y - camera.position.y) * (1 - Math.exp(-dt / 0.4));
        // Back out in the alley, away from the door: it closes behind them.
        if (openDoor && k.lane !== lanes.length - 1 && Math.hypot(camera.position.x - openDoor.at[0], camera.position.z - openDoor.at[2]) > 4) openDoor = null;
      } else {
        if (keys.has("e")) camera.position.y += walkSpeed * dt;
        if (keys.has("q")) camera.position.y -= walkSpeed * dt;
      }

      // What Enter would go into: the nearest exit or shop door faced, near.
      {
        const h = -heading;
        let best: { d: number; r: Reach; t: typeof reachTarget } | null = null;
        for (const ex of markerExits) {
          const d = inReach(ex.at, camera.position.x, camera.position.z, h);
          if (d != null && (!best || d < best.d)) best = { d, r: { kind: "exit", id: ex.id, label: ex.label.en }, t: { exit: ex } };
        }
        for (const m of lanes.length ? world : []) for (const dr of m.doors) {
          if (dr.id === openDoor?.id) continue;
          const d = inReach(dr.at, camera.position.x, camera.position.z, h);
          if (d != null && (!best || d < best.d)) best = { d, r: { kind: "door", id: dr.id, label: dr.label.en }, t: { door: dr } };
        }
        reachTarget = best?.t ?? {};
        setReachNow(best?.r ?? null);
      }

      if (recording) {
        const next = recordStep(recording, camera.position.toArray() as Vec3);
        if (next !== recording) {
          recording = next;
          drawRoute(recording);
        }
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
    if (!tour || !here) return engine.current?.setWorld([], false);
    // Placed in the tour's world: walk among every placed scene, each route
    // turned into world coordinates; otherwise, this scene alone (its own
    // coordinates are the world's). The scene here comes first: its pace.
    const members = here.place ? [here, ...tour.scenes.filter((s) => s.place && s.id !== here.id)] : [here];
    engine.current?.setWorld(
      members.map((s) => ({
        id: s.id,
        route: s.place ? s.route.map((p) => toWorld(s.place as Place, p)) : s.route,
        pace: s.pace,
        half: s.walls * (s.place?.scale ?? 1),
        doors: s.doors,
      })),
      editing,
    );
  }, [here, tour, editing]);

  // Walls stay up except while the operator records a route or aligns a scene (or lowers them to look round).
  useEffect(() => {
    engine.current?.setWalls(!(recordingRoute || align || (editing && wallsOff)));
  }, [recordingRoute, align, editing, wallsOff]);

  // Walking from one placed scene into the next makes it the scene here, with
  // no jump: its title, exits and pace follow.
  walkedInto.current = (id: string) => {
    setCurrent(id);
    window.history.replaceState(window.history.state, "", `?scene=${id}${editing ? "&edit=1" : ""}`);
  };

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

  /**
   * ALIGN — join another scene to this one (`lib/splats/place.ts`). It is
   * shown see-through where the operator stands; they nudge it until the
   * part both filmed lies on itself, then «Done» saves its place. This scene
   * becomes the world's anchor if it is not placed yet.
   */
  function startAlign() {
    if (!tour || !here || !alignTarget || !engine.current) return;
    let t = tour;
    if (!here.place) t = updateScene(t, here.id, { place: IDENTITY });
    const target = sceneById(t, alignTarget);
    if (!target) return;
    const pose = engine.current.pose();
    const start: Place = target.place ?? { offset: engine.current.pointAhead(3), yaw: -pose.yaw, scale: 1 };
    changeTour(t);
    setAlign({ id: target.id, place: start, before: target.place });
    void engine.current.showPlaced(target.id, start, true);
  }
  function alignBy(by: { fwd?: number; side?: number; up?: number; turn?: number; grow?: number }) {
    if (!align || !engine.current) return;
    const k = fine ? 1 : 10;
    const yawNow = engine.current.pose().yaw;
    // Moves are in the operator's own frame: forward is where they look.
    const fwd = (by.fwd ?? 0) * 0.05 * k, side = (by.side ?? 0) * 0.05 * k;
    const move: Vec3 = [Math.sin(yawNow) * fwd + Math.cos(yawNow) * side, (by.up ?? 0) * 0.05 * k, -Math.cos(yawNow) * fwd + Math.sin(yawNow) * side];
    const place = nudge(align.place, {
      move,
      turn: by.turn ? by.turn * (Math.PI / 180) * k : undefined,
      grow: by.grow ? Math.pow(1.01, by.grow * k) : undefined,
    }, engine.current.pointAhead(3));
    setAlign({ ...align, place });
    void engine.current.showPlaced(align.id, place, true);
  }
  function finishAlign(keep: boolean) {
    if (!align || !tour || !engine.current) return;
    if (keep) {
      changeTour(updateScene(tour, align.id, { place: align.place }));
      void engine.current.showPlaced(align.id, align.place, false);
    } else if (align.before) {
      void engine.current.showPlaced(align.id, align.before, false);
    } else {
      engine.current.hide(align.id);
    }
    setAlign(null);
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

      {/* Enter / «Go in»: a shop door or exit near and faced */}
      {reach && (
        <button
          dir="ltr"
          onClick={() => engine.current?.goIn()}
          className="absolute bottom-[19rem] left-1/2 -translate-x-1/2 rounded-full border border-amber-300/70 bg-black/75 px-5 py-2.5 text-[15px] text-amber-50"
        >
          {touch ? "" : "↵ Enter · "}برو داخل · Go in: {reach.label}
        </button>
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
            <button
              className={`rounded-full border px-3 py-1 ${recordingRoute ? "border-rose-300/70 bg-rose-400/25 text-rose-50" : "border-sky-300/60 text-sky-100"}`}
              onClick={() => {
                if (!recordingRoute) {
                  engine.current?.recordRoute(true);
                  setRecordingRoute(true);
                  return;
                }
                const r = engine.current?.recordRoute(false) ?? [];
                setRecordingRoute(false);
                // Recorded in the world; kept in the scene's own coordinates.
                const local = here.place ? r.map((p) => toLocal(here.place as Place, p)) : r;
                if (r.length > 1) changeTour(updateScene(tour, here.id, { route: local }));
              }}
            >
              {recordingRoute ? "■ Stop recording route" : here.route.length ? `● Record route again (${here.route.length} points)` : "● Record the cameraman's route"}
            </button>
            {here.route.length > 0 && !recordingRoute && (
              <button className="rounded-full border border-white/30 px-3 py-1" onClick={() => changeTour(updateScene(tour, here.id, { route: [] }))}>
                Clear route
              </button>
            )}
            <button className="rounded-full border border-emerald-300/60 px-3 py-1 text-emerald-100" onClick={() => void saveTour()}>Save tour</button>
          </div>
          <div className="mt-2 space-y-1.5 border-t border-white/15 pt-2">
            <div className="font-bold text-amber-200">Walls &amp; shop doors</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/60">Walls either side of the route:</span>
              <button className="rounded bg-white/10 px-2" onClick={() => changeTour(updateScene(tour, here.id, { walls: Math.max(0, Math.round((here.walls - 0.25) * 100) / 100) }))}>−</button>
              <span>{here.walls ? here.walls.toFixed(2) : "off"}</span>
              <button className="rounded bg-white/10 px-2" onClick={() => changeTour(updateScene(tour, here.id, { walls: Math.round((here.walls + 0.25) * 100) / 100 }))}>+</button>
              <label className="ms-auto flex items-center gap-1 text-white/60">
                <input type="checkbox" checked={wallsOff} onChange={(e) => setWallsOff(e.target.checked)} /> walk through walls
              </label>
            </div>
            {!here.route.length && <div className="text-amber-200/80">No route yet: walls need the cameraman&apos;s route (record it, or upload the camera .json).</div>}
            <div className="text-white/50">Amber lines: the walls. Face a shop&apos;s entrance from the alley, then:</div>
            <div className="flex gap-2">
              <input className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1" placeholder="shop name" value={doorName} onChange={(e) => setDoorName(e.target.value)} />
              <button className="rounded-full border border-amber-300/60 px-3 py-1" onClick={() => {
                changeTour(addDoor(tour, here.id, engine.current!.pointAhead(1.5), doorName.trim()));
                setDoorName("");
              }}>Shop door 1.5 m ahead</button>
            </div>
            {here.doors.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-white/70">
                ⌂ {d.label.en} <span className="text-white/40">{d.depth} deep</span>
                <button className="ms-auto text-rose-300" onClick={() => changeTour(removeDoor(tour, here.id, d.id))}>remove</button>
              </div>
            ))}
          </div>
          {here.exits.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-white/70">
              → {e.label.en} ({e.to}) <span className="text-white/40">[{e.at.map((v) => v.toFixed(1)).join(", ")}]</span>
              <button className="ms-auto text-rose-300" onClick={() => changeTour(removeExit(tour, here.id, e.id))}>remove</button>
            </div>
          ))}
          <div className="mt-2 space-y-1.5 border-t border-white/15 pt-2">
            <div className="font-bold text-sky-200">Join another scene (Align)</div>
            {!align ? (
              <div className="flex gap-2">
                <select className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1" value={alignTarget} onChange={(e) => setAlignTarget(e.target.value)}>
                  <option value="">scene to join here…</option>
                  {others.map((s) => <option key={s.id} value={s.id}>{s.title.en} ({s.id}){s.place ? " ✓" : ""}</option>)}
                </select>
                <button disabled={!alignTarget} className="rounded-full border border-sky-300/60 px-3 py-1 disabled:opacity-40" onClick={startAlign}>Align</button>
              </div>
            ) : (
              <>
                <div className="text-white/60">Stand where both scenes were filmed; nudge «{align.id}» until it lies on this one.</div>
                <div className="grid grid-cols-4 gap-1">
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ fwd: 1 })}>↑ away</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ fwd: -1 })}>↓ near</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ side: -1 })}>← left</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ side: 1 })}>→ right</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ up: 1 })}>⤒ up</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ up: -1 })}>⤓ down</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ turn: -1 })}>⟲ turn</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ turn: 1 })}>⟳ turn</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ grow: -1 })}>− smaller</button>
                  <button className="rounded bg-white/10 py-1" onClick={() => alignBy({ grow: 1 })}>+ bigger</button>
                  <button className={`col-span-2 rounded py-1 ${fine ? "bg-white/10" : "bg-amber-300/30"}`} onClick={() => setFine(!fine)}>
                    {fine ? "steps: fine" : "steps: coarse ×10"}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-full border border-emerald-300/60 px-3 py-1 text-emerald-100" onClick={() => finishAlign(true)}>Done</button>
                  <button className="rounded-full border border-white/30 px-3 py-1" onClick={() => finishAlign(false)}>Cancel</button>
                  <span className="self-center text-white/40">then Save tour</span>
                </div>
              </>
            )}
          </div>
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
