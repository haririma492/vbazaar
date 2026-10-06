import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SCENE_ID, productsFor, type Product } from "@/lib/chinastore/products";
import { CUES, KEYS, progressAt } from "@/lib/chinastore/storyboard";
import { CommerceLayer, type HoldState } from "./commerce/CommerceLayer";
import { buildStore, type Store } from "./store/buildStore";
import { glowTexture } from "./store/textures";

/**
 * THE CHINA STORE SIMULATOR'S ENGINE — wires the three layers together:
 *
 *   environment   ./store            (replaceable by a Gaussian splat)
 *   commerce      ./commerce          (anchors, labels, hand, basket)
 *   data          lib/chinastore      (catalogue ⨝ hotspots, the walk)
 *
 * and owns the renderer, the light, the lens and the shopper's camera in
 * its two modes: the scripted investor walk, and explore (walk and look
 * freely, tap a product to take it).
 */

export type Mode = "demo" | "explore";

export type EngineEvents = {
  onProgress?: (fraction: number) => void;
  onBasket?: (count: number, product: Product) => void;
  onHold?: (state: HoldState | null) => void;
  onFocus?: (product: Product | null) => void;
  /** A product's audio ad is due (pan: −1 left … 1 right). */
  onAd?: (product: Product, pan: number) => void;
  /** Scripted beats: the demo's tap on the teapot, its press of «Add to basket», its end. */
  onCue?: (cue: "tap" | "press-add" | "end", at?: { x: number; y: number }) => void;
  onDemoTime?: (t: number) => void;
  onWebgl?: (ok: boolean) => void;
};

const EYE = 1.62;
const WALK_SPEED = 1.35;

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.022 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      float v = smoothstep(0.82, 0.18, length(d) * 1.25);
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      // Film grain, a whisper: it is what keeps clean CG from reading as CG.
      float g = hash(vUv * vec2(1931.0, 1171.0) + fract(uTime * 7.13)) - 0.5;
      c.rgb += g * uGrain * (0.6 + 0.4 * (1.0 - c.rgb));
      gl_FragColor = c;
    }`,
};

export class ChinaStoreEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(48, 1, 0.03, 60);
  private composer!: EffectComposer;
  private finish!: ShaderPass;
  private gtao: GTAOPass | null = null;
  private store!: Store;
  private commerce!: CommerceLayer;
  private products = productsFor(SCENE_ID);
  private raf = 0;
  private clock = new THREE.Clock();
  private width = 1;
  private height = 1;
  private disposed = false;
  private ro: ResizeObserver | null = null;

  private mode: Mode = "demo";
  private playing = false;
  private demoT = 0;
  private cuesFired = new Set<string>();
  private eyeCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.eye)), false, "centripetal");
  private lookCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.look)), false, "centripetal");
  private lastEye = new THREE.Vector3();
  private stride = 0;

  // Explore.
  private yaw = 0;
  private pitch = -0.08;
  private keys = new Set<string>();
  private walkTo: { pos: THREE.Vector3; yaw?: number; pitch?: number } | null = null;
  private press: { x: number; y: number; lastX: number; lastY: number; moved: boolean; id: number } | null = null;
  private holding = false;

  private debugMarkers: THREE.Object3D[] = [];

  constructor(
    private container: HTMLElement,
    private overlay: HTMLElement,
    private events: EngineEvents,
    private opts: { dev?: boolean; quality?: "high" | "low" } = {},
  ) {}

  async init() {
    const low = this.opts.quality === "low";
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
    } catch {
      this.events.onWebgl?.(false);
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.25 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = "cs-canvas";
    this.container.prepend(r.domElement);
    this.events.onWebgl?.(true);

    this.scene.background = new THREE.Color(0x0b0a09);
    THREE.Cache.enabled = true;

    // Composer: MSAA in a half-float target, ambient occlusion where the china
    // meets the shelf, the faintest bloom on the LEDs and the gold, then the
    // tone map and a lens finish.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!low) {
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.18, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.composer.addPass(this.gtao);
    }
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.55, 0.95));
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);

    // Environment light: an interior HDR (Poly Haven, CC0), prefiltered.
    const pmrem = new THREE.PMREMGenerator(r);
    const progress = { env: 0, models: 0, total: 0, done: 0 };
    const report = () => this.events.onProgress?.(Math.min(1, (progress.env + progress.done) / (1 + progress.total)));
    const envP = new EXRLoader().loadAsync("/chinastore/env/lobby.exr").then((tex) => {
      const env = pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.55;
      this.scene.environmentRotation.set(0, 1.9, 0);
      progress.env = 1;
      report();
    });

    this.store = buildStore(r);
    this.scene.add(this.store.root);

    const loader = new GLTFLoader();
    this.commerce = new CommerceLayer(this.scene, this.camera, this.overlay, this.products, {
      onBasket: (n, p) => this.events.onBasket?.(n, p),
      onHold: (s) => {
        this.holding = !!s && s.phase === "holding";
        this.events.onHold?.(s);
      },
      onFocus: (p) => this.events.onFocus?.(p),
      onAd: (p, pan) => this.events.onAd?.(p, pan),
    }, { standIns: true, handUrl: "/models/china/hand.glb", glowTexture: glowTexture() });

    progress.total = this.products.length + 1;
    await Promise.all([
      envP,
      this.commerce.load(loader, (done) => {
        progress.done = done;
        report();
      }),
      this.store.dress(loader),
    ]);
    if (this.disposed) return;

    if (this.opts.dev) this.addDebugMarkers();
    this.attachInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
    this.resize();
    this.setDemoPose(0);
    // Compile every shader before the first visible frame (no hitch on entry).
    await r.compileAsync(this.scene, this.camera);
    this.clock.start();
    this.loop();
  }

  // ── modes ────────────────────────────────────────────────────────────

  startDemo() {
    this.mode = "demo";
    this.commerce.reset();
    this.commerce.setInteractive(false);
    this.demoT = 0;
    this.cuesFired.clear();
    this.walkTo = null;
    this.setDemoPose(0);
    this.playing = true;
  }

  /** The demo's opening frame, still — the title card sits over it. */
  showOpening() {
    this.mode = "demo";
    this.playing = false;
    this.commerce.setInteractive(false);
    this.setDemoPose(0);
  }

  explore() {
    this.mode = "explore";
    this.playing = false;
    this.commerce.setInteractive(true);
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = e.y;
    this.pitch = e.x;
  }

  getMode() {
    return this.mode;
  }

  addToBasket() {
    return this.commerce.addToBasket();
  }

  putBack() {
    this.commerce.putBack();
  }

  debug() {
    return this.commerce?.debug() ?? [];
  }

  // ── the scripted walk ────────────────────────────────────────────────

  private setDemoPose(t: number) {
    const u = progressAt(t);
    const eye = this.eyeCurve.getPoint(u);
    const look = this.lookCurve.getPoint(u);
    this.camera.position.copy(eye);
    this.camera.lookAt(look);
    this.lastEye.copy(eye);
  }

  private updateDemo(dt: number, now: number) {
    if (this.playing) this.demoT += dt;
    const t = this.demoT;
    const u = progressAt(t);
    const eye = this.eyeCurve.getPoint(u);
    const look = this.lookCurve.getPoint(u);
    // A walker's rhythm: a little rise and fall with each step, in proportion
    // to the speed, and the slow drift of a hand-held camera.
    const speed = dt > 0 ? eye.distanceTo(this.lastEye) / dt : 0;
    this.lastEye.copy(eye);
    this.stride += dt * 1.8 * Math.PI * 2 * Math.min(1, speed / 1.0);
    const bob = Math.min(1, speed / 1.2);
    eye.y += Math.sin(this.stride) * 0.006 * bob;
    eye.x += Math.sin(this.stride / 2) * 0.004 * bob;
    this.camera.position.copy(eye);
    const target = new THREE.Matrix4().lookAt(eye, look, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(target);
    const sway = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.sin(now * 0.53) * 0.0022 + Math.sin(now * 1.31) * 0.0009, Math.sin(now * 0.41) * 0.003, Math.sin(now * 0.37) * 0.0012, "YXZ"),
    );
    q.multiply(sway);
    // The head turns with a moment's lag behind the path, not locked to it.
    if (t < 0.05) this.camera.quaternion.copy(q);
    else this.camera.quaternion.slerp(q, 1 - Math.exp(-5 * dt));

    if (!this.playing) return;
    this.events.onDemoTime?.(t);
    const hero = this.products.find((p) => p.hero)!;
    if (t >= CUES.select && !this.cuesFired.has("select")) {
      this.cuesFired.add("select");
      const at = this.commerce.screenOf(hero.id, this.width, this.height) ?? undefined;
      this.events.onCue?.("tap", at);
      this.commerce.select(hero.id);
    }
    if (t >= CUES.addToBasket && !this.cuesFired.has("add")) {
      this.cuesFired.add("add");
      this.events.onCue?.("press-add");
    }
    if (t >= CUES.end && !this.cuesFired.has("end")) {
      this.cuesFired.add("end");
      this.playing = false;
      this.events.onCue?.("end");
    }
  }

  // ── explore ──────────────────────────────────────────────────────────

  private attachInput() {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
  }

  private onDown = (e: PointerEvent) => {
    if (this.mode !== "explore") return;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, id: e.pointerId };
  };

  private onMove = (e: PointerEvent) => {
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.moved = true;
    if (!p.moved) return;
    if (this.holding) {
      this.commerce.turnHeld(dx * 0.008, dy * 0.008);
      return;
    }
    // The view follows the finger, as if pulling the store round.
    this.yaw += dx * 0.0035;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0035, -1.1, 0.9);
    this.walkTo = null;
  };

  private onUp = (e: PointerEvent) => {
    const p = this.press;
    this.press = null;
    if (!p || p.moved || this.mode !== "explore" || this.holding) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const product = this.commerce.pick(ndc);
    if (product) {
      if (this.commerce.select(product.id)) return;
      // Too far to take: walk up to it.
      const a = new THREE.Vector3(product.anchor.x, product.anchor.y, product.anchor.z);
      const toward = new THREE.Vector3(this.camera.position.x - a.x, 0, this.camera.position.z - a.z).normalize();
      const stand = a.clone().addScaledVector(toward, 1.1);
      stand.y = EYE;
      const look = a.clone().sub(stand);
      this.walkTo = {
        pos: stand,
        yaw: Math.atan2(-look.x, -look.z),
        pitch: Math.atan2(look.y, Math.hypot(look.x, look.z)),
      };
      return;
    }
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.store.floor)[0];
    if (hit) this.walkTo = { pos: new THREE.Vector3(hit.point.x, EYE, hit.point.z) };
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.type === "keydown") this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  private updateExplore(dt: number) {
    const k = this.keys;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const side = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    const turn = (k.has("ArrowLeft") || k.has("KeyQ") ? 1 : 0) - (k.has("ArrowRight") || k.has("KeyE") ? 1 : 0);
    this.yaw += turn * dt * 1.6;
    const pos = this.camera.position;
    if (fwd || side) {
      this.walkTo = null;
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * side, 0, -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * side);
      if (dir.lengthSq() > 0) dir.normalize();
      pos.addScaledVector(dir, WALK_SPEED * dt);
    } else if (this.walkTo) {
      const d = this.walkTo.pos.clone().sub(pos);
      d.y = 0;
      const dist = d.length();
      const step = Math.min(dist, WALK_SPEED * dt * Math.min(1, dist * 2 + 0.3));
      if (dist > 0.01) pos.addScaledVector(d.normalize(), step);
      if (this.walkTo.yaw !== undefined) {
        let dy = this.walkTo.yaw - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * (1 - Math.exp(-4 * dt));
        this.pitch += (this.walkTo.pitch! - this.pitch) * (1 - Math.exp(-4 * dt));
      }
      if (dist < 0.02 && (this.walkTo.yaw === undefined || Math.abs(this.walkTo.yaw - this.yaw) < 0.01)) this.walkTo = null;
    }
    this.collide(pos);
    pos.y += (EYE - pos.y) * (1 - Math.exp(-8 * dt));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    this.camera.quaternion.slerp(q, 1 - Math.exp(-18 * dt));
  }

  private collide(p: THREE.Vector3) {
    const w = this.store.walk;
    p.x = THREE.MathUtils.clamp(p.x, w.minX, w.maxX);
    p.z = THREE.MathUtils.clamp(p.z, w.minZ, w.maxZ);
    for (const b of w.blocked) {
      if (p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1) {
        // Out by the nearest side.
        const out = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z];
        const i = out.indexOf(Math.min(...out));
        if (i === 0) p.x = b.x0;
        else if (i === 1) p.x = b.x1;
        else if (i === 2) p.z = b.z0;
        else p.z = b.z1;
      }
    }
  }

  // ── frame ────────────────────────────────────────────────────────────

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    // A phone held upright needs a wider lens to see the shelf.
    this.camera.fov = w / h < 0.8 ? 66 : w / h < 1.2 ? 56 : 46;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const now = this.clock.elapsedTime;
    if (this.mode === "demo") this.updateDemo(dt, now);
    else this.updateExplore(dt);
    this.camera.updateMatrixWorld();
    this.commerce.update(dt, this.width, this.height, now);
    this.finish.uniforms.uTime.value = now;
    this.composer.render(dt);
  };

  /** Stops the frame loop (screenshots on a software renderer draw frames by hand). */
  pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Draws one frame after advancing everything by dt seconds. */
  renderFrame(dt = 1 / 60) {
    if (this.mode === "demo") this.updateDemo(dt, this.demoT);
    else this.updateExplore(dt);
    this.camera.updateMatrixWorld();
    this.commerce.update(dt, this.width, this.height, this.demoT);
    this.composer.render(dt);
  }

  /** Advances the demo clock by hand (tests and screenshots without real time). */
  seekDemo(t: number) {
    this.mode = "demo";
    this.playing = true;
    const step = 1 / 60;
    while (this.demoT < t) {
      this.updateDemo(step, this.demoT);
      this.camera.updateMatrixWorld();
      this.commerce.update(step, this.width, this.height, this.demoT);
    }
  }

  private addDebugMarkers() {
    for (const p of this.products) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: p.hero ? 0xffc040 : 0x40c0ff, depthTest: false }));
      m.position.set(p.anchor.x, p.anchor.y, p.anchor.z);
      m.renderOrder = 10;
      this.scene.add(m);
      this.debugMarkers.push(m);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    this.commerce?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat.dispose();
      }
    });
    this.composer?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
