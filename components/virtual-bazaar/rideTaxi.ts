/**
 * The Virtual Ride's taxi, drawn by us on a transparent canvas: a modern
 * electric car — a fastback body traced from a side profile and rounded off,
 * a dark panoramic glass roof, full-width light bars, aero wheels, pearl
 * paint under a clear coat reflecting a studio environment — built from
 * Three.js shapes (no model file, no brand), «VCR · Virtual Shopping Ride» on
 * its doors and a slim lit «VCR TAXI» pod on the roof. Two cameras:
 *   - `street()`: Street View's (eye `STREET_EYE` up, level, 90° across), for
 *     pulling up at home and driving off at the destination
 *     (`lib/virtualRide/taxi.ts`);
 *   - `chase()`: the drive's, matching Map3DElement exactly (`RIDE.taxi`:
 *     height, distance behind, vertical field of view), with the car at the
 *     view's centre — which is the point on the road the 3D map looks at.
 */

import { RIDE } from "@/lib/virtualRide/flight";
import { STREET_EYE, TAXI, type TaxiFrame } from "@/lib/virtualRide/taxi";

export type TaxiPlayer = {
  street(): void;
  chase(): void;
  /** Draws one frame; `dt` seconds since the last (turns the wheels). */
  pose(f: TaxiFrame, dt: number): void;
  play(frameAt: (t: number) => TaxiFrame, durationMs: number): Promise<void>;
  dispose(): void;
};

/* ─── The car's measurements, metres (length along z, front at −z). ── */
const L = 4.72; // overall length
const HALF = L / 2;
const WHEELBASE = 2.88;
const AXLE = WHEELBASE / 2;
const R_WHEEL = TAXI.wheel; // 0.36
const ARCH = R_WHEEL + 0.06;
const BODY_W = 1.78; // before the rounded edges add 2 × BEVEL
const BEVEL = 0.07;
const TRACK = 0.8; // wheel centre from the middle, sideways

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  return c;
}

export async function createTaxi(container: HTMLElement): Promise<TaxiPlayer> {
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // A studio to reflect: what makes paint and glass look like paint and glass.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 9, 3);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.5));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
  let mode: "street" | "chase" = "street";
  const T = RIDE.taxi;

  const aim = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (mode === "street") {
      camera.fov = (2 * Math.atan(Math.tan(Math.PI / 4) / camera.aspect) * 180) / Math.PI; // 90° across
      camera.position.set(0, STREET_EYE, 0);
      camera.lookAt(0, STREET_EYE, -1);
    } else {
      camera.fov = T.fov;
      camera.position.set(0, T.height, 0);
      camera.lookAt(0, 0, -T.behind); // the car, at the centre of the view
    }
    camera.updateProjectionMatrix();
  };
  aim();
  window.addEventListener("resize", aim);

  // ── Materials (all fade together). ──
  const mats: any[] = [];
  const mat = <M,>(m: M): M => {
    (m as any).transparent = true;
    mats.push(m);
    return m;
  };
  const paint = mat(new THREE.MeshPhysicalMaterial({
    color: 0xf2f3f5, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1,
  }));
  const glass = mat(new THREE.MeshPhysicalMaterial({
    color: 0x0a0e13, metalness: 0.4, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6,
  }));
  const trim = mat(new THREE.MeshStandardMaterial({ color: 0x14171b, metalness: 0.3, roughness: 0.55 }));
  const tyreMat = mat(new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0, roughness: 0.9 }));
  const aero = mat(new THREE.MeshPhysicalMaterial({ color: 0x8c939c, metalness: 0.85, roughness: 0.3, clearcoat: 0.6 }));
  const ledWhite = mat(new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
  const ledRed = mat(new THREE.MeshBasicMaterial({ color: 0xff2a24 }));
  const accent = mat(new THREE.MeshStandardMaterial({ color: 0xf2a33a, metalness: 0.4, roughness: 0.35, emissive: 0x3a2200 }));

  const car = new THREE.Group();
  scene.add(car);
  const add = (geo: any, m: any, x = 0, y = 0, z = 0, parent: any = car) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  /** A side profile (x = along the car, front negative; y = up) extruded across `width`, edges rounded. */
  const sideways = (shape: any, width: number, bevel: number, segments = 5) => {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segments, curveSegments: 28,
    });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2); // profile x → car z (front −z); extrusion → across
    g.computeVertexNormals();
    return g;
  };

  // ── The body, below the windows: nose, hood, beltline, short tail; wheel arches cut in. ──
  const body = new THREE.Shape();
  const sill = 0.3;
  body.moveTo(-HALF + 0.1, sill);
  body.quadraticCurveTo(-HALF - 0.02, sill + 0.06, -HALF, 0.52); // front bumper
  body.quadraticCurveTo(-HALF + 0.02, 0.7, -HALF + 0.22, 0.74); // nose up to the hood
  body.bezierCurveTo(-1.75, 0.8, -1.3, 0.88, -1.05, 0.92); // short hood, rising to the cowl
  body.lineTo(1.75, 0.99); // beltline
  body.quadraticCurveTo(HALF - 0.05, 1.0, HALF, 0.9); // ducktail
  body.quadraticCurveTo(HALF + 0.03, 0.62, HALF - 0.04, 0.46); // tail
  body.quadraticCurveTo(HALF - 0.08, sill + 0.02, HALF - 0.2, sill); // rear bumper
  body.lineTo(AXLE + ARCH, sill);
  body.absarc(AXLE, R_WHEEL, ARCH, 0, Math.PI, false); // rear arch, over the wheel
  body.lineTo(-AXLE + ARCH, sill);
  body.absarc(-AXLE, R_WHEEL, ARCH, 0, Math.PI, false); // front arch
  body.lineTo(-HALF + 0.1, sill);
  add(sideways(body, BODY_W, BEVEL), paint);

  // ── The greenhouse: one sweep of dark glass, windscreen to fastback, narrower than the body. ──
  const roof = new THREE.Shape();
  roof.moveTo(-1.07, 0.89);
  roof.bezierCurveTo(-0.75, 1.12, -0.42, 1.38, -0.02, 1.43); // windscreen, raked well forward
  roof.bezierCurveTo(0.55, 1.47, 1.0, 1.4, 1.36, 1.25); // roof, arcing
  roof.quadraticCurveTo(1.75, 1.08, 2.05, 0.97); // long fastback
  roof.lineTo(-1.07, 0.89);
  add(sideways(roof, 1.32, 0.09, 6), glass);

  // Lower trim: sills, front intake, rear diffuser.
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.09, 2.0), trim, sx * (BODY_W / 2 + BEVEL - 0.005), 0.35, 0);
  add(new THREE.BoxGeometry(1.1, 0.07, 0.06), trim, 0, 0.42, -HALF - 0.02);
  add(new THREE.BoxGeometry(1.3, 0.1, 0.06), trim, 0, 0.36, HALF + 0.02);

  // Full-width light bars, and a thin amber line along each flank.
  // (The rounded edges stand BEVEL proud of the profile: the bars sit on that skin.)
  add(new THREE.BoxGeometry(1.5, 0.03, 0.06), ledWhite, 0, 0.6, -HALF - BEVEL + 0.03);
  add(new THREE.BoxGeometry(1.74, 0.045, 0.06), ledRed, 0, 0.86, HALF + BEVEL - 0.01);
  add(new THREE.BoxGeometry(1.2, 0.03, 0.06), trim, 0, 0.62, HALF + BEVEL - 0.005); // tailgate shadow line
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.01, 0.018, 3.4), accent, sx * (BODY_W / 2 + BEVEL + 0.003), 0.79, 0.05);

  // Camera wings for mirrors.
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.09, 0.035, 0.06), trim, sx * (BODY_W / 2 + BEVEL + 0.04), 1.0, -0.88);

  // The doors' label, flush on both flanks.
  const doorTex = new THREE.CanvasTexture(canvas(512, 160, (g) => {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#1c2026";
    g.font = "800 84px system-ui, sans-serif";
    g.fillText("VCR", 256, 62);
    g.fillStyle = "#c97a17";
    g.font = "600 28px system-ui, sans-serif";
    g.fillText("Virtual Shopping Ride", 256, 128);
  }));
  doorTex.colorSpace = THREE.SRGBColorSpace;
  doorTex.anisotropy = 4;
  const doorMat = mat(new THREE.MeshStandardMaterial({ map: doorTex, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
  for (const sx of [-1, 1]) {
    const door = add(new THREE.PlaneGeometry(1.05, 0.33), doorMat, sx * (BODY_W / 2 + BEVEL + 0.004), 0.58, -0.15);
    door.rotation.y = (sx * Math.PI) / 2;
  }

  // The roof pod, lit, «VCR TAXI» front and back.
  const podTex = new THREE.CanvasTexture(canvas(256, 64, (g) => {
    g.fillStyle = "#f7fbff";
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#14171b";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "800 38px system-ui, sans-serif";
    g.fillText("VCR TAXI", 128, 34);
  }));
  podTex.colorSpace = THREE.SRGBColorSpace;
  const podLit = mat(new THREE.MeshBasicMaterial({ map: podTex }));
  const podShape = new THREE.Shape();
  podShape.moveTo(-0.17, 0);
  podShape.quadraticCurveTo(-0.15, 0.1, 0, 0.11);
  podShape.quadraticCurveTo(0.15, 0.1, 0.17, 0);
  podShape.lineTo(-0.17, 0);
  add(sideways(podShape, 0.62, 0.02, 3), trim, 0, 1.47, 0.42);
  for (const [z, ry] of [[0.42 - 0.18, Math.PI], [0.42 + 0.18, 0]] as const) {
    const face = add(new THREE.PlaneGeometry(0.5, 0.075), podLit, 0, 1.515, z);
    face.rotation.y = ry;
  }

  // Wheels: tyre, an aero cover with five shallow blades; they turn.
  const wheels: any[] = [];
  for (const sx of [-TRACK, TRACK])
    for (const sz of [-AXLE, AXLE]) {
      const w = new THREE.Group();
      w.position.set(sx, R_WHEEL, sz);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R_WHEEL, R_WHEEL, 0.25, 36), tyreMat);
      tyre.rotation.z = Math.PI / 2;
      w.add(tyre);
      const out = Math.sign(sx);
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 36), aero);
      cover.rotation.z = Math.PI / 2;
      cover.position.x = out * 0.128;
      w.add(cover);
      for (let i = 0; i < 5; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.22, 0.05), trim);
        blade.position.set(out * 0.14, 0, 0);
        blade.rotation.x = (i / 5) * Math.PI * 2;
        blade.translateY(0.12);
        w.add(blade);
      }
      car.add(w);
      wheels.push(w);
    }

  // A soft contact shadow.
  const shadowTex = new THREE.CanvasTexture(canvas(128, 256, (g) => {
    const grad = g.createRadialGradient(64, 128, 10, 64, 128, 120);
    grad.addColorStop(0, "rgba(0,0,0,0.75)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 256);
  }));
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.6), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  car.add(shadow);

  let raf = 0;
  let disposed = false;
  let roll = 0;

  const pose = (f: TaxiFrame, dt: number) => {
    car.position.set(f.car.x, f.car.y, f.car.z);
    car.rotation.y = f.yaw;
    roll += (f.speed / R_WHEEL) * dt;
    for (const w of wheels) w.rotation.x = -roll;
    // A whisper of suspension while it moves.
    car.position.y += f.speed > 0.5 ? 0.006 * Math.sin(performance.now() / 90) : 0;
    for (const m of mats) m.opacity = f.opacity;
    shadowMat.opacity = f.opacity;
    renderer.render(scene, camera);
  };

  return {
    street() {
      mode = "street";
      aim();
    },
    chase() {
      mode = "chase";
      aim();
    },
    pose,
    play(frameAt, durationMs) {
      return new Promise((resolve) => {
        const t0 = performance.now();
        let last = t0;
        const step = (now: number) => {
          if (disposed) return resolve();
          const t = Math.min(durationMs, now - t0);
          pose(frameAt(t), (now - last) / 1000);
          last = now;
          if (t >= durationMs) return resolve();
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", aim);
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
