/**
 * The Virtual Ride's drone, drawn by us over Google's Street View: a
 * passenger quadcopter (Three.js, built from shapes, no model file) on a
 * transparent canvas, posed each frame from `lib/virtualRide/boarding.ts`.
 * Street View has no 3D scene to put it in, so it is drawn in the rider's
 * own frame with a camera matching Street View's: eye `STREET_EYE` above the
 * street, looking level, 90° across (Street View at zoom 1).
 */

import { BOARDING, STREET_EYE, type BoardingFrame } from "@/lib/virtualRide/boarding";

const HFOV = 90;

export type DronePlayer = {
  /** Plays `frameAt` from 0 to `durationMs`; `onFrame` gets each frame (for the Street View dolly). */
  play(frameAt: (t: number) => BoardingFrame, durationMs: number, onFrame?: (f: BoardingFrame) => void): Promise<void>;
  dispose(): void;
};

export async function createDrone(container: HTMLElement): Promise<DronePlayer> {
  const THREE = await import("three");

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(3, 7, 2);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  camera.position.set(0, STREET_EYE, 0);
  camera.lookAt(0, STREET_EYE, -1);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = (2 * Math.atan(Math.tan(((HFOV / 2) * Math.PI) / 180) / camera.aspect) * 180) / Math.PI;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  // ── The drone: ~2.6 m across, its front toward −z (where the rider looks). ──
  const mats: { m: any; base: number }[] = [];
  const mat = <T extends any>(m: T, base = 1): T => {
    (m as any).transparent = true;
    mats.push({ m, base });
    return m;
  };
  const shell = mat(new THREE.MeshStandardMaterial({ color: 0xf4f5f7, metalness: 0.25, roughness: 0.35 }));
  const dark = mat(new THREE.MeshStandardMaterial({ color: 0x23272e, metalness: 0.5, roughness: 0.45 }));
  const glass = mat(new THREE.MeshStandardMaterial({ color: 0x14202c, metalness: 0.7, roughness: 0.08 }));
  const accent = mat(new THREE.MeshStandardMaterial({ color: 0xf2a33a, metalness: 0.3, roughness: 0.4 }));

  const drone = new THREE.Group();
  scene.add(drone);
  const add = (geo: any, m: any, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    drone.add(mesh);
    return mesh;
  };

  add(new THREE.SphereGeometry(0.5, 40, 20), shell, 0, 0.42, 0).scale.set(1.15, 0.55, 1.55);
  add(new THREE.SphereGeometry(0.42, 32, 16), glass, 0, 0.58, -0.3).scale.set(0.95, 0.55, 1);
  add(new THREE.BoxGeometry(1.1, 0.04, 0.08), accent, 0, 0.4, -0.72);

  const ARM = 1.05;
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const props: { group: any; dir: number }[] = [];
  const blurs: any[] = [];
  corners.forEach(([sx, sz], i) => {
    const arm = add(new THREE.BoxGeometry(0.09, 0.07, ARM * Math.SQRT2), dark, (sx * ARM) / 2, 0.42, (sz * ARM) / 2);
    arm.rotation.y = Math.atan2(sx, sz);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 20), dark, sx * ARM, 0.48, sz * ARM);
    const prop = new THREE.Group();
    prop.position.set(sx * ARM, 0.57, sz * ARM);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.014, 0.075), dark);
    prop.add(blade);
    const blur = new THREE.Mesh(
      new THREE.CircleGeometry(0.47, 40),
      new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0, depthWrite: false }),
    );
    blur.rotation.x = -Math.PI / 2;
    prop.add(blur);
    blurs.push(blur);
    drone.add(prop);
    props.push({ group: prop, dir: i % 2 ? 1 : -1 });
  });

  // Skids and their struts.
  for (const sx of [-0.48, 0.48]) {
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 10), dark, sx, 0.03, 0).rotation.x = Math.PI / 2;
    for (const sz of [-0.45, 0.45]) add(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark, sx * 0.8, 0.17, sz);
  }

  // Navigation lights: red port, green starboard, at the front arms.
  const red = mat(new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  const green = mat(new THREE.MeshBasicMaterial({ color: 0x34c759 }));
  add(new THREE.SphereGeometry(0.045, 12, 8), red, -ARM, 0.42, -ARM - 0.12);
  add(new THREE.SphereGeometry(0.045, 12, 8), green, ARM, 0.42, -ARM - 0.12);

  // A soft shadow on the street, fading as it climbs.
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.35, 40), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 1.25, 1);
  scene.add(shadow);

  let raf = 0;
  let disposed = false;

  const pose = (f: BoardingFrame, dt: number) => {
    drone.position.set(f.drone.x, f.drone.y + f.bob, f.drone.z);
    // Nose down a touch while carrying, as a multirotor leans into its motion.
    drone.rotation.x = -0.07 * Math.sin(Math.PI * (f.carried / BOARDING.carryMeters));
    const spinShare = f.spin / BOARDING.maxSpin;
    for (const p of props) p.group.rotation.y += p.dir * f.spin * 2 * Math.PI * dt;
    for (const b of blurs) b.material.opacity = 0.22 * spinShare * f.opacity;
    for (const { m, base } of mats) m.opacity = base * f.opacity;
    shadow.position.set(f.drone.x, 0.01, f.drone.z);
    shadowMat.opacity = 0.32 * f.opacity * Math.max(0, 1 - f.drone.y / 3);
    renderer.render(scene, camera);
  };

  return {
    play(frameAt, durationMs, onFrame) {
      return new Promise((resolve) => {
        const t0 = performance.now();
        let last = t0;
        const step = (now: number) => {
          if (disposed) return resolve();
          const t = Math.min(durationMs, now - t0);
          const f = frameAt(t);
          pose(f, (now - last) / 1000);
          last = now;
          onFrame?.(f);
          if (t >= durationMs) return resolve();
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
