import * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Product } from "@/lib/chinastore/products";
import { formatPrice, priceNow } from "@/lib/chinastore/products";
import { FADE_RATE, adStep, damp, labelState, viewOpacity } from "@/lib/chinastore/proximity";

/**
 * THE COMMERCE LAYER — what turns a 3D place into a shop.
 *
 * It needs only a THREE.Scene, the shopper's camera, an HTML overlay and the
 * joined product records (catalogue ⨝ hotspots). It does not know what the
 * store is made of: today a modelled boutique (../store), tomorrow a Gaussian
 * splat. Everything a shopper does with a product lives here:
 *
 *   anchors → proximity → labels that fade in and out
 *   the product within reach → a highlight
 *   select → the hand reaches, takes it, brings it close (drag turns it)
 *   «Add to basket» → the basket counts it
 *
 * `standIns: true` stands each product's GLB at its display pose (the
 * simulator). Over a splat it is false: the shelf is the capture's, and a
 * GLB appears only when the shopper takes the product.
 */

export type HoldState = { product: Product; phase: "reaching" | "holding" | "returning" | "basket" };

export type CommerceEvents = {
  onBasket?: (count: number, product: Product) => void;
  onHold?: (state: HoldState | null) => void;
  /** The product a tap would take now (nearest selectable in view), or null. */
  onFocus?: (product: Product | null) => void;
  /**
   * A product's audio ad is due: the shopper has come near it. `pan` is
   * where it is across the view, −1 (left) … 1 (right), for the sound.
   */
  onAd?: (product: Product, pan: number) => void;
};

type Runtime = {
  p: Product;
  /** The product's model, as shown on the shelf (null until loaded / over a splat). */
  shelf: THREE.Object3D | null;
  /** Home transform of the shelf model. */
  home: { pos: THREE.Vector3; quat: THREE.Quaternion };
  anchor: THREE.Vector3;
  el: HTMLElement;
  opacity: number;
  materials: THREE.MeshPhysicalMaterial[];
  glow: number;
  /** The ad's latch: ready to speak on the next approach. */
  adArmed: boolean;
  /** The model's bounding radius (m): a ring is held closer than a teapot. */
  radius: number;
};

type Pose = { pos: THREE.Vector3; quat: THREE.Quaternion };

const HOLD_OFFSET = new THREE.Vector3(-0.06, -0.07, -0.66);
const HAND_START = new THREE.Vector3(0.38, -0.55, -0.2);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class CommerceLayer {
  private items: Runtime[] = [];
  private basket = 0;
  private hand: THREE.Group | null = null;
  private handGrip = new THREE.Vector3();
  private glowLight: THREE.PointLight;
  private halo: THREE.Mesh;
  private focus: Runtime | null = null;
  private interactive = true;
  /** A product being taken, held, or put back. */
  private held: {
    r: Runtime;
    model: THREE.Object3D;
    phase: HoldState["phase"];
    t: number;
    from: Pose;
    handFrom: Pose;
    spin: THREE.Quaternion;
    autoSpin: boolean;
  } | null = null;
  private tmp = { v: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), fwd: new THREE.Vector3() };

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private overlay: HTMLElement,
    private products: Product[],
    private events: CommerceEvents = {},
    private opts: { standIns: boolean; handUrl?: string; glowTexture?: THREE.Texture } = { standIns: true },
  ) {
    this.glowLight = new THREE.PointLight(new THREE.Color(1, 0.93, 0.82), 0, 0.9, 2);
    scene.add(this.glowLight);
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: opts.glowTexture ?? null, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.halo.renderOrder = 2;
    scene.add(this.halo);
  }

  // ── loading ──────────────────────────────────────────────────────────

  async load(loader: GLTFLoader, onProgress?: (done: number, total: number) => void) {
    const total = this.products.length + (this.opts.handUrl ? 1 : 0);
    let done = 0;
    const tick = () => onProgress?.(++done, total);
    const jobs = this.products.map(async (p) => {
      let shelf: THREE.Object3D | null = null;
      const materials: THREE.MeshPhysicalMaterial[] = [];
      const home: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
      const d = p.display;
      if (d) {
        home.pos.set(d.position.x, d.position.y, d.position.z);
        home.quat.setFromEuler(new THREE.Euler(d.tilt ?? 0, d.yaw ?? 0, 0, "YXZ"));
      }
      let radius = 0.15;
      if (this.opts.standIns) {
        shelf = (await loader.loadAsync(p.modelUrl)).scene.clone(true);
        radius = new THREE.Box3().setFromObject(shelf).getBoundingSphere(new THREE.Sphere()).radius * (d?.scale ?? 1);
        shelf.name = `product:${p.id}`;
        shelf.position.copy(home.pos);
        shelf.quaternion.copy(home.quat);
        if (d?.scale) shelf.scale.setScalar(d.scale);
        shelf.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = m.receiveShadow = true;
          m.userData.productId = p.id;
          // Own copies of the materials, so a highlight touches only this product.
          const mat = (m.material as THREE.MeshPhysicalMaterial).clone();
          m.material = mat;
          materials.push(mat);
        });
        this.scene.add(shelf);
      }
      tick();
      this.items.push({
        p, shelf, home, materials, glow: 0, adArmed: true, radius,
        anchor: new THREE.Vector3(p.anchor.x, p.anchor.y, p.anchor.z),
        el: this.makeLabel(p),
        opacity: 0,
      });
    });
    if (this.opts.handUrl) {
      jobs.push(
        (async () => {
          const gltf = await loader.loadAsync(this.opts.handUrl!);
          const grip = gltf.scene.getObjectByName("grip");
          if (grip) this.handGrip.copy(grip.position);
          const g = new THREE.Group();
          g.name = "shopper-hand";
          const inner = gltf.scene;
          inner.position.copy(this.handGrip).negate();
          inner.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.castShadow = m.receiveShadow = true;
          });
          g.add(inner);
          g.visible = false;
          this.hand = g;
          this.scene.add(g);
          tick();
        })(),
      );
    }
    await Promise.all(jobs);
    // Keep the catalogue's order (labels stack predictably).
    this.items.sort((a, b) => this.products.indexOf(a.p) - this.products.indexOf(b.p));
  }

  // ── labels ───────────────────────────────────────────────────────────

  private makeLabel(p: Product): HTMLElement {
    const el = document.createElement("div");
    const onSale = priceNow(p) < p.price;
    el.className = `cs-label ${p.labelSide === "below" ? "cs-below" : "cs-above"}${p.hero ? " cs-hero" : ""}${onSale ? " cs-sale" : ""}`;
    el.innerHTML = `
      <span class="cs-dot"></span>
      <span class="cs-leader"></span>
      <span class="cs-card">
        <span class="cs-badge">Sale</span>
        <span class="cs-name"></span>
        <span class="cs-sku"></span>
        <span class="cs-price"><s class="cs-was"></s><span class="cs-now"></span></span>
        <span class="cs-hint">Tap to pick up</span>
      </span>`;
    el.querySelector(".cs-name")!.textContent = p.name;
    el.querySelector(".cs-sku")!.textContent = p.sku;
    el.querySelector(".cs-now")!.textContent = formatPrice(priceNow(p));
    if (onSale) el.querySelector(".cs-was")!.textContent = formatPrice(p.price);
    el.style.opacity = "0";
    el.style.visibility = "hidden";
    this.overlay.appendChild(el);
    return el;
  }

  /** Whether tap hints show (the scripted demo hides them). */
  setInteractive(on: boolean) {
    this.interactive = on;
    this.overlay.classList.toggle("cs-scripted", !on);
  }

  // ── per frame ────────────────────────────────────────────────────────

  update(dt: number, width: number, height: number, now: number) {
    const cam = this.camera;
    const eye = cam.position;
    const fwd = cam.getWorldDirection(this.tmp.fwd);
    let best: Runtime | null = null;
    let bestScore = Infinity;
    for (const r of this.items) {
      const s = labelState(eye, fwd, r.p);
      const isHeld = this.held?.r === r;
      // While a product is in hand, the other labels step back.
      const target = this.held ? 0 : s.target;
      r.opacity = damp(r.opacity, target, FADE_RATE, dt);
      if (s.selectable && !isHeld && !this.held) {
        // The one a tap takes: nearest the centre of view, the hero first.
        const v = this.tmp.v.copy(r.anchor).project(cam);
        const score = Math.hypot(v.x, v.y) - (r.p.hero ? 0.25 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = r;
        }
      }
      this.placeLabel(r, s.distance, width, height);
      if (r.p.ad && r.p.adDistance) this.checkAd(r, s.distance, fwd);
    }
    if (best !== this.focus) {
      this.focus?.el.classList.remove("cs-focus");
      best?.el.classList.add("cs-focus");
      this.focus = best;
      this.events.onFocus?.(best?.p ?? null);
    }
    this.updateHighlight(dt, now);
    this.updateHeld(dt);
  }

  /** The audio ad: once per approach; while it speaks, its tag rises with «Sale». */
  private checkAd(r: Runtime, distance: number, fwd: THREE.Vector3) {
    const view = viewOpacity(this.camera.position, fwd, r.anchor);
    const step = adStep(r.adArmed, distance, view, r.p.adDistance!);
    if (step.armed && !r.adArmed) r.el.classList.remove("cs-live");
    r.adArmed = step.armed;
    if (!step.fire || this.held) return;
    r.el.classList.add("cs-live");
    const v = this.tmp.v.copy(r.anchor).project(this.camera);
    this.events.onAd?.(r.p, Math.max(-1, Math.min(1, v.x)));
  }

  private placeLabel(r: Runtime, distance: number, width: number, height: number) {
    const o = r.opacity;
    if (o < 0.004) {
      if (r.el.style.visibility !== "hidden") r.el.style.visibility = "hidden";
      return;
    }
    const v = this.tmp.v.copy(r.anchor).project(this.camera);
    if (v.z > 1) {
      r.el.style.visibility = "hidden";
      return;
    }
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-v.y * 0.5 + 0.5) * height;
    // Nearer labels are a touch larger — they belong to the space, not the screen.
    const scale = Math.min(1.0, Math.max(0.78, 1.7 / Math.max(distance, 0.5)));
    r.el.style.visibility = "visible";
    r.el.style.opacity = o.toFixed(3);
    r.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    // Leader grows as the label settles in.
    r.el.style.setProperty("--grow", o.toFixed(3));
  }

  private updateHighlight(dt: number, now: number) {
    let lit: Runtime | null = null;
    for (const r of this.items) {
      const on = r === this.focus && !this.held ? 1 : 0;
      r.glow = damp(r.glow, on, 4, dt);
      if (r.glow > 0.01) lit = r;
      // A breath of warmth in the glaze, not a game outline.
      const pulse = 0.75 + 0.25 * Math.sin(now * 2.4);
      for (const m of r.materials) {
        m.emissive.setRGB(1, 0.93, 0.8);
        m.emissiveIntensity = 0.045 * r.glow * pulse;
      }
    }
    const target = lit ?? null;
    const g = target?.glow ?? 0;
    if (target) {
      this.glowLight.position.set(target.anchor.x + 0.12, target.anchor.y + 0.18, target.anchor.z + 0.35);
      const base = target.home.pos;
      this.halo.position.set(base.x, base.y + 0.002, base.z);
      const size = 0.42;
      this.halo.scale.set(size, 1, size * 0.8);
    }
    this.glowLight.intensity = 0.5 * g;
    (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.32 * g;
    this.halo.visible = g > 0.01 && !!target?.shelf && !target.p.display?.tilt;
  }

  // ── picking & selecting ──────────────────────────────────────────────

  /** The product under a screen point (NDC), by its model or, over a splat, its anchor. */
  pick(ndc: THREE.Vector2): Product | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const models = this.items.map((r) => r.shelf).filter((o): o is THREE.Object3D => !!o);
    const hit = ray.intersectObjects(models, true)[0];
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.productId) o = o.parent;
      const id = o?.userData.productId;
      if (id) return this.items.find((r) => r.p.id === id)?.p ?? null;
    }
    // No model hit: the nearest anchor within a finger's width on screen.
    let best: Product | null = null;
    let bestD = 0.09;
    for (const r of this.items) {
      const v = this.tmp.v.copy(r.anchor).project(this.camera);
      if (v.z > 1) continue;
      const d = Math.hypot(v.x - ndc.x, v.y - ndc.y);
      if (d < bestD) {
        bestD = d;
        best = r.p;
      }
    }
    return best;
  }

  /** The product a tap would take now. */
  focused(): Product | null {
    return this.focus?.p ?? null;
  }

  /** Takes a product, if the shopper is close enough. Returns whether it did. */
  select(id: string): boolean {
    if (this.held) return false;
    const r = this.items.find((x) => x.p.id === id);
    if (!r) return false;
    const fwd = this.camera.getWorldDirection(this.tmp.fwd);
    if (!labelState(this.camera.position, fwd, r.p).selectable) return false;
    let model = r.shelf;
    if (!model) return false; // over a splat the GLB would be loaded here
    // The model leaves the shelf: it is the product now, held in the scene.
    const from: Pose = { pos: model.position.clone(), quat: model.quaternion.clone() };
    const handFrom = this.cameraPose(HAND_START, new THREE.Quaternion());
    if (this.hand && r.p.grasp) {
      // Start the hand already turned roughly as it will grip, a little rolled.
      const g = this.graspPose(r, from);
      handFrom.quat.copy(g.quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, -0.5)));
      this.hand.position.copy(handFrom.pos);
      this.hand.quaternion.copy(handFrom.quat);
      this.hand.visible = true;
    }
    this.held = { r, model, phase: "reaching", t: 0, from, handFrom, spin: new THREE.Quaternion(), autoSpin: !this.interactive };
    this.events.onHold?.({ product: r.p, phase: "reaching" });
    return true;
  }

  /** Turns the held product (drag), radians about the view's up and right. */
  turnHeld(dx: number, dy: number) {
    if (!this.held || this.held.phase !== "holding") return;
    this.held.autoSpin = false;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy, dx, 0, "YXZ"));
    this.held.spin.premultiply(q);
  }

  /** Puts the held product back on its shelf. */
  putBack() {
    if (!this.held || this.held.phase !== "holding") return;
    this.held.phase = "returning";
    this.held.t = 0;
    this.held.from = { pos: this.held.model.position.clone(), quat: this.held.model.quaternion.clone() };
    this.events.onHold?.({ product: this.held.r.p, phase: "returning" });
  }

  /** «Add to basket»: the held product goes in, the basket counts it. */
  addToBasket(): boolean {
    if (!this.held || this.held.phase !== "holding") return false;
    this.basket++;
    this.events.onBasket?.(this.basket, this.held.r.p);
    this.held.phase = "basket";
    this.held.t = 0;
    this.held.from = { pos: this.held.model.position.clone(), quat: this.held.model.quaternion.clone() };
    this.events.onHold?.({ product: this.held.r.p, phase: "basket" });
    return true;
  }

  basketCount() {
    return this.basket;
  }

  /** Back to the opening state: everything on its shelf, an empty basket. */
  reset() {
    if (this.held) {
      const m = this.held.model;
      m.position.copy(this.held.r.home.pos);
      m.quaternion.copy(this.held.r.home.quat);
      m.scale.setScalar(this.held.r.p.display?.scale ?? 1);
      m.visible = true;
      this.held = null;
    }
    if (this.hand) this.hand.visible = false;
    this.basket = 0;
    for (const r of this.items) {
      r.opacity = 0;
      r.glow = 0;
      r.adArmed = true;
      r.el.classList.remove("cs-live");
      r.el.style.visibility = "hidden";
    }
    this.events.onHold?.(null);
  }

  // ── the hand and the held product ────────────────────────────────────

  /** A pose fixed to the camera: offset in camera space, rotation after the camera's. */
  private cameraPose(offset: THREE.Vector3, rot: THREE.Quaternion): Pose {
    const cam = this.camera;
    cam.updateMatrixWorld();
    return {
      pos: offset.clone().applyMatrix4(cam.matrixWorld),
      quat: cam.quaternion.clone().multiply(rot),
    };
  }

  /** Where the hand must be to hold product r at pose `at`. */
  private graspPose(r: Runtime, at: Pose): Pose {
    const g = r.p.grasp!;
    const quat = at.quat.clone().multiply(new THREE.Quaternion(...g.quaternion));
    const pos = new THREE.Vector3(...g.point).applyQuaternion(at.quat).add(at.pos);
    return { pos, quat };
  }

  /** The held pose: in front of the shopper, a three-quarter turn, plus their spin. */
  private holdPose(r: Runtime): Pose {
    const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, r.p.grasp ? -0.42 : 0.35, 0, "YXZ"));
    // Held at a distance that suits its size: a teapot at arm's length, a
    // ring close enough to see the stone.
    const dist = THREE.MathUtils.clamp(r.radius * 4.2, 0.2, -HOLD_OFFSET.z);
    const k = dist / -HOLD_OFFSET.z;
    const pose = this.cameraPose(new THREE.Vector3(HOLD_OFFSET.x * k, HOLD_OFFSET.y * k, -dist), view.premultiply(this.held!.spin));
    // Hold by the hand's grip, not the model's base: centre the product's mass in view.
    const lift = new THREE.Vector3(0, -(r.anchor.y - r.home.pos.y), 0).applyQuaternion(pose.quat);
    pose.pos.add(lift);
    return pose;
  }

  private updateHeld(dt: number) {
    const h = this.held;
    if (!h) return;
    h.t += dt;
    const m = h.model;
    const r = h.r;
    const hand = this.hand && r.p.grasp ? this.hand : null;
    const setHandTo = (at: Pose) => {
      if (!hand) return;
      const g = this.graspPose(r, at);
      hand.position.copy(g.pos);
      hand.quaternion.copy(g.quat);
    };
    const REACH = hand ? 0.95 : 0;
    const LIFT = 0.4;
    const BRING = 1.05;

    if (h.phase === "reaching") {
      if (hand && h.t < REACH) {
        // The hand travels in a slight arc to the handle.
        const k = ease(clamp01(h.t / REACH));
        const g = this.graspPose(r, h.from);
        hand.position.lerpVectors(h.handFrom.pos, g.pos, k);
        hand.position.y += Math.sin(k * Math.PI) * 0.06;
        hand.quaternion.slerpQuaternions(h.handFrom.quat, g.quat, k);
        return;
      }
      const t = h.t - REACH;
      if (t < LIFT) {
        // Off the shelf: up and a little toward the shopper.
        const k = ease(clamp01(t / LIFT));
        m.position.copy(h.from.pos).add(this.tmp.v.set(0, 0.06 * k, 0.05 * k));
        m.quaternion.copy(h.from.quat);
        setHandTo({ pos: m.position, quat: m.quaternion });
        return;
      }
      const k = ease(clamp01((t - LIFT) / BRING));
      const lifted = { pos: h.from.pos.clone().add(new THREE.Vector3(0, 0.06, 0.05)), quat: h.from.quat };
      const target = this.holdPose(r);
      m.position.lerpVectors(lifted.pos, target.pos, k);
      m.quaternion.slerpQuaternions(lifted.quat, target.quat, k);
      setHandTo({ pos: m.position, quat: m.quaternion });
      if (k >= 1) {
        h.phase = "holding";
        h.t = 0;
        this.events.onHold?.({ product: r.p, phase: "holding" });
      }
      return;
    }
    if (h.phase === "holding") {
      if (h.autoSpin) h.spin.premultiply(this.tmp.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.16));
      const target = this.holdPose(r);
      // Follow the shopper's head with a little lag, as a held object does.
      m.position.lerp(target.pos, 1 - Math.exp(-14 * dt));
      m.quaternion.slerp(target.quat, 1 - Math.exp(-10 * dt));
      setHandTo({ pos: m.position, quat: m.quaternion });
      return;
    }
    if (h.phase === "returning") {
      const k = ease(clamp01(h.t / 1.0));
      m.position.lerpVectors(h.from.pos, r.home.pos, k);
      m.quaternion.slerpQuaternions(h.from.quat, r.home.quat, k);
      setHandTo({ pos: m.position, quat: m.quaternion });
      if (k >= 1) this.release();
      return;
    }
    if (h.phase === "basket") {
      // Into the basket: down and away to the corner the basket sits in,
      // shrinking; the hand lets go and drops out of view.
      const k = ease(clamp01(h.t / 0.85));
      const corner = this.cameraPose(new THREE.Vector3(0.34, 0.24, -0.62), new THREE.Quaternion());
      m.position.lerpVectors(h.from.pos, corner.pos, k);
      m.scale.setScalar((r.p.display?.scale ?? 1) * (1 - 0.9 * k));
      if (hand) {
        const away = this.cameraPose(HAND_START, new THREE.Quaternion());
        hand.position.lerp(away.pos, 1 - Math.exp(-6 * dt));
      }
      if (k >= 1) {
        // The shelf is restocked: the same model fades back to its place.
        m.visible = false;
        m.scale.setScalar(r.p.display?.scale ?? 1);
        m.position.copy(r.home.pos);
        m.quaternion.copy(r.home.quat);
        this.release();
        setTimeout(() => (m.visible = true), 900);
      }
    }
  }

  private release() {
    const h = this.held;
    this.held = null;
    if (this.hand) this.hand.visible = false;
    if (h) this.events.onHold?.(null);
  }

  /** Screen position (px) of a product's anchor — for the demo's tap ripple. */
  screenOf(id: string, width: number, height: number): { x: number; y: number } | null {
    const r = this.items.find((x) => x.p.id === id);
    if (!r) return null;
    const v = this.tmp.v.copy(r.anchor).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }

  /** Development readout: each product's distance and label opacity. */
  debug(): { id: string; distance: number; opacity: number }[] {
    return this.items.map((r) => ({ id: r.p.id, distance: r.anchor.distanceTo(this.camera.position), opacity: r.opacity }));
  }

  dispose() {
    for (const r of this.items) r.el.remove();
    this.items = [];
  }
}
