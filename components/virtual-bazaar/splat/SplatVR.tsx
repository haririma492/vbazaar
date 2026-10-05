"use client";

/**
 * THE TOUR IN A HEADSET (`/vr`) — the same splat scenes, exits and paths as
 * `/vca/splat`, walked in WebXR: «Enter VR» in the headset's own browser and
 * the place is all round the visitor.
 *
 * ⚠️ EVERY BRAND, NOT ONE. Only what all WebXR headsets share is used:
 *   • Meta Quest, Pico, Vive / Index / WMR (SteamVR): thumbstick forward walks
 *     along the path, sideways snaps the view round; the trigger points.
 *   • Hands (Quest, Pico, Vision Pro): pinch is the trigger.
 *   • Apple Vision Pro: look and pinch (a "transient pointer") — no stick, so
 *     pointing at the blue path and pinching is how one walks.
 * The arithmetic of it is `lib/splats/xr.ts`.
 *
 * What can be pointed at: an exit's amber marker (to the next scene — a
 * junction), a shop door's pink one (stand in front of it, facing in), the
 * blue path (stand there), and «Back» at the visitor's side (where they came
 * from: the trail of `lib/splats/tour.ts`). B / Y on a controller is Back too.
 *
 * Outside a headset the page shows the scene with drag-to-look and the same
 * clicks, and says how to open it in a headset.
 *
 *   /vr                   the tour, from its start scene
 *   /vr?scene=store-01    the tour, from that scene
 *   /vr?xrscale=0.75      the headset's render resolution (default 0.5: splats are heavy)
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";
import type { SplatMesh } from "@sparkjsdev/spark";
import { enter, leave, parseTour, sceneById, DEFAULT_DRIVE, type Door, type Exit, type Pose, type Tour, type Trail, type Vec3 } from "@/lib/splats/tour";
import { bridges, doorLane, inReach, keepInside, type Lane } from "@/lib/splats/corridor";
import { angleDiff, guideStep, nearestOnRoute } from "@/lib/splats/path";
import { IDENTITY, toWorld, type Place } from "@/lib/splats/place";
import { SNAP_TURN, STICK_REST, standBefore, stickAxes, stickIntent, teleportOnto, type StickState } from "@/lib/splats/xr";
import { downloadSplat, makeMarker, splatBase } from "./load";

const DECODE_TIMEOUT_MS = 120_000;
const UP = new THREE.Vector3(0, 1, 0);
const DOOR_RGB = "244, 114, 182";

type Member = { id: string; route: Vec3[]; pace: number; half: number; doors: Door[] };
type Support = "checking" | "vr" | "none";

type Engine = {
  show: (sceneId: string, pose: Pose) => Promise<void>;
  pose: () => Pose;
  setMarkers: (exits: Exit[]) => void;
  setWorld: (members: Member[]) => void;
  setBack: (label: string | null) => void;
  setSpeed: (unitsPerSecond: number, accel: number) => void;
  enterXr: () => Promise<void>;
};

/** A flat label in the scene (the «Back» button, «Loading…»). */
function makeLabel(text: string, w = 0.36): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(15, 15, 20, 0.8)";
  g.beginPath();
  g.roundRect(4, 4, 504, 120, 56);
  g.fill();
  g.strokeStyle = "rgba(255, 255, 255, 0.6)";
  g.lineWidth = 6;
  g.stroke();
  g.font = "bold 52px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText(text, 256, 66, 470);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 12;
  return mesh;
}

function disposeLabel(m: THREE.Mesh) {
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
  m.geometry.dispose();
}

export default function SplatVR() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [support, setSupport] = useState<Support>("checking");
  const [inXr, setInXr] = useState(false);
  const [tour, setTour] = useState<Tour | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [trail, setTrail] = useState<Trail>([]);
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tourRef = useRef<Tour | null>(null);
  const baseRef = useRef("");
  const trailRef = useRef<Trail>([]);
  const currentRef = useRef<string | null>(null);
  const exitHandler = useRef<(exit: Exit) => void>(() => {});
  const backHandler = useRef<() => void>(() => {});
  const walkedInto = useRef<(id: string) => void>(() => {});
  tourRef.current = tour;
  trailRef.current = trail;
  currentRef.current = current;

  // Can this browser show immersive VR? (A headset's browser, or a PC browser with SteamVR / WMR running.)
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr || !window.isSecureContext) return setSupport("none");
    xr.isSessionSupported("immersive-vr").then((ok) => setSupport(ok ? "vr" : "none"), () => setSupport("none"));
  }, []);

  // ── The renderer, the rig, the controllers ───────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const params = new URLSearchParams(window.location.search);
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.xr.enabled = true;
    // ⚠️ "local", NOT "local-floor": the scene's routes are the filmed EYE
    // height, so the visitor's head starts there, seated or standing — and
    // every headset supports it (Vision Pro included).
    renderer.xr.setReferenceSpaceType("local");
    // Splats are heavy: half the headset's resolution keeps the frame rate (Spark's own default).
    const scale = Number(params.get("xrscale"));
    renderer.xr.setFramebufferScaleFactor(Number.isFinite(scale) && scale >= 0.25 && scale <= 1 ? scale : 0.5);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101014);
    // The rig is where the visitor stands in the tour; the camera (the head) moves inside it.
    const rig = new THREE.Group();
    scene.add(rig);
    const camera = new THREE.PerspectiveCamera(70, el.clientWidth / el.clientHeight, 0.05, 500);
    rig.add(camera);
    const markers = new THREE.Group();
    const doorMarkers = new THREE.Group();
    scene.add(markers, doorMarkers);

    // Spark arrives as its own chunk (2.6 MB): only the splat pages pay for it.
    let sparkMod: typeof import("@sparkjsdev/spark") | null = null;
    const sparkReady = import("@sparkjsdev/spark").then((m) => {
      if (disposed) return;
      sparkMod = m;
      scene.add(new m.SparkRenderer({ renderer }));
    });

    // The blue path: drawn as in `/vca/splat`, and here also what is pointed at to walk.
    const pathBand = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    pathBand.renderOrder = 8;
    scene.add(pathBand);
    const drawBand = (routes: Vec3[][]) => {
      const pos: number[] = [];
      for (const r of routes) for (let i = 0; i + 1 < r.length; i++) {
        const [ax, ay, az] = r[i];
        const [bx, by, bz] = r[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-6) continue;
        // Wider than on a screen: a ray from a hand must be able to land on it.
        const w = 0.3;
        const nx = (-(bz - az) / L) * w, nz = ((bx - ax) / L) * w;
        const y0 = ay - 0.6, y1 = by - 0.6;
        pos.push(ax + nx, y0, az + nz, ax - nx, y0, az - nz, bx + nx, y1, bz + nz);
        pos.push(bx + nx, y1, bz + nz, ax - nx, y0, az - nz, bx - nx, y1, bz - nz);
      }
      pathBand.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      pathBand.geometry = g;
    };
    // Where a pointed-at spot of the path would put the visitor.
    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.22, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    reticle.renderOrder = 11;
    reticle.visible = false;
    scene.add(reticle);

    // «Back», at the visitor's side and a little below the eye: it goes where they go.
    let backButton: THREE.Mesh | null = null;
    const loadingLabel = makeLabel("Loading… · در حال بارگذاری", 0.6);
    loadingLabel.position.set(0, 0, -1.4);
    loadingLabel.visible = false;
    camera.add(loadingLabel);

    // ── Scenes ─────────────────────────────────────────────────────────────
    const meshes = new Map<string, SplatMesh>();
    const FLIP_Q = new THREE.Quaternion(1, 0, 0, 0);
    const placeMesh = (mesh: SplatMesh, flip: boolean, place: Place | null) => {
      const p = place ?? IDENTITY;
      mesh.position.set(...p.offset);
      mesh.quaternion.setFromAxisAngle(UP, p.yaw);
      if (flip) mesh.quaternion.multiply(FLIP_Q);
      mesh.scale.setScalar(p.scale);
    };
    // ⚠️ A HEADSET IS A PHONE'S GRAPHICS CHIP: the phone copy of each scene
    // (`file`), not the computer's sharper one, unless ?hq=1.
    const sourceOf = (id: string) => {
      const s = tourRef.current ? sceneById(tourRef.current, id) : null;
      if (!s || !baseRef.current) return null;
      const file = params.get("hq") === "1" && s.fileHQ ? s.fileHQ : s.file;
      return { src: `${baseRef.current}/${file}`, flip: s.flip, place: s.place as Place | null };
    };
    // A scene already on its way is waited for, not downloaded again.
    const pending = new Map<string, Promise<SplatMesh>>();
    function loadMesh(id: string, src: string, flip: boolean, quiet = false): Promise<SplatMesh> {
      const on = pending.get(id);
      if (on) return on;
      const p = loadMeshNow(id, src, flip, quiet).finally(() => pending.delete(id));
      pending.set(id, p);
      return p;
    }
    /** `quiet`: a scene joined to the one shown, loading behind the view — no progress bar over it. */
    async function loadMeshNow(id: string, src: string, flip: boolean, quiet: boolean): Promise<SplatMesh> {
      const have = meshes.get(id);
      if (have) return have;
      await sparkReady;
      if (!sparkMod) throw new Error("Spark did not load.");
      const bytes = await downloadSplat(src, (share) => { if (!quiet) setLoading(share); });
      const mesh = new sparkMod.SplatMesh({
        fileBytes: bytes,
        fileName: new URL(src).pathname.split("/").pop() || "scene.spz",
        extSplats: params.get("precision") !== "low",
      });
      if (flip) mesh.quaternion.copy(FLIP_Q);
      scene.add(mesh);
      let timer = 0;
      await Promise.race([
        mesh.initialized,
        new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error("The scene's file did not decode.")), DECODE_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      meshes.set(id, mesh);
      return mesh;
    }

    // ── The head, and moving the rig under it ──────────────────────────────
    const headPos = new THREE.Vector3();
    const headQ = new THREE.Quaternion();
    const look = new THREE.Euler(0, 0, 0, "YXZ");
    /** Where the head is in the tour's world, and which way it faces (0: −z, + right). */
    const head = () => {
      rig.updateMatrixWorld(true);
      camera.getWorldPosition(headPos);
      camera.getWorldQuaternion(headQ);
      return { x: headPos.x, y: headPos.y, z: headPos.z, heading: -look.setFromQuaternion(headQ, "YXZ").y };
    };
    /** Turn the rig about the head (not about its own origin, which would swing the visitor sideways). */
    const turnBy = (dHeading: number) => {
      const h = head();
      rig.rotation.y -= dHeading;
      const n = head();
      rig.position.x += h.x - n.x;
      rig.position.z += h.z - n.z;
    };
    /** Put the head at (x, y, z) — y null keeps its height — facing `heading` (null keeps it). */
    const putHead = (x: number, y: number | null, z: number, heading: number | null) => {
      if (heading != null) turnBy(angleDiff(heading, head().heading));
      const h = head();
      rig.position.x += x - h.x;
      rig.position.z += z - h.z;
      if (y != null) rig.position.y += y - h.y;
    };
    // Outside a headset, a drag looks round (the camera turns inside the rig).
    let lookYaw = 0;
    let lookPitch = 0;
    const applyPose = (p: Pose) => {
      if (!renderer.xr.isPresenting) {
        lookYaw = 0;
        lookPitch = p.pitch;
        camera.position.set(0, 0, 0);
        camera.quaternion.setFromEuler(look.set(-lookPitch, 0, 0));
      }
      putHead(p.position[0], p.position[1], p.position[2], p.yaw);
      vel = 0;
      openDoor = null;
    };

    // ── Walking ────────────────────────────────────────────────────────────
    let world: Member[] = [];
    let links: Lane[] = [];
    let routes: Vec3[][] = [];
    let currentId = "";
    let speed = DEFAULT_DRIVE.speed;
    let accel = DEFAULT_DRIVE.accel;
    let pace = 1;
    let vel = 0;
    let autoAt = -1e9;
    let openDoor: { id: string; at: Vec3; lane: Lane } | null = null;
    let markerExits: Exit[] = [];
    let backOn = false;

    const takeDoor = (d: Door) => {
      const h = head();
      const s = standBefore(d.at, h.x, h.z);
      putHead(s.x, null, s.z, s.heading);
      vel = 0;
      openDoor = { id: d.id, at: d.at, lane: doorLane(world.map((m) => m.route), d, Math.max(...world.map((m) => m.half), 1)) };
    };

    // ── Pointing: controllers, hands, a gaze-and-pinch, or the mouse ───────
    const raycaster = new THREE.Raycaster();
    type Hit =
      | { kind: "exit"; exit: Exit; obj: THREE.Object3D; dist: number }
      | { kind: "door"; door: Door; obj: THREE.Object3D; dist: number }
      | { kind: "back"; dist: number }
      | { kind: "path"; at: Vec3; dist: number };
    const pick = (): Hit | null => {
      raycaster.camera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
      if (backButton?.visible) {
        const b = raycaster.intersectObject(backButton, false)[0];
        if (b) return { kind: "back", dist: b.distance };
      }
      const m = raycaster.intersectObjects(markers.children, false)[0];
      if (m) {
        const exit = markerExits.find((x) => x.id === m.object.userData.exitId);
        if (exit) return { kind: "exit", exit, obj: m.object, dist: m.distance };
      }
      const d = raycaster.intersectObjects(doorMarkers.children, false)[0];
      if (d) {
        const door = world.flatMap((w) => w.doors).find((x) => x.id === d.object.userData.doorId);
        if (door) return { kind: "door", door, obj: d.object, dist: d.distance };
      }
      const p = pathBand.visible ? raycaster.intersectObject(pathBand, false)[0] : undefined;
      if (p) {
        const at = teleportOnto(routes, p.point.x, p.point.z);
        if (at) return { kind: "path", at, dist: p.distance };
      }
      return null;
    };
    const act = (hit: Hit | null) => {
      if (!hit) return;
      if (hit.kind === "back") backHandler.current();
      else if (hit.kind === "exit") exitHandler.current(hit.exit);
      else if (hit.kind === "door") takeDoor(hit.door);
      else {
        putHead(hit.at[0], hit.at[1], hit.at[2], null);
        vel = 0;
        openDoor = null;
      }
    };
    const rayFrom = (obj: THREE.Object3D) => {
      obj.updateMatrixWorld(true);
      const rot = new THREE.Matrix4().extractRotation(obj.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(obj.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rot);
    };

    type Pad = { ctl: THREE.Group; line: THREE.Line; source: XRInputSource | null; stick: StickState; backHeld: boolean };
    const pads: Pad[] = [];
    const controllerModels = new XRControllerModelFactory();
    const handModels = new XRHandModelFactory();
    for (let i = 0; i < 2; i++) {
      const ctl = renderer.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
      );
      line.scale.z = 5;
      line.visible = false;
      ctl.add(line);
      const pad: Pad = { ctl, line, source: null, stick: STICK_REST, backHeld: false };
      ctl.addEventListener("connected", (e) => {
        pad.source = (e as unknown as { data: XRInputSource }).data;
        // A gaze-and-pinch (Vision Pro) has no ray to draw: the eyes are the ray.
        line.visible = pad.source.targetRayMode === "tracked-pointer";
      });
      ctl.addEventListener("disconnected", () => {
        pad.source = null;
        line.visible = false;
      });
      ctl.addEventListener("select", () => {
        rayFrom(ctl);
        act(pick());
      });
      rig.add(ctl);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(controllerModels.createControllerModel(grip));
      rig.add(grip);
      const hand = renderer.xr.getHand(i);
      hand.add(handModels.createHandModel(hand, "spheres"));
      rig.add(hand);
      pads.push(pad);
    }

    engine.current = {
      async show(id, pose) {
        const so = sourceOf(id);
        if (!so) throw new Error("No such scene, or the splat bucket's address is not set.");
        setLoading(0);
        loadingLabel.visible = true;
        try {
          const mesh = await loadMesh(id, so.src, so.flip);
          currentId = id;
          placeMesh(mesh, so.flip, so.place);
          meshes.forEach((m, k) => (m.visible = k === id));
          // Let go of scenes left behind (not this one, not those placed in its world): a headset's memory is a phone's.
          const keep = new Set([id, ...(so.place ? (tourRef.current?.scenes ?? []).filter((s) => s.place).map((s) => s.id) : [])]);
          for (const [k, m] of [...meshes]) {
            if (keep.has(k)) continue;
            scene.remove(m);
            m.dispose();
            meshes.delete(k);
          }
          applyPose(pose);
          // One world: the others placed in it come along, so the visitor walks from one into the next.
          if (so.place && tourRef.current) {
            for (const other of tourRef.current.scenes) {
              if (other.id === id || !other.place) continue;
              const os = sourceOf(other.id);
              if (!os) continue;
              void loadMesh(other.id, os.src, os.flip, true).then((m) => {
                placeMesh(m, os.flip, os.place);
                m.visible = true;
              }).catch(() => {});
            }
          }
        } finally {
          setLoading(null);
          loadingLabel.visible = false;
        }
      },
      pose() {
        const h = head();
        return { position: [h.x, h.y, h.z], yaw: h.heading, pitch: 0 };
      },
      setMarkers(exits) {
        markerExits = exits;
        for (const c of markers.children) {
          const s = c as THREE.Sprite;
          s.material.map?.dispose();
          s.material.dispose();
        }
        markers.clear();
        for (const e of exits) {
          const m = makeMarker(e.label.en);
          m.position.set(...e.at);
          m.userData.exitId = e.id;
          markers.add(m);
        }
      },
      setWorld(members) {
        world = members.filter((m) => m.route.length > 1 || members.length === 1);
        pace = members[0]?.pace ?? 1;
        links = world.length > 1 ? bridges(world.map((m) => ({ route: m.route, half: m.half }))) : [];
        routes = [...world.filter((m) => m.route.length > 1).map((m) => m.route), ...links.map((l) => l.route)];
        drawBand(routes);
        pathBand.visible = routes.length > 0;
        for (const c of doorMarkers.children) {
          const s = c as THREE.Sprite;
          s.material.map?.dispose();
          s.material.dispose();
        }
        doorMarkers.clear();
        for (const d of world.flatMap((m) => m.doors)) {
          const m = makeMarker(d.label.en, DOOR_RGB);
          m.position.set(...d.at);
          m.userData.doorId = d.id;
          doorMarkers.add(m);
        }
        if (openDoor && !world.some((m) => m.doors.some((d) => d.id === openDoor!.id))) openDoor = null;
      },
      setBack(label) {
        if (backButton) {
          rig.remove(backButton);
          disposeLabel(backButton);
          backButton = null;
        }
        backOn = label != null;
        if (!label) return;
        backButton = makeLabel(`◀ ${label}`);
        backButton.position.set(-0.3, -0.45, -0.5);
        backButton.rotation.x = -0.6;
        rig.add(backButton);
      },
      setSpeed(s, a) {
        speed = s;
        accel = a;
      },
      async enterXr() {
        const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
        if (!xr) return;
        // ⚠️ THE REQUEST COMES FIRST IN THE TAP: a browser grants a session only from a user's gesture.
        const session = await xr.requestSession("immersive-vr", { optionalFeatures: ["hand-tracking"] });
        // Where the visitor stood on the screen is where they stand in the
        // headset: the head is put back at the rig's origin, facing its way —
        // which is where a headset's "local" space starts the head.
        const before = engine.current?.pose();
        lookYaw = 0;
        lookPitch = 0;
        camera.position.set(0, 0, 0);
        camera.quaternion.identity();
        if (before) putHead(before.position[0], before.position[1], before.position[2], before.yaw);
        session.addEventListener("end", () => {
          setInXr(false);
          const p = engine.current?.pose();
          // After the session lets go of the camera: then the screen's view takes over again.
          window.setTimeout(() => p && applyPose({ ...p, pitch: 0 }), 0);
        });
        await renderer.xr.setSession(session);
        setInXr(true);
      },
    };

    // ── Outside a headset: drag to look, click to point ────────────────────
    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    let downAt: { x: number; y: number; t: number } | null = null;
    let last: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      last = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!last) return;
      const k = (camera.fov / el.clientHeight) * (Math.PI / 180);
      lookYaw += (e.clientX - last.x) * k;
      lookPitch = THREE.MathUtils.clamp(lookPitch + (e.clientY - last.y) * k, -1.45, 1.45);
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      last = null;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 && performance.now() - downAt.t < 500) {
        const r = canvas.getBoundingClientRect();
        rig.updateMatrixWorld(true);
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        act(pick());
      }
      downAt = null;
    };
    const onResize = () => {
      if (renderer.xr.isPresenting) return;
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", onResize);

    // ── Loop ───────────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const presenting = renderer.xr.isPresenting;
      if (!presenting) camera.quaternion.setFromEuler(look.set(-lookPitch, -lookYaw, 0));

      // The sticks: forward walks, sideways snaps; B / Y is Back.
      let want = 0;
      for (const pad of pads) {
        const gp = pad.source?.gamepad;
        if (!presenting || !gp) continue;
        const [x, y] = stickAxes(gp.axes);
        const s = stickIntent(x, y, pad.stick);
        pad.stick = s.state;
        if (Math.abs(s.forward) > Math.abs(want)) want = s.forward;
        if (s.snap) turnBy(s.snap * SNAP_TURN);
        const b = gp.buttons[5]?.pressed ?? false;
        if (b && !pad.backHeld && backOn) backHandler.current();
        pad.backHeld = b;
      }
      vel += (want * speed * pace - vel) * (1 - Math.exp(-dt / accel));

      const h = head();
      // Walking from one placed scene into the next makes it the scene here.
      let nearestId: string | null = null;
      let nearestDist = Infinity;
      for (const m of world) {
        const n = nearestOnRoute(m.route, h.x, h.z);
        if (n && n.dist < nearestDist) {
          nearestDist = n.dist;
          nearestId = m.id;
        }
      }
      if (nearestId && nearestId !== currentId && nearestDist < 3 && world.length > 1) {
        currentId = nearestId;
        pace = world.find((m) => m.id === nearestId)?.pace ?? 1;
        walkedInto.current(nearestId);
      }

      if (Math.abs(vel) > 1e-4) {
        // ⚠️ FORWARD FOLLOWS THE PATH, round its bends, as on the phone; the
        // view is NOT turned for them (in a headset that is the head's job).
        const guide = !openDoor ? guideStep(routes, h.x, h.z, vel >= 0 ? h.heading : h.heading + Math.PI) : null;
        const dx = guide ? guide.dx : Math.sin(h.heading) * Math.sign(vel);
        const dz = guide ? guide.dz : -Math.cos(h.heading) * Math.sign(vel);
        rig.position.x += dx * Math.abs(vel) * dt;
        rig.position.z += dz * Math.abs(vel) * dt;
      }

      // Walls: the lanes round the routes (and a shop's, its door open); the eye follows the filmed height while walking.
      const lanes: Lane[] = world.filter((m) => m.half > 0 && m.route.length > 1).map((m) => ({ route: m.route, half: m.half }));
      if (lanes.length) lanes.push(...links);
      if (lanes.length && openDoor) lanes.push(openDoor.lane);
      if (lanes.length) {
        const hh = head();
        const k = keepInside(lanes, hh.x, hh.z);
        const firm = 1 - Math.exp(-dt / 0.05);
        if (k.outside > 0) {
          rig.position.x += (k.x - hh.x) * firm;
          rig.position.z += (k.z - hh.z) * firm;
        }
        if (k.y != null && Math.abs(vel) > 0.05) rig.position.y += (k.y - hh.y) * (1 - Math.exp(-dt / 0.4));
        if (openDoor && k.lane !== lanes.length - 1 && Math.hypot(hh.x - openDoor.at[0], hh.z - openDoor.at[2]) > 4) openDoor = null;
      }

      // The end of the walk goes on by itself, through the exit placed there.
      {
        const mine = world.find((m) => m.id === currentId);
        const end = mine && mine.route.length > 1 ? mine.route[mine.route.length - 1] : null;
        const hh = head();
        if (end && vel > 0.05 && !openDoor && performance.now() - autoAt > 4000 && Math.hypot(hh.x - end[0], hh.z - end[2]) < 1.5) {
          const next = markerExits.find((e) => !world.some((m) => m.id === e.to) && Math.hypot(e.at[0] - end[0], e.at[2] - end[2]) < 3 &&
            inReach(e.at, hh.x, hh.z, hh.heading, 4) != null);
          if (next) {
            autoAt = performance.now();
            vel = 0;
            exitHandler.current(next);
          }
        }
      }

      // What each ray points at: its line ends there, a marker grows, the path shows where one would stand.
      reticle.visible = false;
      for (const c of [...markers.children, ...doorMarkers.children]) c.scale.set(0.8, 0.4, 1);
      if (backButton) backButton.scale.setScalar(1);
      if (presenting) {
        for (const pad of pads) {
          if (!pad.line.visible) continue;
          rayFrom(pad.ctl);
          const hit = pick();
          pad.line.scale.z = hit ? hit.dist : 5;
          if (!hit) continue;
          if (hit.kind === "exit" || hit.kind === "door") hit.obj.scale.set(1.04, 0.52, 1);
          else if (hit.kind === "back" && backButton) backButton.scale.setScalar(1.15);
          else if (hit.kind === "path") {
            reticle.position.set(hit.at[0], hit.at[1] - 0.6, hit.at[2]);
            reticle.visible = true;
          }
        }
      }

      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      engine.current = null;
      renderer.setAnimationLoop(null);
      void renderer.xr.getSession()?.end().catch(() => {});
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
      meshes.forEach((m) => m.dispose());
      disposeLabel(loadingLabel);
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  // ── The tour: load it, start in its first scene ─────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    (async () => {
      baseRef.current = await splatBase();
      if (!baseRef.current) return setError("The splat scenes' address is not set on this host.");
      try {
        const res = await fetch("/api/splats/tour", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; tour?: unknown; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error || `The tour could not be read (HTTP ${res.status}).`);
        const t = parseTour(body.tour);
        if (!t.scenes.length) throw new Error("The tour has no scenes yet.");
        setTour(t);
        tourRef.current = t;
        const first = sceneById(t, params.get("scene") || "") ?? sceneById(t, t.start)!;
        await engine.current?.show(first.id, first.start);
        setCurrent(first.id);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  // Markers, paths and doors follow the scene here.
  const here = tour && current ? sceneById(tour, current) : null;
  useEffect(() => {
    engine.current?.setMarkers(here?.exits ?? []);
    if (!tour || !here) return engine.current?.setWorld([]);
    const members = here.place ? [here, ...tour.scenes.filter((s) => s.place && s.id !== here.id)] : [here];
    engine.current?.setWorld(members.map((s) => ({
      id: s.id,
      route: s.place ? s.route.map((p) => toWorld(s.place as Place, p)) : s.route,
      pace: s.pace,
      half: s.walls * (s.place?.scale ?? 1),
      doors: s.doors,
    })));
  }, [here, tour]);

  useEffect(() => {
    const d = tour?.drive ?? DEFAULT_DRIVE;
    engine.current?.setSpeed(d.speed, d.accel);
  }, [tour?.drive]);

  const backTo = trail.length && tour ? sceneById(tour, trail[trail.length - 1].scene) : null;
  useEffect(() => {
    engine.current?.setBack(backTo ? backTo.title.en : null);
  }, [backTo]);

  walkedInto.current = (id: string) => {
    setCurrent(id);
    window.history.replaceState(window.history.state, "", `?scene=${id}`);
  };

  async function take(exit: Exit) {
    const t = tourRef.current;
    const from = currentRef.current;
    if (!t || !from || !engine.current) return;
    const step = enter(t, trailRef.current, from, engine.current.pose(), exit);
    if (!step) return;
    try {
      await engine.current.show(step.scene, step.pose);
      setCurrent(step.scene);
      setTrail(step.trail);
      window.history.replaceState(window.history.state, "", `?scene=${step.scene}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  exitHandler.current = (e) => void take(e);

  async function back() {
    const step = leave(trailRef.current);
    if (!step || !engine.current) return;
    setTrail(step.trail);
    try {
      await engine.current.show(step.scene, step.pose);
      setCurrent(step.scene);
      window.history.replaceState(window.history.state, "", `?scene=${step.scene}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  backHandler.current = () => void back();

  async function enterVr() {
    try {
      await engine.current?.enterXr();
    } catch (e) {
      setError(`The headset did not start VR: ${(e as Error).message}`);
    }
  }

  return (
    <div className="fixed inset-0 bg-[#101014]">
      <div ref={host} className="absolute inset-0" />

      {here && !inXr && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/45 px-4 py-1.5 text-center text-[15px] text-white/90">
          {here.title.fa !== here.title.en ? `${here.title.fa} · ${here.title.en}` : here.title.en}
        </div>
      )}

      {loading != null && !inXr && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/85">
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-amber-300 transition-[width]" style={{ width: `${Math.round(loading * 100)}%` }} />
          </div>
          <div className="text-[13px]">در حال بارگذاری · Loading</div>
        </div>
      )}

      {!inXr && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {error && <div dir="ltr" className="max-w-md rounded-xl bg-rose-950/80 px-4 py-2 text-center text-[13px] text-rose-100">{error}</div>}
          {support === "vr" && (
            <button
              type="button"
              onClick={() => void enterVr()}
              disabled={!current}
              className="rounded-full bg-amber-300 px-8 py-4 text-[18px] font-bold text-black shadow-lg disabled:opacity-50"
            >
              ورود به واقعیت مجازی · Enter VR
            </button>
          )}
          {support === "none" && (
            <div className="max-w-md rounded-2xl bg-black/60 px-5 py-4 text-center text-[13px] leading-relaxed text-white/85">
              <div className="mb-1 font-bold text-white">این صفحه را در مرورگر هدست باز کنید · Open this page in your headset</div>
              <div dir="ltr">
                sarekooche.com/vr in Meta Quest Browser, Pico Browser, Safari on Apple Vision Pro, Wolvic — or Chrome / Edge on a PC with SteamVR
                or Windows Mixed Reality. Here: drag to look, click the blue path or a marker to go there.
              </div>
              <a href={`/vca/splat${current ? `?scene=${current}` : ""}`} className="mt-2 inline-block text-amber-200 underline">
                On a phone: walk it at /vca/splat
              </a>
            </div>
          )}
          {backTo && (
            <button type="button" onClick={() => void back()} className="rounded-full bg-black/55 px-4 py-2 text-[14px] text-white">
              ◀ {backTo.title.fa !== backTo.title.en ? `${backTo.title.fa} · ${backTo.title.en}` : backTo.title.en}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
