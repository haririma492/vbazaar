/**
 * The Virtual Ride's taxi, drawn by us on a transparent canvas: a yellow cab
 * built from Three.js shapes (no model file), «TAXI» on the roof and «VCR ·
 * Virtual Shopping Ride» on its doors. Two cameras:
 *   - `street()`: Street View's (eye `STREET_EYE` up, level, 90° across), for
 *     pulling up at home and driving off at the destination
 *     (`lib/virtualRide/taxi.ts`);
 *   - `chase()`: the drive's, matching Map3DElement exactly (`RIDE.taxi`:
 *     height, distance behind, vertical field of view), with the taxi at the
 *     view's centre — which is the point on the road the 3D map looks at.
 */

import { RIDE } from "@/lib/virtualRide/flight";
import { STREET_EYE } from "@/lib/virtualRide/boarding";
import { TAXI, type TaxiFrame } from "@/lib/virtualRide/taxi";

export type TaxiPlayer = {
  street(): void;
  chase(): void;
  /** Draws one frame; `dt` seconds since the last (turns the wheels). */
  pose(f: TaxiFrame, dt: number): void;
  play(frameAt: (t: number) => TaxiFrame, durationMs: number): Promise<void>;
  dispose(): void;
};

function label(text: string, sub: string | null, w: number, h: number, bg: string, fg: string, accent: string) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `800 ${Math.round(h * (sub ? 0.46 : 0.7))}px system-ui, sans-serif`;
  g.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) {
    g.fillStyle = accent;
    g.font = `600 ${Math.round(h * 0.16)}px system-ui, sans-serif`;
    g.fillText(sub, w / 2, h * 0.8);
  }
  return c;
}

function checker(w: number, h: number, n: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const s = h / 2;
  for (let i = 0; i < n; i++)
    for (let r = 0; r < 2; r++) {
      g.fillStyle = (i + r) % 2 ? "#111" : "#f4f4f4";
      g.fillRect(i * s, r * s, s, s);
    }
  return c;
}

export async function createTaxi(container: HTMLElement): Promise<TaxiPlayer> {
  const THREE = await import("three");

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(4, 8, 3);
  scene.add(sun);

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

  // ── The cab: 4.6 m long, front toward −z when yaw is 0. ──
  const mats: any[] = [];
  const mat = <M,>(m: M): M => {
    (m as any).transparent = true;
    mats.push(m);
    return m;
  };
  const yellow = mat(new THREE.MeshStandardMaterial({ color: 0xf7c400, metalness: 0.35, roughness: 0.35 }));
  const glass = mat(new THREE.MeshStandardMaterial({ color: 0x16212c, metalness: 0.6, roughness: 0.1 }));
  const black = mat(new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.2, roughness: 0.8 }));
  const chrome = mat(new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.9, roughness: 0.25 }));
  const head = mat(new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  const tail = mat(new THREE.MeshBasicMaterial({ color: 0xd8261c }));

  const car = new THREE.Group();
  scene.add(car);
  const add = (geo: any, m: any, x = 0, y = 0, z = 0, parent: any = car) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(1.84, 0.62, 4.6), yellow, 0, 0.62, 0); // body
  add(new THREE.BoxGeometry(1.86, 0.16, 4.62), black, 0, 0.36, 0); // sills and bumpers
  add(new THREE.BoxGeometry(1.62, 0.52, 2.3), glass, 0, 1.18, 0.25); // cabin glass
  add(new THREE.BoxGeometry(1.66, 0.07, 2.0), yellow, 0, 1.47, 0.3); // roof
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.5, 0.1), yellow, sx * 0.8, 1.18, -0.2); // pillars

  // Roof sign, lit.
  const signTex = new THREE.CanvasTexture(label("TAXI", null, 256, 96, "#fffbe6", "#1b1b1b", "#000"));
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = mat(new THREE.MeshBasicMaterial({ map: signTex }));
  add(new THREE.BoxGeometry(0.74, 0.24, 0.3), sign, 0, 1.63, 0.3);

  // Checker stripe and the labelled front doors, both sides.
  const checkTex = new THREE.CanvasTexture(checker(512, 32, 32));
  checkTex.colorSpace = THREE.SRGBColorSpace;
  const checkMat = mat(new THREE.MeshStandardMaterial({ map: checkTex, polygonOffset: true, polygonOffsetFactor: -2 }));
  const doorTex = new THREE.CanvasTexture(label("VCR", "Virtual Shopping Ride", 512, 200, "#f7c400", "#1b1b1b", "#5a3d00"));
  doorTex.colorSpace = THREE.SRGBColorSpace;
  doorTex.anisotropy = 4;
  const doorMat = mat(new THREE.MeshStandardMaterial({ map: doorTex, polygonOffset: true, polygonOffsetFactor: -2 }));
  for (const sx of [-1, 1]) {
    const stripe = add(new THREE.PlaneGeometry(4.4, 0.12), checkMat, sx * 0.925, 0.86, 0);
    stripe.rotation.y = (sx * Math.PI) / 2;
    const door = add(new THREE.PlaneGeometry(1.15, 0.45), doorMat, sx * 0.926, 0.58, -0.45);
    door.rotation.y = (sx * Math.PI) / 2;
  }

  // Lights: headlamps at the front (−z), tail lamps at the back.
  for (const sx of [-0.62, 0.62]) {
    add(new THREE.BoxGeometry(0.38, 0.14, 0.04), head, sx, 0.72, -2.31);
    add(new THREE.BoxGeometry(0.34, 0.14, 0.04), tail, sx, 0.74, 2.31);
  }
  add(new THREE.BoxGeometry(0.9, 0.16, 0.04), chrome, 0, 0.55, -2.31); // grille

  // Wheels.
  const wheels: any[] = [];
  for (const sx of [-0.84, 0.84])
    for (const sz of [-1.42, 1.42]) {
      const w = new THREE.Group();
      w.position.set(sx, TAXI.wheel, sz);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(TAXI.wheel, TAXI.wheel, 0.26, 24), black);
      tyre.rotation.z = Math.PI / 2;
      w.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.27, 6), chrome);
      hub.rotation.z = Math.PI / 2;
      w.add(hub);
      car.add(w);
      wheels.push(w);
    }

  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.1), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  car.add(shadow);

  let raf = 0;
  let disposed = false;
  let roll = 0;

  const pose = (f: TaxiFrame, dt: number) => {
    car.position.set(f.car.x, f.car.y, f.car.z);
    car.rotation.y = f.yaw;
    roll += (f.speed / TAXI.wheel) * dt;
    for (const w of wheels) w.rotation.x = -roll;
    // A little life in the suspension while it moves.
    car.position.y += f.speed > 0.5 ? 0.012 * Math.sin(performance.now() / 70) : 0;
    for (const m of mats) m.opacity = f.opacity;
    shadowMat.opacity = 0.35 * f.opacity;
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
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
