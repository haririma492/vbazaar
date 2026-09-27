import * as THREE from "three";
import {
  EYE_HEIGHT, FOOD_STREET_ENTRY, SQUARE_FROM_FOOD, gateFrontPose, nearestWalkable,
  planRoute, shopById, shopFrontPose, step, streetById, zoneOf,
  type Point, type Pose, type Zone,
} from "@/lib/virtualBazaar/layout";
import {
  headStep, clampPitch, clampZoom, easeInOutCubic, NECK_AT_REST, shortestAngleDelta, type Neck, flightSeconds, isTap, lerpAngle, lookFromDrag,
  pathLength, pointAlong, TAP_MAX_MOVE_PX, verticalFov,
} from "@/lib/virtualBazaar/motion";
import { buildBazaar, pickOf, type Pick } from "./buildBazaar";
import { redrawSignsWhenFontsLoad } from "./signs";
import { deviceQuaternion, headingOf, screenAngle } from "./deviceOrientation";

/**
 * THE VIRTUAL BAZAAR'S ENGINE — Three.js on one side, React on the other.
 *
 * It owns the renderer, the camera and every finger, mouse and key on the
 * canvas, and it speaks to the page only through `BazaarEvents`: what is
 * selected, which zone the visitor is in, and "open this shop". The page owns
 * everything a visitor reads — panels, buttons, routing — so the 2D Sarekooche
 * pages stay plain Next.js and never learn about the 3D.
 *
 *   tap a gate  → fly into its راسته (or to its closed door)
 *   tap a shop  → walk up to it; tap it again, or «ورود», to open it
 *   tap ground  → walk there
 *   drag        → look round (the view follows the finger) — unless the
 *                 phone's sensor is on, when turning the phone does it
 *   pinch/wheel → zoom
 *   W A S D / arrows → walk and turn
 *   phone motion → look round by turning the phone (the default on a phone)
 */

export type GyroState = "off" | "on" | "unavailable";

export type BazaarEvents = {
  onSelect: (pick: Pick | null) => void;
  onZone: (zone: Zone) => void;
  onOpenShop: (shopId: string) => void;
  onGyro: (state: GyroState) => void;
  onWebgl: (ok: boolean) => void;
};

type Flight = {
  points: Point[];
  total: number;
  duration: number;
  elapsed: number;
  fromYaw: number;
  toYaw: number;
  fromPitch: number;
  toPitch: number;
  /** A walk keeps the visitor's own look; a flight turns them to face its end. */
  keepLook: boolean;
};

type Press = { x: number; y: number; lastX: number; lastY: number; t: number; dragged: boolean };

const WALK_SPEED = 3.6; // m/s, keys
const TURN_SPEED = 1.8; // rad/s, keys
const TAP_WALK_SPEED = 4.5; // m/s, walking to a tapped point

const MOVE_KEYS: Record<string, "fwd" | "back" | "left" | "right" | "turnL" | "turnR"> = {
  // ⚠️ `code`, NOT `key`: the physical key, whatever the layout. On a Persian
  // keyboard W is «ص» and `key` would never be "w".
  KeyW: "fwd", ArrowUp: "fwd",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", KeyD: "right",
  ArrowLeft: "turnL", KeyQ: "turnL",
  ArrowRight: "turnR", KeyE: "turnR",
};

export class BazaarEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  private raycaster = new THREE.Raycaster();
  private pickables: THREE.Object3D[];
  private ground: THREE.Object3D[];
  private targets: THREE.Object3D[];

  private x: number;
  private z: number;
  private yaw: number;
  private pitch: number;
  private zoom = 1;
  private zone: Zone;
  private flight: Flight | null = null;
  private selected: Pick | null = null;

  private keys = new Set<string>();
  private presses = new Map<number, Press>();
  private pinch: { dist: number; zoom: number } | null = null;
  private hoverAt: { x: number; y: number } | null = null;

  private gyro = {
    on: false,
    heard: false,
    device: new THREE.Quaternion(),
    smoothed: new THREE.Quaternion(),
    /** The phone heading that means "straight ahead from the body" (`headStep`'s centre). */
    calibration: 0,
    /** Where the phone pointed when the sensor came on: the visitor at ease. */
    rest: 0,
    lastHeading: 0,
    neck: NECK_AT_REST as Neck,
    timer: 0 as ReturnType<typeof setTimeout> | 0,
  };

  private frame = 0;
  private last = 0;
  private dirty = true;
  private disposed = false;
  private reducedMotion: boolean;
  private resizeObserver: ResizeObserver;

  constructor(
    private container: HTMLElement,
    private events: BazaarEvents,
    start: Pose,
    { reducedMotion = false } = {},
  ) {
    this.reducedMotion = reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    // ⚠️ AT MOST 2× ON A PHONE'S 3× SCREEN: a third more pixels than 2× for a
    // difference nobody sees, paid for in heat and battery.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // Every gesture on the canvas is the bazaar's: no page scroll, no browser
    // pinch-zoom, no double-tap zoom.
    canvas.style.touchAction = "none";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);

    this.scene.background = new THREE.Color(0xcfe2ee);
    this.scene.fog = new THREE.Fog(0xcfe2ee, 45, 140);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a7355, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(12, 25, 8);
    this.scene.add(sun);

    const built = buildBazaar();
    this.scene.add(built.root);
    this.pickables = built.pickables;
    this.ground = built.ground;
    this.targets = [...this.pickables, ...this.ground];
    redrawSignsWhenFontsLoad(() => this.invalidate());

    this.x = start.x;
    this.z = start.z;
    this.yaw = start.yaw;
    this.pitch = start.pitch;
    this.zone = zoneOf(this.x, this.z);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    // ⚠️ THE CONTAINER'S SIZE, NOT THE WINDOW'S: a phone's address bar and a
    // rotation resize the box without always firing a window `resize`.
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(container);
    this.onResize();

    this.events.onZone(this.zone);
    this.frame = requestAnimationFrame(this.tick);
  }

  // -------------------------------------------------------------------------
  // What the page asks for

  /** Into an open راسته, or up to a closed one's door. */
  goToStreet(id: string) {
    const street = streetById(id);
    if (!street) return;
    this.select({ kind: "street", id });
    this.flyTo(street.open ? FOOD_STREET_ENTRY : gateFrontPose(street));
  }

  goToShop(id: string) {
    const shop = shopById(id);
    if (!shop) return;
    this.select({ kind: "shop", id });
    this.flyTo(shopFrontPose(shop));
  }

  goToSquare() {
    this.select(null);
    this.flyTo(SQUARE_FROM_FOOD);
  }

  clearSelection() {
    this.select(null);
  }

  /**
   * Look round by turning the phone. The page asks iOS for permission first
   * (it must, inside the tap); this only listens.
   */
  setGyro(on: boolean) {
    if (on === this.gyro.on) return;
    if (!on) {
      // Keep looking where the phone was pointing, so switching off is not a jump.
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
      this.yaw = e.y;
      this.pitch = clampPitch(e.x);
      this.stopGyro();
      this.events.onGyro("off");
      this.invalidate();
      return;
    }
    this.gyro.on = true;
    this.gyro.heard = false;
    window.addEventListener("deviceorientation", this.onDeviceOrientation);
    // ⚠️ A DESKTOP BROWSER HAS THE API AND NO SENSOR. It never fires, or
    // fires once with nulls; after a moment's silence we say so.
    this.gyro.timer = setTimeout(() => {
      if (!this.gyro.heard) {
        this.stopGyro();
        this.events.onGyro("unavailable");
      }
    }, 1500);
    this.events.onGyro("on");
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.stopGyro();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("wheel", this.onWheel);
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);

    // ⚠️ `renderer.dispose()` DOES NOT FREE WHAT THE SCENE HOLDS: every
    // geometry, material and sign texture stays on the GPU until freed by
    // hand, and leaving for a shop and coming back would stack them up.
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.geometry) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => {
        const map = (m as THREE.MeshBasicMaterial).map;
        map?.dispose();
        m.dispose();
      });
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // -------------------------------------------------------------------------
  // Moving

  private invalidate = () => {
    this.dirty = true;
  };

  private select(pick: Pick | null) {
    this.selected = pick;
    this.events.onSelect(pick);
  }

  private flyTo(pose: Pose) {
    // With the phone looking, face the body where the head is now and centre
    // the neck, so the flight turns the view from exactly here and arrives
    // facing the gate or shop with the phone held straight.
    if (this.gyro.on && this.gyro.heard) {
      const heading = headingOf(this.gyro.smoothed);
      this.yaw += shortestAngleDelta(this.gyro.calibration, heading);
      this.gyro.calibration = heading;
      // Bringing the phone back to rest afterwards keeps facing the arrival.
      this.gyro.neck = { ...NECK_AT_REST, returning: true };
    }
    const from = { x: this.x, z: this.z };
    const route = planRoute(from, pose);
    const points = [from, ...route];
    const total = pathLength(points);
    this.flight = {
      points,
      total,
      duration: flightSeconds(total, this.reducedMotion),
      elapsed: 0,
      fromYaw: this.yaw,
      toYaw: pose.yaw,
      fromPitch: this.pitch,
      toPitch: pose.pitch,
      keepLook: false,
    };
    this.invalidate();
  }

  private walkTo(target: Point) {
    const from = { x: this.x, z: this.z };
    const to = nearestWalkable(from, target);
    const points = [from, ...planRoute(from, to)];
    const total = pathLength(points);
    if (total < 0.2) return;
    this.flight = {
      points,
      total,
      duration: this.reducedMotion ? 0 : Math.max(0.4, total / TAP_WALK_SPEED),
      elapsed: 0,
      fromYaw: this.yaw,
      toYaw: this.yaw,
      fromPitch: this.pitch,
      toPitch: this.pitch,
      keepLook: true,
    };
    this.invalidate();
  }

  private advanceFlight(dt: number) {
    const f = this.flight!;
    f.elapsed += dt;
    const t = f.duration === 0 ? 1 : Math.min(1, f.elapsed / f.duration);
    const e = easeInOutCubic(t);
    const p = pointAlong(f.points, e * f.total);
    this.x = p.x;
    this.z = p.z;
    if (!f.keepLook) {
      this.yaw = lerpAngle(f.fromYaw, f.toYaw, e);
      this.pitch = f.fromPitch + (f.toPitch - f.fromPitch) * e;
    }
    if (t >= 1) this.flight = null;
  }

  /** Forward on the ground, from where the camera actually looks. */
  private heading(): number {
    return this.gyro.on && this.gyro.heard
      ? new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ").y
      : this.yaw;
  }

  private walkWithKeys(dt: number): boolean {
    let fwd = 0;
    let side = 0;
    let turn = 0;
    this.keys.forEach((code) => {
      const k = MOVE_KEYS[code];
      if (k === "fwd") fwd += 1;
      if (k === "back") fwd -= 1;
      if (k === "left") side += 1;
      if (k === "right") side -= 1;
      if (k === "turnL") turn += 1;
      if (k === "turnR") turn -= 1;
    });
    if (!fwd && !side && !turn) return false;
    this.yaw += turn * TURN_SPEED * dt;
    const h = this.heading();
    const dx = (-Math.sin(h) * fwd - Math.cos(h) * side) * WALK_SPEED * dt;
    const dz = (-Math.cos(h) * fwd + Math.sin(h) * side) * WALK_SPEED * dt;
    const next = step({ x: this.x, z: this.z }, { x: this.x + dx, z: this.z + dz });
    this.x = next.x;
    this.z = next.z;
    return true;
  }

  // -------------------------------------------------------------------------
  // The frame

  private tick = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;

    let moving = false;
    if (this.flight) {
      this.advanceFlight(dt);
      moving = true;
    }
    if (this.walkWithKeys(dt)) moving = true;
    if (this.gyro.on && this.gyro.heard) {
      this.followHead(dt);
      moving = true;
    }

    if (this.hoverAt) {
      const hit = this.hit(this.hoverAt.x, this.hoverAt.y);
      this.renderer.domElement.style.cursor = hit && pickOf(hit.object) ? "pointer" : "grab";
      this.hoverAt = null;
    }

    // ⚠️ DRAWN ONLY WHEN SOMETHING CHANGED. Standing still, the bazaar costs
    // a phone nothing but this check.
    if (!moving && !this.dirty) return;
    this.dirty = false;
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);

    const zone = zoneOf(this.x, this.z);
    if (zone !== this.zone) {
      this.zone = zone;
      this.events.onZone(zone);
    }
  };

  private applyCamera() {
    this.camera.position.set(this.x, EYE_HEIGHT, this.z);
    if (this.gyro.on && this.gyro.heard) {
      // The phone turns the view; a flight or a turn key turns the bazaar
      // under it (`yaw`), so arriving at a gate still faces the gate.
      const turn = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.yaw - this.gyro.calibration,
      );
      this.camera.quaternion.copy(turn).multiply(this.gyro.smoothed);
    } else {
      this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    }
    const fov = verticalFov(this.camera.aspect, this.zoom);
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** The phone's latest turn: the head looks, and the body turns when held (see `headStep`). */
  private followHead(dt: number) {
    const g = this.gyro;
    g.smoothed.slerp(g.device, 0.35);
    const heading = headingOf(g.smoothed);
    const turned = shortestAngleDelta(g.lastHeading, heading);
    g.lastHeading = heading;
    // A flight is steering the body already.
    if (this.flight && !this.flight.keepLook) return;
    const step = headStep(heading, turned, g.rest, g.calibration, dt, g.neck);
    g.neck = step.state;
    g.calibration = step.centre;
    g.rest = step.rest;
    this.yaw += step.bodyTurn;
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.camera.aspect, this.zoom);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.invalidate();
  };

  // -------------------------------------------------------------------------
  // Fingers, mouse, keys

  private hit(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(this.targets, true)[0] ?? null;
  }

  private onTap(clientX: number, clientY: number) {
    const hit = this.hit(clientX, clientY);
    if (!hit) return;
    const pick = pickOf(hit.object);
    if (!pick) {
      if (hit.object.userData.ground) this.walkTo({ x: hit.point.x, z: hit.point.z });
      return;
    }
    if (pick.kind === "shop") {
      const shop = shopById(pick.id)!;
      const front = shopFrontPose(shop);
      const here = Math.hypot(front.x - this.x, front.z - this.z) < 1.5;
      // Standing at the counter, a second tap goes in.
      if (here && this.selected?.kind === "shop" && this.selected.id === pick.id) {
        this.events.onOpenShop(pick.id);
        return;
      }
      this.goToShop(pick.id);
      return;
    }
    // A gate seen from inside its own street leads back out.
    const street = streetById(pick.id)!;
    if (street.open && this.zone === "food") {
      this.goToSquare();
      return;
    }
    this.goToStreet(pick.id);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
    this.presses.set(e.pointerId, {
      x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, t: performance.now(), dragged: false,
    });
    if (this.presses.size === 2) {
      const [a, b] = [...this.presses.values()];
      this.pinch = { dist: Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY), zoom: this.zoom };
      // Neither finger of a pinch is a tap.
      this.presses.forEach((p) => (p.dragged = true));
    }
    if (e.pointerType === "mouse") this.renderer.domElement.style.cursor = "grabbing";
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.presses.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") this.hoverAt = { x: e.clientX, y: e.clientY };
      return;
    }
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_MAX_MOVE_PX) p.dragged = true;

    if (this.pinch && this.presses.size >= 2) {
      const [a, b] = [...this.presses.values()];
      const dist = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
      if (this.pinch.dist > 0) this.zoom = clampZoom((this.pinch.zoom * dist) / this.pinch.dist);
      this.invalidate();
      return;
    }
    if (!p.dragged) return;
    // ⚠️ WITH THE PHONE'S SENSOR ON, THE PHONE LOOKS, NOT THE FINGER
    // (operator, 2026-09-27: "movement with the direction of mobile instead
    // of mouse or touch"). Two steering wheels on one view fight: the finger
    // turns it, the phone turns it back. A drag still counts as "not a tap".
    if (this.gyro.on) return;
    // Looking round mid-flight keeps the flight going but hands the view back.
    if (this.flight) this.flight.keepLook = true;
    const next = lookFromDrag(this.yaw, this.pitch, dx, dy);
    this.yaw = next.yaw;
    this.pitch = next.pitch;
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.presses.get(e.pointerId);
    this.presses.delete(e.pointerId);
    if (this.presses.size < 2) this.pinch = null;
    if (e.pointerType === "mouse") this.renderer.domElement.style.cursor = "grab";
    if (!p || p.dragged) return;
    if (isTap(Math.hypot(e.clientX - p.x, e.clientY - p.y), performance.now() - p.t)) {
      this.onTap(e.clientX, e.clientY);
    }
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.presses.delete(e.pointerId);
    if (this.presses.size < 2) this.pinch = null;
  };

  private onPointerLeave = () => {
    this.renderer.domElement.style.cursor = "grab";
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // A trackpad pinch arrives as a wheel with ctrl held, and moves in finer steps.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    this.zoom = clampZoom(this.zoom * Math.exp(-e.deltaY * k));
    this.invalidate();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!(e.code in MOVE_KEYS) || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    // Walking by hand ends any flight.
    this.flight = null;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** A key held while the window loses focus never sends its keyup. */
  private onBlur = () => {
    this.keys.clear();
    this.presses.clear();
    this.pinch = null;
  };

  // -------------------------------------------------------------------------
  // The phone's sensor

  private onDeviceOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    deviceQuaternion(this.gyro.device, e.alpha, e.beta, e.gamma, screenAngle());
    if (!this.gyro.heard) {
      this.gyro.heard = true;
      this.gyro.smoothed.copy(this.gyro.device);
      // ⚠️ CALIBRATED TO WHERE THE VISITOR WAS LOOKING, not to the compass: a
      // phone's alpha is north (or wherever it woke up), and switching the
      // sensor on must not spin the view to face it.
      this.gyro.calibration = headingOf(this.gyro.device);
      this.gyro.lastHeading = this.gyro.calibration;
      this.gyro.rest = this.gyro.calibration;
      this.gyro.neck = NECK_AT_REST;
    }
  };

  private stopGyro() {
    if (this.gyro.timer) clearTimeout(this.gyro.timer);
    this.gyro.timer = 0;
    this.gyro.on = false;
    this.gyro.heard = false;
    window.removeEventListener("deviceorientation", this.onDeviceOrientation);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.events.onWebgl(false);
  };

  private onContextRestored = () => {
    this.events.onWebgl(true);
    this.invalidate();
  };
}
