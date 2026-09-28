import * as THREE from "three";
import {
  EYE_HEIGHT, FOOD_STREET_ENTRY, SQUARE_FROM_FOOD, gateFrontPose, nearestWalkable,
  nextStop, planRoute, shopById, shopFrontPose, step, streetById, streetDirection, zoneOf,
  type Point, type Pose, type Zone,
} from "@/lib/virtualBazaar/layout";
import {
  ARROW_DIRS, ARROW_AHEAD_M, ARROW_STEP_M, arrowAheadFor, arrowSpot, arrowTarget, arrowYaw, type ArrowDir,
  ARROW_SIDESTEP_M, arrowLeads, bodyTurnRate, clampPitch, clampZoom, easeInOutCubic, easeTurnRate, headLook,
  recentreStep, shortestAngleDelta, flightSeconds, isTap, lerpAngle, lookFromDrag,
  pathLength, pointAlong, SQUARE_STEP_M, STEP_PRESS_S, STOP_GLIDE_SPEED, STROLL_SPEED, tapSlop,
  verticalFov, walkSpeed,
} from "@/lib/virtualBazaar/motion";
import { buildBazaar, pickOf, type Pick } from "./buildBazaar";
import { redrawSignsWhenFontsLoad, setSignLanguage } from "./signs";
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
  private billboards: THREE.Sprite[] = [];
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

  /** Keys held, with when each went down (ms). */
  private keys = new Map<string, number>();
  /**
   * WHERE A TAP WILL WALK YOU — Matterport's floor circle. Follows the mouse
   * over the floor on a desktop; on a phone it appears where the finger
   * landed and stays there until you arrive, so a tap is seen to be heard.
   */
  private marker: THREE.Mesh;
  /** Street View's arrows on the floor ahead (see `arrowSpot`). */
  private arrows = new Map<ArrowDir, THREE.Mesh>();
  private hoverArrow: ArrowDir | null = null;
  /** The body's turning speed from the phone, eased so it never jolts (rad/s). */
  private turnRate = 0;
  private markerFor: "hover" | "walk" | null = null;
  /** Shift held: walk fast. */
  private hurry = false;
  private presses = new Map<number, Press>();
  private pinch: { dist: number; zoom: number } | null = null;
  private hoverAt: { x: number; y: number } | null = null;

  private gyro = {
    on: false,
    heard: false,
    device: new THREE.Quaternion(),
    smoothed: new THREE.Quaternion(),
    /** The phone heading that means "straight ahead from the body". */
    calibration: 0,
    /** The phone, read as the head and the steering (see `followHead`). */
    heading: 0,
    pitch: 0,
    roll: 0,
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
    this.billboards = built.billboards;
    this.ground = built.ground;
    this.targets = [...this.pickables, ...this.ground];
    redrawSignsWhenFontsLoad(() => this.invalidate());
    this.marker = makeFloorMarker();
    this.scene.add(this.marker);
    ARROW_DIRS.forEach((dir) => {
      const arrow = makeArrow(dir);
      this.arrows.set(dir, arrow);
      this.scene.add(arrow);
    });
    // Arrows first: on top of the floor, a tap on one is the arrow's.
    this.targets = [...this.arrows.values(), ...this.targets];

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

  /**
   * One window-shopping step along the street: to the next pair of shops
   * deeper in (+1) or back towards the gate (−1). The phone's buttons.
   */
  stepAlongStreet(dir: 1 | -1) {
    if (this.zone !== "food") return;
    const x = nextStop(this.x, dir);
    if (x !== null) this.walkTo({ x, z: 0 }, STOP_GLIDE_SPEED);
  }

  goToSquare() {
    this.select(null);
    this.flyTo(SQUARE_FROM_FOOD);
  }

  /** Every sign in the bazaar in Persian or English. */
  setLanguage(lang: "fa" | "en") {
    setSignLanguage(lang);
    this.invalidate();
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
    // With the phone looking, face the body where the head is now, so the
    // flight turns the view from exactly here and arrives facing the gate or
    // shop with the phone held where it is.
    if (this.gyro.on && this.gyro.heard) {
      this.yaw = this.heading();
      this.gyro.calibration = this.gyro.heading;
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

  private walkTo(target: Point, speed = TAP_WALK_SPEED) {
    const from = { x: this.x, z: this.z };
    const to = nearestWalkable(from, target);
    const points = [from, ...planRoute(from, to)];
    const total = pathLength(points);
    if (total < 0.2) return;
    this.flight = {
      points,
      total,
      duration: this.reducedMotion ? 0 : Math.max(0.4, total / speed),
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
    return this.gyro.on && this.gyro.heard ? this.yaw + headLook(this.neck()) : this.yaw;
  }

  private walkWithKeys(dt: number, now: number): boolean {
    let fwd = 0;
    let side = 0;
    let turn = 0;
    let heldS = 0;
    this.keys.forEach((since, code) => {
      if (MOVE_KEYS[code] !== "turnL" && MOVE_KEYS[code] !== "turnR") heldS = Math.max(heldS, (now - since) / 1000);
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
    const v = walkSpeed(heldS, this.hurry) * dt;
    const dx = (-Math.sin(h) * fwd - Math.cos(h) * side) * v;
    const dz = (-Math.cos(h) * fwd + Math.sin(h) * side) * v;
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
    if (this.walkWithKeys(dt, now)) moving = true;
    if (this.gyro.on && this.gyro.heard) {
      this.followHead(dt);
      moving = true;
    }

    if (this.hoverAt) {
      const hit = this.hit(this.hoverAt.x, this.hoverAt.y);
      const onArrow = (hit?.object.userData.arrow as ArrowDir | undefined) ?? null;
      const onGround = !!hit && !onArrow && !pickOf(hit.object) && !!hit.object.userData.ground;
      this.renderer.domElement.style.cursor = hit && (onArrow || pickOf(hit.object)) ? "pointer" : "grab";
      if (onArrow !== this.hoverArrow) {
        this.hoverArrow = onArrow;
        this.invalidate();
      }
      if (this.markerFor !== "walk") {
        if (onGround) this.showMarker(hit!.point.x, hit!.point.z, "hover");
        else this.hideMarker();
      }
      this.hoverAt = null;
    }
    if (this.markerFor === "walk" && !this.flight) this.hideMarker();

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
    this.placeArrows();
    if (this.gyro.on && this.gyro.heard) {
      // The phone's heading: up to 10° a head turn, past it a body turn (see
      // `bodyTurnRate`). Its pitch looks up and down; its roll is not shown,
      // so the horizon stays level. A flight, a swipe or a turn key turns the
      // body too.
      this.camera.rotation.set(clampPitch(this.gyro.pitch), this.heading(), 0, "YXZ");
    } else {
      this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    }
    const fov = verticalFov(this.camera.aspect, this.zoom);
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** The phone's turn from the body. */
  private neck(): number {
    return shortestAngleDelta(this.gyro.calibration, this.gyro.heading);
  }

  /**
   * The phone, read as head and feet (see `bodyTurnRate`): turned within 10°
   * of the body it looks; past that the body turns that way, visibly and at
   * once, for as long as it is held there.
   */
  private followHead(dt: number) {
    const g = this.gyro;
    g.smoothed.slerp(g.device, 0.35);
    const e = new THREE.Euler().setFromQuaternion(g.smoothed, "YXZ");
    g.heading = e.y;
    g.pitch = e.x;
    g.roll = e.z;
    // A flight is steering the body already.
    if (this.flight && !this.flight.keepLook) {
      this.turnRate = 0;
      return;
    }
    this.turnRate = easeTurnRate(this.turnRate, bodyTurnRate(this.neck()), dt);
    this.yaw += this.turnRate * dt;
    // "Straight ahead" drifts to where the phone is held (see `recentreStep`);
    // the body turns under the head by as much, so nothing moves on screen.
    const d = recentreStep(this.neck(), dt);
    g.calibration += d;
    this.yaw += d;
  }

  private showMarker(x: number, z: number, why: "hover" | "walk") {
    const to = nearestWalkable({ x: this.x, z: this.z }, { x, z });
    this.marker.position.set(to.x, 0.03, to.z);
    (this.marker.material as THREE.MeshBasicMaterial).opacity = why === "walk" ? 0.95 : 0.6;
    this.marker.visible = true;
    this.markerFor = why;
    this.invalidate();
  }

  private hideMarker() {
    if (!this.marker.visible) return;
    this.marker.visible = false;
    this.markerFor = null;
    this.invalidate();
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.fov = verticalFov(this.camera.aspect, this.zoom);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    // The gates' floating names: a share of the screen's height, a little
    // smaller on a narrow screen so neighbours do not run into each other.
    const labelHeight = this.camera.aspect < 1 ? 0.05 : 0.06;
    this.billboards.forEach((b) => b.scale.set(labelHeight * b.userData.aspect, labelHeight, 1));
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
    // ⚠️ A HIDDEN ARROW IS NOT THERE. The raycaster tests every mesh, shown
    // or not; an arrow hidden because there is a wall that way must not be
    // tappable.
    return this.raycaster.intersectObjects(this.targets, true).find((h) => h.object.visible) ?? null;
  }

  private onTap(clientX: number, clientY: number) {
    const hit = this.hit(clientX, clientY);
    if (!hit) return;
    if (hit.object.userData.arrow) {
      this.arrowStep(hit.object.userData.arrow as ArrowDir);
      return;
    }
    const pick = pickOf(hit.object);
    if (!pick) {
      if (hit.object.userData.ground) {
        const to = nearestWalkable({ x: this.x, z: this.z }, { x: hit.point.x, z: hit.point.z });
        this.walkTo(to);
        if (this.flight) this.showMarker(to.x, to.z, "walk");
      }
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
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > tapSlop(e.pointerType)) p.dragged = true;

    if (this.pinch && this.presses.size >= 2) {
      const [a, b] = [...this.presses.values()];
      const dist = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
      if (this.pinch.dist > 0) this.zoom = clampZoom((this.pinch.zoom * dist) / this.pinch.dist);
      this.invalidate();
      return;
    }
    if (!p.dragged) return;
    // Looking round mid-flight keeps the flight going but hands the view back.
    if (this.flight) this.flight.keepLook = true;
    const next = lookFromDrag(this.yaw, this.pitch, dx, dy);
    // ⚠️ THE FINGER TURNS THE BODY EVEN WITH THE PHONE'S SENSOR ON — the
    // Street View / YouTube 360 "magic window": the phone is the head, a
    // swipe turns the body under it. (Switched off once, 2026-09-27, so the
    // two would not fight; they do not — the phone only ever sets the neck —
    // and a phone you cannot swipe felt broken.) Pitch stays the phone's.
    this.yaw = next.yaw;
    if (!this.gyro.on) this.pitch = next.pitch;
    this.invalidate();
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.presses.get(e.pointerId);
    this.presses.delete(e.pointerId);
    if (this.presses.size < 2) this.pinch = null;
    if (e.pointerType === "mouse") this.renderer.domElement.style.cursor = "grab";
    if (!p || p.dragged) return;
    if (isTap(Math.hypot(e.clientX - p.x, e.clientY - p.y), performance.now() - p.t, tapSlop(e.pointerType))) {
      this.onTap(e.clientX, e.clientY);
    }
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.presses.delete(e.pointerId);
    if (this.presses.size < 2) this.pinch = null;
  };

  private onPointerLeave = () => {
    this.renderer.domElement.style.cursor = "grab";
    if (this.markerFor === "hover") this.hideMarker();
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
    this.hurry = e.shiftKey;
    // A held key repeats; it went down once.
    if (e.repeat || this.keys.has(e.code)) return;
    // Walking by hand ends any flight.
    this.flight = null;
    this.keys.set(e.code, performance.now());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.hurry = e.shiftKey;
    const since = this.keys.get(e.code);
    this.keys.delete(e.code);
    if (since === undefined) return;
    const k = MOVE_KEYS[e.code];
    // ⚠️ A QUICK PRESS IS A STEP, NOT A WALK: in the street, to the next
    // pair of shops and no further; in the square, a pace. Held, the key
    // walks at a stroll.
    if ((k === "fwd" || k === "back") && (performance.now() - since) / 1000 < STEP_PRESS_S) {
      this.stepForward(k === "fwd");
    }
  };

  private stepForward(forward: boolean, squareStep = SQUARE_STEP_M) {
    if (this.zone === "food") {
      const x = nextStop(this.x, streetDirection(this.heading(), forward));
      if (x !== null) this.walkTo({ x, z: 0 }, STOP_GLIDE_SPEED);
      return;
    }
    const h = this.heading();
    const d = forward ? squareStep : -squareStep;
    this.walkTo({ x: this.x - Math.sin(h) * d, z: this.z - Math.cos(h) * d }, STROLL_SPEED);
  }

  /**
   * A tap on a floor arrow. Forward and back are window-shopping steps in the
   * street (the next pair of shops) and a few paces in the square; left and
   * right are a sidestep.
   */
  private arrowStep(dir: ArrowDir) {
    if (dir === "fwd" || dir === "back") {
      this.stepForward(dir === "fwd", ARROW_STEP_M);
      return;
    }
    this.walkTo(arrowTarget(dir, this.x, this.z, this.heading()), STROLL_SPEED);
  }

  /** Is there somewhere to go that way? An arrow that leads nowhere is hidden. */
  private arrowLeads(dir: ArrowDir): boolean {
    if (this.zone === "food" && (dir === "fwd" || dir === "back")) {
      return nextStop(this.x, streetDirection(this.heading(), dir === "fwd")) !== null;
    }
    const to = arrowTarget(dir, this.x, this.z, this.heading());
    const reach = nearestWalkable({ x: this.x, z: this.z }, to);
    const step = dir === "fwd" || dir === "back" ? ARROW_STEP_M : ARROW_SIDESTEP_M;
    return arrowLeads(Math.hypot(reach.x - this.x, reach.z - this.z), step);
  }

  /** Lays the four arrows on the floor ahead; hidden mid-flight and where they lead nowhere. */
  private placeArrows() {
    const h = this.heading();
    const flying = !!this.flight;
    const pitch = this.gyro.on && this.gyro.heard ? this.gyro.pitch : this.pitch;
    const ahead = arrowAheadFor(this.camera.fov, pitch, EYE_HEIGHT);
    // Further away, bigger, so they look the same size.
    const size = ahead / ARROW_AHEAD_M;
    this.arrows.forEach((arrow, dir) => {
      const spot = arrowSpot(dir, this.x, this.z, h, ahead);
      arrow.position.set(spot.x, 0.04, spot.z);
      arrow.scale.setScalar(size);
      // Laid flat (x), then turned to point its way (y), in that order.
      arrow.rotation.set(-Math.PI / 2, arrowYaw(dir, h), 0, "YXZ");
      arrow.visible = !flying && this.arrowLeads(dir);
      const lit = dir === this.hoverArrow;
      // Under the mouse: teal, and a little bigger.
      if (lit) arrow.scale.multiplyScalar(1.12);
      (arrow.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0x00b8c8 : 0xffffff);
    });
  }

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
      this.gyro.heading = this.gyro.calibration;
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

/** A flat ring with a dot, in the house colour, lying on the floor. */
function makeFloorMarker(): THREE.Mesh {
  const ring = new THREE.RingGeometry(0.32, 0.42, 40);
  const dot = new THREE.CircleGeometry(0.08, 20);
  const geometry = new THREE.BufferGeometry();
  // One mesh, one draw: merge the ring and the dot by hand.
  const merged = [ring, dot].map((g) => g.toNonIndexed());
  const positions = merged.flatMap((g) => Array.from(g.getAttribute("position").array as Float32Array));
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  ring.dispose();
  dot.dispose();
  merged.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x00b8c8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

/**
 * STREET VIEW'S ARROW, MADE TO BE TAPPED: a long chevron lying on the floor,
 * pointing along −z before it is turned. Three layers, flat on each other — a
 * soft dark shadow, a teal rim, a white face — so it reads as a button on the
 * pale paving, not a mark painted on it. Every layer answers a tap; the face
 * is the one that lights under the mouse.
 */
function makeArrow(dir: ArrowDir): THREE.Mesh {
  const s = new THREE.Shape();
  // Pointing "up" (+y) in shape space; laid flat it points forward. 1.2 m long.
  s.moveTo(0, 0.62);
  s.lineTo(0.5, 0.1);
  s.lineTo(0.22, 0.1);
  s.lineTo(0.22, -0.58);
  s.lineTo(-0.22, -0.58);
  s.lineTo(-0.22, 0.1);
  s.lineTo(-0.5, 0.1);
  s.closePath();
  const geometry = new THREE.ShapeGeometry(s);
  const layer = (color: number, opacity: number, scale: number, lift: number, dy = 0) => {
    const m = new THREE.Mesh(
      geometry,
      // ⚠️ DRAWN OVER EVERYTHING, like Street View's: from the square's west
      // side the pool stands between you and the floor ahead, and an arrow
      // behind it could not be seen or tapped.
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    );
    m.scale.setScalar(scale);
    m.position.set(0, dy, lift);
    m.userData.arrow = dir;
    return m;
  };
  const face = layer(0xffffff, 0.95, 1, 0.004);
  face.renderOrder = 5;
  const rim = layer(0x00b8c8, 0.95, 1.16, 0.002, -0.015);
  rim.renderOrder = 4;
  const shadow = layer(0x06131c, 0.28, 1.22, 0, -0.07);
  shadow.renderOrder = 3;
  // The face is the arrow; the rim and shadow ride on it.
  face.add(rim, shadow);
  rim.position.z -= face.position.z;
  shadow.position.z -= face.position.z;
  return face;
}
