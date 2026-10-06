import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { metricUV } from "./buildStore";
import { darkMarbleFloor, marbleFloor, plaster, signTexture } from "./textures";

/**
 * THE MALL OUTSIDE THE CHINA STORE, AND THE JEWELLERY STORE NEXT DOOR —
 * environment only, like ./buildStore: no SKU, no price, no label. The
 * commerce layer places the jewellery by its hotspots
 * (lib/chinastore/products.ts, JEWELRY_HOTSPOTS).
 *
 *   corridor     z 4.7 … 12.6, x −8 … 15, ceiling 3.9
 *   china store  x −3.7 … 3.7 (./buildStore), door at x 0
 *   jewellery    x 4.05 … 10.95, z −2.55 … 4.6, door at x 7.5
 */

export type Mall = {
  root: THREE.Group;
  floors: THREE.Mesh[];
  blocked: { x0: number; x1: number; z0: number; z1: number }[];
  /** The jewellery store's own lights (turned off while the shopper is far away). */
  jewelryLights: THREE.Light[];
  dress: (loader: GLTFLoader) => Promise<void>;
};

const JX = 7.5; // the jewellery store's centre line and door
const J0 = 4.05; // its left wall
const J1 = 10.95; // its right wall
const FRONT = 4.6;
const H = 3.2;

export function buildMall(renderer: THREE.WebGLRenderer): Mall {
  const root = new THREE.Group();
  root.name = "mall";
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const jewelryLights: THREE.Light[] = [];

  // ── materials ────────────────────────────────────────────────────────
  const corridorTex = marbleFloor([1, 1]);
  const nero = darkMarbleFloor([1, 1]);
  const plasterTex = plaster([1, 1]);
  for (const t of [corridorTex, nero, plasterTex]) for (const m of [t.color, t.normal, t.rough]) if (m) m.anisotropy = aniso;
  for (const m of [corridorTex.color, corridorTex.normal, corridorTex.rough]) m?.repeat.set(1 / 2.4, 1 / 2.4);
  for (const m of [nero.color, nero.normal, nero.rough]) m?.repeat.set(1 / 1.2, 1 / 1.2);
  for (const m of [plasterTex.color, plasterTex.normal]) m.repeat.set(1 / 2.5, 1 / 2.5);

  const corridorFloor = new THREE.MeshPhysicalMaterial({
    map: corridorTex.color, normalMap: corridorTex.normal, roughnessMap: corridorTex.rough, roughness: 1,
    color: new THREE.Color(0.93, 0.9, 0.86), normalScale: new THREE.Vector2(0.3, 0.3), clearcoat: 0.3, clearcoatRoughness: 0.2,
  });
  const neroMat = new THREE.MeshPhysicalMaterial({
    map: nero.color, normalMap: nero.normal, roughnessMap: nero.rough, roughness: 1,
    normalScale: new THREE.Vector2(0.3, 0.3), clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const plasterMat = new THREE.MeshStandardMaterial({ normalMap: plasterTex.normal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.9, color: new THREE.Color(0.62, 0.6, 0.57) });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.7, 0.69, 0.67), roughness: 0.95 });
  const darkCeil = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.04, 0.04, 0.045), roughness: 0.9 });
  // Midnight-navy lacquer: near black, but blue-black, so the warm light on it reads as depth, not olive.
  // Matte midnight-navy lacquer, no clear coat: the HDR that makes the stones
  // sparkle is a warm room, and a coat mirrors it onto every wall (olive,
  // once tone-mapped). The walls are lit by the room's own lights only.
  const lacquer = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.006, 0.009, 0.024), roughness: 0.55, specularIntensity: 0.15 });
  const brass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.82, 0.62, 0.35), metalness: 1, roughness: 0.22 });
  const velvet = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.008, 0.01, 0.026), roughness: 1, sheen: 0.6, sheenColor: new THREE.Color(0.04, 0.05, 0.12), sheenRoughness: 0.6,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.9, 0.95, 0.95), roughness: 0.02, metalness: 0, transparent: true, opacity: 0.04, depthWrite: false, envMapIntensity: 0.15, specularIntensity: 0.4,
  });
  const steel = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.2, 0.2, 0.21), metalness: 1, roughness: 0.35 });
  const walnutish = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.12, 0.07), roughness: 0.5 });
  const lightStrip = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.88).multiplyScalar(2.4) });
  const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.88, 0.7).multiplyScalar(3) });
  const shopGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.07, 0.065, 0.06) });
  for (const m of [corridorFloor, plasterMat, ceilingMat, darkCeil, walnutish]) m.envMapIntensity = 0.45;
  lacquer.envMapIntensity = 0.05;
  velvet.envMapIntensity = 0.3;

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, opts: { r?: number; shadow?: boolean; parent?: THREE.Object3D } = {}) => {
    const g = opts.r ? new RoundedBoxGeometry(w, h, d, 2, opts.r) : new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    metricUV(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    (opts.parent ?? root).add(m);
    return m;
  };
  const plane = (w: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, y, z)), mat);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const spot = (from: THREE.Vector3Tuple, to: THREE.Vector3Tuple, intensity: number, angle: number, shadow: boolean, color = new THREE.Color(1, 0.92, 0.84), list?: THREE.Light[]) => {
    const s = new THREE.SpotLight(color, intensity, 0, angle, 0.6, 2);
    s.position.set(...from);
    s.target.position.set(...to);
    if (shadow) {
      s.castShadow = true;
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.00012;
      s.shadow.normalBias = 0.01;
      s.shadow.camera.near = 0.3;
      s.shadow.camera.far = 6;
    }
    root.add(s, s.target);
    list?.push(s);
    return s;
  };

  // ── the corridor ─────────────────────────────────────────────────────
  const floors = [plane(23, 7.9, corridorFloor, 3.5, -0.001, 8.65)];
  box(23, 0.1, 8, ceilingMat, 3.5, 3.95, 8.6, { shadow: false });
  box(23, 4, 0.1, plasterMat, 3.5, 2, 12.65, { shadow: false });
  // Three long light lines down the ceiling, and the light they give.
  for (const z of [6.2, 8.6, 11.0]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(22, 0.01, 0.08), lightStrip);
    strip.position.set(3.5, 3.895, z);
    root.add(strip);
  }
  for (const x of [-4, 0, 4, 8, 12]) {
    const p = new THREE.PointLight(new THREE.Color(1, 0.96, 0.9), 5, 0, 2);
    p.position.set(x, 3.5, 8.6);
    root.add(p);
  }
  // Stores across the corridor: dark glass fronts, a glow inside, signs to come.
  for (const [x, w] of [[-4.5, 6], [3.0, 6.8], [10.5, 6.2]] as const) {
    box(w - 0.3, 2.9, 0.04, glass, x, 1.45, 12.5, { shadow: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.5, 2.6), shopGlow);
    glow.position.set(x, 1.4, 12.58);
    glow.rotation.y = Math.PI;
    root.add(glow);
    box(0.12, 4, 0.2, steel, x - w / 2, 2, 12.5, { shadow: false });
    // Mullions, and a row of lit display shapes deep inside: a store asleep.
    for (let k = 1; k < 4; k++) box(0.03, 2.9, 0.05, steel, x - w / 2 + (w * k) / 4, 1.45, 12.47, { shadow: false });
    for (let k = 0; k < 3; k++) {
      const lit = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.28, 0.22) }));
      lit.position.set(x - w / 3 + (k * w) / 3, 1.2, 12.57);
      lit.rotation.y = Math.PI;
      root.add(lit);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.225),
      new THREE.MeshStandardMaterial({ map: signTexture("OPENING  SOON", "VCA  MALL"), roughness: 0.5, emissive: new THREE.Color(0.2, 0.17, 0.12) }),
    );
    sign.position.set(x, 3.25, 12.48);
    sign.rotation.y = Math.PI;
    root.add(sign);
  }
  // The mall's front on this side beyond the two stores: plain stone.
  box(15 - 11.3, 4.2, 0.1, plasterMat, (15 + 11.3) / 2, 2.1, FRONT + 0.1, { shadow: false });
  box(0.9, 4.2, 0.1, plasterMat, -7.55, 2.1, FRONT + 0.1, { shadow: false });
  // The corridor's two ends.
  for (const x of [-8.0, 15.0]) box(0.1, 4, 8, plasterMat, x, 2, 8.6, { shadow: false });
  // A stone pilaster between the two stores, a bench in the corridor.
  box(0.3, 3.9, 0.3, plasterMat, 3.85, 1.95, FRONT + 0.2);
  box(1.6, 0.06, 0.45, walnutish, 2.0, 0.45, 10.4, { r: 0.01 });
  for (const sx of [-1, 1]) box(0.06, 0.42, 0.4, steel, 2.0 + sx * 0.65, 0.21, 10.4);

  // ── the jewellery store: shell ───────────────────────────────────────
  const W = J1 - J0;
  floors.push(plane(W, 7.15, neroMat, JX, 0, 1.03));
  box(W, H, 0.1, lacquer, JX, H / 2, -2.55, { shadow: false });
  box(0.1, H, 7.2, lacquer, J0, H / 2, 1.0, { shadow: false });
  box(0.1, H, 7.2, lacquer, J1, H / 2, 1.0, { shadow: false });
  box(W, 0.1, 7.2, darkCeil, JX, H + 0.05, 1.0, { shadow: false });
  // Brass fins on the walls, every 60 cm.
  for (let x = J0 + 0.45; x < J1 - 0.3; x += 0.6) box(0.012, H - 0.2, 0.03, brass, x, H / 2, -2.49, { shadow: false });
  for (let z = -2.1; z < 4.2; z += 0.6) {
    box(0.03, H - 0.2, 0.012, brass, J0 + 0.06, H / 2, z, { shadow: false });
    box(0.03, H - 0.2, 0.012, brass, J1 - 0.06, H / 2, z, { shadow: false });
  }
  // The name, lit, behind the vitrine.
  {
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.3),
      new THREE.MeshStandardMaterial({ map: signTexture("VCA  FINE  JEWELLERY", "EST.  2026"), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(0.3, 0.24, 0.16) }),
    );
    name.position.set(JX, 2.25, -2.49);
    root.add(name);
  }

  // Front wall with its door (1.8 m), two lit show windows, the facade.
  const DOOR = 1.8;
  const DOOR_H = 2.55;
  const leftW = JX - DOOR / 2 - J0 + 0.05;
  const rightW = J1 + 0.05 - (JX + DOOR / 2);
  box(leftW, H, 0.2, lacquer, J0 - 0.05 + leftW / 2, H / 2, FRONT, { shadow: false });
  box(rightW, H, 0.2, lacquer, JX + DOOR / 2 + rightW / 2, H / 2, FRONT, { shadow: false });
  box(DOOR, H - DOOR_H, 0.2, lacquer, JX, DOOR_H + (H - DOOR_H) / 2, FRONT, { shadow: false });
  // Facade: black with brass trim; the sign above the door.
  for (const [x0, x1] of [[3.85, JX - DOOR / 2], [JX + DOOR / 2, 11.3]] as const) {
    box(x1 - x0, 4.2, 0.04, lacquer, (x0 + x1) / 2, 2.1, FRONT + 0.125, { shadow: false });
  }
  box(DOOR, 4.2 - DOOR_H, 0.04, lacquer, JX, DOOR_H + (4.2 - DOOR_H) / 2, FRONT + 0.12, { shadow: false });
  // The jambs stand just inside the opening, so no face lies on the wall's.
  for (const sx of [-1, 1]) box(0.04, DOOR_H, 0.32, brass, JX + sx * (DOOR / 2 - 0.012), DOOR_H / 2, FRONT + 0.02, { r: 0.004 });
  box(DOOR + 0.08, 0.04, 0.32, brass, JX, DOOR_H + 0.02, FRONT + 0.02, { r: 0.004 });
  {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.3),
      new THREE.MeshStandardMaterial({ map: signTexture("VCA  FINE  JEWELLERY", "DIAMONDS  ·  PEARLS  ·  GOLD"), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(0.28, 0.22, 0.15) }),
    );
    sign.position.set(JX, 2.88, FRONT + 0.15);
    root.add(sign);
  }
  // Show windows: a velvet box behind glass either side of the door.
  const windows: THREE.Vector3[] = [];
  for (const x of [JX - 2.05, JX + 2.05]) {
    const g = new THREE.Group();
    g.position.set(x, 0, FRONT + 0.14);
    root.add(g);
    box(1.3, 1.25, 0.02, velvet, 0, 1.45, -0.34, { parent: g, shadow: false });
    box(1.3, 0.04, 0.34, velvet, 0, 0.84, -0.17, { parent: g });
    for (const sx of [-1, 1]) box(0.03, 1.33, 0.36, brass, sx * 0.665, 1.46, -0.17, { parent: g });
    box(1.36, 0.03, 0.36, brass, 0, 2.11, -0.17, { parent: g });
    box(1.36, 0.03, 0.36, brass, 0, 0.82, -0.17, { parent: g });
    box(1.3, 1.26, 0.006, glass, 0, 1.46, 0.0, { parent: g, shadow: false });
    windows.push(new THREE.Vector3(x, 0.86, FRONT - 0.04));
    spot([x, 2.05, FRONT - 0.02], [x, 0.9, FRONT - 0.15], 4, 0.6, false, undefined, jewelryLights);
  }

  // ── the vitrine across the back ──────────────────────────────────────
  const VZ = -1.25;
  const VW = 2.7;
  box(VW, 0.06, 0.58, brass, JX, 0.03, VZ);
  box(VW, 0.89, 0.62, lacquer, JX, 0.06 + 0.445, VZ, { r: 0.006 });
  box(VW - 0.04, 0.03, 0.56, velvet, JX, 0.965, VZ); // the deck: y 0.98
  // Glass: top, front, back, ends; brass edges.
  const GT = 1.26;
  box(VW, 0.008, 0.6, glass, JX, GT, VZ, { shadow: false });
  box(VW, GT - 0.98, 0.008, glass, JX, (GT + 0.98) / 2, VZ + 0.3, { shadow: false });
  box(VW, GT - 0.98, 0.008, glass, JX, (GT + 0.98) / 2, VZ - 0.3, { shadow: false });
  for (const sx of [-1, 1]) box(0.008, GT - 0.98, 0.6, glass, JX + sx * VW / 2, (GT + 0.98) / 2, VZ, { shadow: false });
  for (const sz of [-1, 1]) box(VW + 0.01, 0.01, 0.01, brass, JX, GT, VZ + sz * 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.01, GT - 0.98, 0.01, brass, JX + sx * VW / 2, (GT + 0.98) / 2, VZ + sz * 0.3);
  // The vitrine's own light, a strip under its lid.
  {
    // Dimmer than the corridor's lines: inches from the shopper's eye, it must not bloom.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(VW - 0.1, 0.004, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.88).multiplyScalar(0.9) }));
    strip.position.set(JX, GT - 0.01, VZ + 0.24);
    root.add(strip);
    const area = new THREE.RectAreaLight(new THREE.Color(1, 0.95, 0.88), 4, VW - 0.12, 0.04);
    area.position.set(JX, GT - 0.015, VZ + 0.22);
    area.lookAt(JX, 0.9, VZ - 0.05);
    root.add(area);
    jewelryLights.push(area);
  }
  // Fixtures on the deck: ring cones, an earring bar.
  for (const x of [JX, JX - 0.48]) {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.02, 0.03, 32), velvet);
    cone.position.set(x, 0.98 + 0.015, -1.22);
    cone.castShadow = cone.receiveShadow = true;
    root.add(cone);
  }
  {
    const x = JX + 0.46;
    box(0.006, 0.075, 0.006, brass, x, 0.98 + 0.0375, -1.25);
    box(0.06, 0.004, 0.004, brass, x, 0.98 + 0.075, -1.25);
    box(0.05, 0.006, 0.04, brass, x, 0.983, -1.25);
  }
  // Two stools at the vitrine.
  for (const x of [JX - 0.7, JX + 0.7]) {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 48), velvet);
    seat.position.set(x, 0.66, -0.45);
    seat.castShadow = seat.receiveShadow = true;
    root.add(seat);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.63, 24), brass);
    leg.position.set(x, 0.315, -0.45);
    leg.castShadow = true;
    root.add(leg);
  }
  // A halo of light over the vitrine.
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.018, 16, 128), halo);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(JX, 2.55, -1.1);
    root.add(ring);
    for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.65, 6), steel);
      wire.position.set(JX + Math.cos(a) * 0.75, 2.88, -1.1 + Math.sin(a) * 0.75);
      root.add(wire);
    }
  }

  // ── the two counters by the walls, each with a velvet neck form ──────
  const neck = (cx: number, facing: 1 | -1) => {
    box(0.6, 0.95, 1.4, lacquer, cx, 0.475, 0.6, { r: 0.006 });
    box(0.62, 0.02, 1.42, brass, cx, 0.96, 0.6);
    // The form: a lathed torso, flattened front to back, facing the room.
    const prof: [number, number][] = [
      [0.0, 0], [0.07, 0], [0.075, 0.015], [0.06, 0.03], [0.05, 0.08], [0.09, 0.2], [0.135, 0.33], [0.14, 0.37],
      [0.11, 0.405], [0.05, 0.42], [0.036, 0.44], [0.034, 0.53], [0.04, 0.55], [0.0, 0.555],
    ];
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 64);
    g.scale(0.55, 1, 1); // flat front to back (local x)
    const form = new THREE.Mesh(g, velvet);
    form.position.set(cx - facing * 0.15, 0.97, 0.6);
    form.castShadow = form.receiveShadow = true;
    root.add(form);
    spot([cx + facing * 1.1, H, 0.6], [cx - facing * 0.1, 1.2, 0.6], 16, 0.35, true, undefined, jewelryLights);
  };
  neck(4.85, 1);
  neck(10.15, -1);

  // ── light ────────────────────────────────────────────────────────────
  // Tight, warm, from above: the stones need small bright sources to sparkle.
  spot([JX - 0.6, H, -0.3], [JX - 0.3, 0.98, -1.25], 13, 0.3, true, undefined, jewelryLights);
  spot([JX + 0.6, H, -0.3], [JX + 0.5, 0.98, -1.25], 13, 0.3, true, undefined, jewelryLights);
  spot([JX, H, -0.6], [JX, 0.98, -1.22], 10, 0.12, false, new THREE.Color(1, 0.98, 0.95), jewelryLights);
  for (const [x, z] of [[JX - 1.8, 1.8], [JX + 1.8, 1.8], [JX, 3.2], [JX, 0.6]] as const)
    spot([x, H, z], [x, 0, z + 0.01], 5, 0.7, false, undefined, jewelryLights);
  // The facade, washed from the corridor ceiling.
  spot([JX, 3.9, 6.2], [JX, 2.6, FRONT], 10, 0.6, false);
  spot([0, 3.9, 6.2], [0, 2.6, FRONT], 8, 0.6, false);

  // ── stock in the windows: copies of the catalogue's models ───────────
  const dress = async (loader: GLTFLoader) => {
    const [pearlsM, pendantM, bangleM] = await Promise.all(
      ["pearl-strand", "pendant-sapphire", "bangle-gold"].map(async (n) => (await loader.loadAsync(`/models/china/${n}.glb`)).scene),
    );
    const put = (src: THREE.Object3D, p: THREE.Vector3, opts: { yaw?: number; tilt?: number; scale?: number } = {}) => {
      const o = src.clone(true);
      o.position.copy(p);
      o.rotation.set(opts.tilt ?? 0, opts.yaw ?? 0, 0, "YXZ");
      if (opts.scale) o.scale.setScalar(opts.scale);
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
      });
      root.add(o);
    };
    // Hung on the velvet back of each window.
    put(pearlsM, new THREE.Vector3(windows[0].x - 0.2, 1.25, FRONT - 0.18), { yaw: Math.PI });
    put(bangleM, new THREE.Vector3(windows[0].x + 0.3, 0.86, FRONT - 0.05), { yaw: Math.PI + 0.3 });
    put(pendantM, new THREE.Vector3(windows[1].x + 0.15, 1.3, FRONT - 0.18), { yaw: Math.PI });
    put(bangleM, new THREE.Vector3(windows[1].x - 0.35, 0.86, FRONT - 0.05), { yaw: Math.PI - 0.4 });
  };

  return {
    root,
    floors,
    jewelryLights,
    blocked: [
      // The party wall between the two stores.
      { x0: 3.55, x1: 4.3, z0: -9, z1: FRONT + 0.3 },
      // The jewellery store's front either side of its door.
      { x0: 3.55, x1: JX - DOOR / 2 + 0.15, z0: FRONT - 0.45, z1: FRONT + 0.35 },
      { x0: JX + DOOR / 2 - 0.15, x1: 12, z0: FRONT - 0.45, z1: FRONT + 0.35 },
      // The vitrine and the two counters.
      { x0: JX - VW / 2 - 0.3, x1: JX + VW / 2 + 0.3, z0: -9, z1: VZ + 0.65 },
      { x0: 4.3, x1: 4.85 + 0.6, z0: -0.4, z1: 1.6 },
      { x0: 10.15 - 0.6, x1: 11, z0: -0.4, z1: 1.6 },
      // The bench.
      { x0: 1.0, x1: 3.0, z0: 10.0, z1: 10.8 },
    ],
    dress,
  };
}
