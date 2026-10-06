import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { grasscloth, marbleFloor, marbleSlab, plaster, signTexture, walnut } from "./textures";

/**
 * THE SIMULATED STORE — the environment, and nothing commercial.
 *
 * This module draws a china boutique: a marble floor, a walnut display wall
 * with lit shelves, a plinth by the door, a table of stock. It knows no SKU,
 * no price, no label. The commerce layer (../commerce) puts the products on
 * top using their anchors, so this whole file is what a Gaussian-splat
 * capture of a real store replaces.
 *
 * Coordinates (m): the floor is y 0; the display wall stands against z −2.45
 * with its counter at y 0.90 and a shelf at 1.28; the doorway is at z 4.6.
 */

export type Store = {
  root: THREE.Group;
  /** Where a walking shopper may stand (x/z rectangles to stay out of). */
  walk: { minX: number; maxX: number; minZ: number; maxZ: number; blocked: { x0: number; x1: number; z0: number; z1: number }[] };
  /** Walkable floor for tap-to-walk. */
  floor: THREE.Mesh;
  /** Puts stock on the shelves and tables (copies of the catalogue's models, unlabelled). */
  dress: (loader: GLTFLoader) => Promise<void>;
};

const WARM = new THREE.Color().setRGB(1.0, 0.86, 0.72);
const LED = new THREE.Color().setRGB(1.0, 0.83, 0.64);

/** UVs in metres on each face's own plane — textures keep their scale on any box. */
function metricUV(g: THREE.BufferGeometry, grainAlong: "x" | "y" | "z" = "x", scale = 1) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    let u: number, v: number;
    if (ax >= ay && ax >= az) [u, v] = grainAlong === "y" ? [z, y] : [y, z];
    else if (ay >= az) [u, v] = grainAlong === "z" ? [x, z] : [z, x];
    else [u, v] = grainAlong === "y" ? [x, y] : [y, x];
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

export function buildStore(renderer: THREE.WebGLRenderer): Store {
  RectAreaLightUniformsLib.init();
  const root = new THREE.Group();
  root.name = "simulated-store";
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // ── materials ────────────────────────────────────────────────────────
  const floorTex = marbleFloor([1, 1]);
  const slabTex = marbleSlab([1, 1]);
  const woodTex = walnut([1, 1]);
  const clothTex = grasscloth([1, 1]);
  const plasterTex = plaster([1, 1]);
  for (const t of [floorTex, slabTex, woodTex, clothTex, plasterTex]) {
    for (const m of [t.color, t.normal, t.rough]) if (m) m.anisotropy = aniso;
  }
  floorTex.color.repeat.set(1 / 1.6, 1 / 1.6);
  floorTex.normal.repeat.copy(floorTex.color.repeat);
  floorTex.rough!.repeat.copy(floorTex.color.repeat);

  const floorMat = new THREE.MeshPhysicalMaterial({
    map: floorTex.color, normalMap: floorTex.normal, roughnessMap: floorTex.rough, roughness: 1,
    normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 0.35, clearcoatRoughness: 0.18,
  });
  const outsideFloorMat = new THREE.MeshStandardMaterial({ map: floorTex.color, roughness: 0.55, color: new THREE.Color(0.42, 0.4, 0.38) });
  const slabMat = new THREE.MeshPhysicalMaterial({
    map: slabTex.color, roughnessMap: slabTex.rough, roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.08,
  });
  const scaleTex = (t: { color: THREE.Texture; normal: THREE.Texture; rough?: THREE.Texture }, s: number) => {
    for (const m of [t.color, t.normal, t.rough]) m?.repeat.set(s, s);
  };
  scaleTex(slabTex, 1 / 1.2);
  scaleTex(woodTex, 1 / 0.9);
  scaleTex(clothTex, 1 / 0.6);
  scaleTex(plasterTex, 1 / 2.5);
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: woodTex.color, normalMap: woodTex.normal, roughnessMap: woodTex.rough, roughness: 1,
    normalScale: new THREE.Vector2(0.4, 0.4), clearcoat: 0.45, clearcoatRoughness: 0.22,
  });
  const clothMat = new THREE.MeshStandardMaterial({
    map: clothTex.color, normalMap: clothTex.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.9,
  });
  const plasterMat = new THREE.MeshStandardMaterial({
    map: plasterTex.color, normalMap: plasterTex.normal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.92,
  });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.9, 0.88, 0.85), roughness: 0.95 });
  const brassMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.8, 0.6, 0.34), metalness: 1, roughness: 0.28 });
  const blackMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.02, 0.02, 0.022), roughness: 0.6 });
  const bronzeMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.11, 0.09, 0.075), metalness: 0.85, roughness: 0.38 });
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.9, 0.75).multiplyScalar(3) });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.93, 0.82).multiplyScalar(2.2) });

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, opts: { r?: number; grain?: "x" | "y" | "z"; shadow?: boolean } = {}) => {
    const g = opts.r ? new RoundedBoxGeometry(w, h, d, 2, opts.r) : new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    metricUV(g, opts.grain ?? "x");
    const m = new THREE.Mesh(g, mat);
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // ── shell: floor, walls, ceiling, the doorway ────────────────────────
  const floorGeo = new THREE.PlaneGeometry(7.2, 7.1).rotateX(-Math.PI / 2).translate(0, 0, 1.05);
  metricUV(floorGeo, "x");
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  floor.name = "floor";
  root.add(floor);
  const outside = new THREE.Mesh(metricUV(new THREE.PlaneGeometry(14, 8).rotateX(-Math.PI / 2).translate(0, -0.001, 8.6)), outsideFloorMat);
  outside.receiveShadow = true;
  root.add(outside);

  const H = 3.2;
  box(7.4, H, 0.1, plasterMat, 0, H / 2, -2.55, { shadow: false }); // back
  box(0.1, H, 7.2, plasterMat, -3.65, H / 2, 1.05, { shadow: false }); // left
  box(0.1, H, 7.2, plasterMat, 3.65, H / 2, 1.05, { shadow: false }); // right
  const ceil = box(7.4, 0.1, 7.2, ceilingMat, 0, H + 0.05, 1.05, { shadow: false });
  ceil.receiveShadow = false;
  // Skirting.
  for (const [w, x, z, rot] of [[7.2, 0, -2.49, 0], [7.0, -3.59, 1.05, 1], [7.0, 3.59, 1.05, 1]] as const) {
    const s = rot ? box(0.02, 0.12, w, blackMat, x, 0.06, z) : box(w, 0.12, 0.02, blackMat, x, 0.06, z);
    s.castShadow = false;
  }
  // The cove: a light slot round the ceiling.
  for (const [w, d, x, z] of [[7.1, 0.02, 0, -2.42], [0.02, 7.0, -3.52, 1.05], [0.02, 7.0, 3.52, 1.05]] as const) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), trimMat);
    c.position.set(x, H - 0.12, z);
    root.add(c);
  }

  // Front wall with the doorway (2.2 m wide, 2.7 m high), seen from both sides.
  const DOOR_W = 2.2;
  const DOOR_H = 2.7;
  const FRONT_Z = 4.6;
  const sideW = (7.4 - DOOR_W) / 2;
  box(sideW, H, 0.2, plasterMat, -(DOOR_W / 2 + sideW / 2), H / 2, FRONT_Z, { shadow: false });
  box(sideW, H, 0.2, plasterMat, DOOR_W / 2 + sideW / 2, H / 2, FRONT_Z, { shadow: false });
  box(DOOR_W, H - DOOR_H, 0.2, plasterMat, 0, DOOR_H + (H - DOOR_H) / 2, FRONT_Z, { shadow: false });
  // Facade outside: dark bronze cladding, a brass-lit sign above the door.
  for (const sx of [-1, 1]) box(6, 4.2, 0.04, bronzeMat, sx * (DOOR_W / 2 + 3), 2.1, FRONT_Z + 0.12, { shadow: false });
  box(DOOR_W, 4.2 - DOOR_H, 0.04, bronzeMat, 0, DOOR_H + (4.2 - DOOR_H) / 2, FRONT_Z + 0.12, { shadow: false });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.325),
    new THREE.MeshStandardMaterial({ map: signTexture("VCA  PORCELAIN", "VIRTUAL  CHINA  STORE"), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(0.25, 0.2, 0.14), emissiveMap: null }),
  );
  sign.position.set(0, 3.2, FRONT_Z + 0.15);
  root.add(sign);
  // Door frame in brass.
  for (const sx of [-1, 1]) box(0.05, DOOR_H, 0.26, brassMat, sx * (DOOR_W / 2 + 0.025), DOOR_H / 2, FRONT_Z, { r: 0.006 });
  box(DOOR_W + 0.1, 0.05, 0.26, brassMat, 0, DOOR_H + 0.025, FRONT_Z, { r: 0.006 });
  // The mall corridor outside: a ceiling and a far wall in shadow.
  box(14, 0.1, 8, ceilingMat, 0, 3.9, 8.6, { shadow: false });
  box(14, 4, 0.1, plasterMat, 0, 2, 12.6, { shadow: false });

  // ── the display wall ─────────────────────────────────────────────────
  const W = 2.7;
  const BACK = -2.45;
  // Base cabinet: walnut doors, a black recessed plinth, a marble top.
  box(W, 0.08, 0.46, blackMat, 0, 0.04, BACK + 0.24);
  const doorW = W / 4;
  for (let i = 0; i < 4; i++) {
    const x = -W / 2 + doorW * (i + 0.5);
    box(doorW - 0.006, 0.79, 0.022, woodMat, x, 0.08 + 0.395, BACK + 0.5, { r: 0.004, grain: "y" });
    // Raised field on each door.
    box(doorW - 0.13, 0.6, 0.012, woodMat, x, 0.08 + 0.395, BACK + 0.515, { r: 0.004, grain: "y" });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 24, 16), brassMat);
    knob.position.set(x + (i % 2 ? -1 : 1) * (doorW / 2 - 0.05), 0.72, BACK + 0.535);
    knob.castShadow = true;
    root.add(knob);
  }
  box(W, 0.8, 0.48, woodMat, 0, 0.08 + 0.4, BACK + 0.25, { grain: "y" }); // carcass
  box(W + 0.03, 0.035, 0.53, slabMat, 0, 0.9 - 0.0175, BACK + 0.265, { r: 0.006 }); // counter top: y 0.90

  // Upper: grasscloth back, walnut sides, shelves, a cornice.
  const UP_TOP = 2.4;
  box(W - 0.08, UP_TOP - 0.9, 0.02, clothMat, 0, 0.9 + (UP_TOP - 0.9) / 2, BACK + 0.01, { shadow: false });
  for (const sx of [-1, 1]) box(0.045, UP_TOP - 0.9, 0.4, woodMat, sx * (W / 2 - 0.0225), 0.9 + (UP_TOP - 0.9) / 2, BACK + 0.2, { r: 0.004, grain: "y" });
  box(W + 0.06, 0.12, 0.46, woodMat, 0, UP_TOP + 0.06, BACK + 0.23, { r: 0.006 });
  box(W + 0.1, 0.025, 0.5, woodMat, 0, UP_TOP + 0.13, BACK + 0.25, { r: 0.006 });
  const SHELVES = [1.28, 1.66, 2.04];
  for (const y of SHELVES) {
    box(W - 0.09, 0.035, 0.36, woodMat, 0, y - 0.0175, BACK + 0.19, { r: 0.004 });
    // A brass nosing on the shelf edge.
    box(W - 0.09, 0.006, 0.006, brassMat, 0, y - 0.004, BACK + 0.372);
  }
  // LED strips under each shelf and the cornice, and the light they give.
  for (const y of [...SHELVES, UP_TOP]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.14, 0.004, 0.012), ledMat);
    strip.position.set(0, y - (y === UP_TOP ? 0.002 : 0.037), BACK + 0.33);
    root.add(strip);
    const area = new THREE.RectAreaLight(LED, y === SHELVES[0] ? 9 : 7, W - 0.16, 0.05);
    area.position.set(0, y - 0.04, BACK + 0.3);
    area.lookAt(0, 0, BACK + 0.15);
    root.add(area);
  }
  // Light on the counter from the underside of the first shelf.
  {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.14, 0.004, 0.012), ledMat);
    strip.position.set(0, 1.24, BACK + 0.33);
    root.add(strip);
  }

  // Plates hung on the wall either side of the unit are added by dress().

  // ── the plinth by the door ───────────────────────────────────────────
  const PL = { x: -1.12, z: 1.95, w: 0.78, d: 0.5, h: 0.92 };
  box(PL.w - 0.04, 0.05, PL.d - 0.04, brassMat, PL.x, 0.025, PL.z);
  box(PL.w, PL.h - 0.08, PL.d, slabMat, PL.x, 0.05 + (PL.h - 0.08) / 2, PL.z, { r: 0.004 });
  box(PL.w + 0.02, 0.03, PL.d + 0.02, slabMat, PL.x, PL.h - 0.015, PL.z, { r: 0.006 });

  // ── a round table of stock on the right ──────────────────────────────
  const TB = { x: 1.75, z: 1.2, r: 0.55, h: 0.76 };
  const top = new THREE.Mesh(metricUV(new THREE.CylinderGeometry(TB.r, TB.r, 0.04, 96).translate(TB.x, TB.h - 0.02, TB.z), "x"), woodMat);
  top.castShadow = top.receiveShadow = true;
  root.add(top);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, TB.h - 0.06, 48).translate(TB.x, (TB.h - 0.06) / 2 + 0.02, TB.z), woodMat);
  stem.castShadow = stem.receiveShadow = true;
  root.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.03, 64).translate(TB.x, 0.015, TB.z), brassMat);
  foot.receiveShadow = true;
  root.add(foot);

  // ── light ────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(new THREE.Color(1, 0.96, 0.9), new THREE.Color(0.35, 0.28, 0.22), 0.35);
  root.add(hemi);

  const spot = (from: [number, number, number], to: [number, number, number], intensity: number, angle: number, shadow: boolean, mapSize = 2048) => {
    const s = new THREE.SpotLight(WARM, intensity, 0, angle, 0.75, 2);
    s.position.set(...from);
    s.target.position.set(...to);
    if (shadow) {
      s.castShadow = true;
      s.shadow.mapSize.set(mapSize, mapSize);
      s.shadow.bias = -0.00012;
      s.shadow.normalBias = 0.015;
      s.shadow.radius = 4;
      s.shadow.camera.near = 0.5;
      s.shadow.camera.far = 8;
    }
    root.add(s, s.target);
    // The downlight's trim in the ceiling.
    const trim = new THREE.Mesh(new THREE.CircleGeometry(0.045, 32).rotateX(Math.PI / 2), trimMat);
    trim.position.set(from[0], H - 0.001, from[2]);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 32).rotateX(Math.PI / 2), blackMat);
    ring.position.set(from[0], H - 0.002, from[2]);
    root.add(trim, ring);
    return s;
  };
  // Accent spots on the display wall (these cast the shadows that seat the china).
  spot([-0.75, H, -0.55], [-0.6, 1.0, -2.3], 26, 0.42, true);
  spot([0.75, H, -0.55], [0.6, 1.0, -2.3], 26, 0.42, true);
  spot([0.0, H, -0.85], [0.03, 1.2, -2.3], 14, 0.3, true);
  // The plinth and the table.
  spot([PL.x + 0.1, H, PL.z - 0.4], [PL.x, PL.h, PL.z], 20, 0.36, true, 1024);
  spot([TB.x - 0.1, H, TB.z - 0.3], [TB.x, TB.h, TB.z], 14, 0.45, true, 1024);
  // General downlights over the floor, and two at the door.
  for (const [x, z] of [[-1.6, -0.6], [1.6, -0.6], [-2.4, 2.4], [2.4, 2.6], [0, 1.8], [0, 3.6]] as const)
    spot([x, H, z], [x, 0, z + 0.01], 9, 0.75, false);
  // Wall washers on the hung plates either side of the unit.
  for (const sx of [-1, 1]) spot([sx * 2.2, H, -1.6], [sx * 2.2, 1.6, -2.5], 10, 0.5, false);
  // The corridor outside, dimmer and cooler.
  for (const x of [-3, 0, 3]) {
    const p = new THREE.PointLight(new THREE.Color(0.95, 0.92, 0.88), 3.5, 0, 2);
    p.position.set(x, 3.6, 7.5);
    root.add(p);
  }

  // ── stock, unlabelled: copies of the catalogue's models ──────────────
  const dress = async (loader: GLTFLoader) => {
    const load = async (url: string) => (await loader.loadAsync(url)).scene;
    const [plate, bowl, cup, sugar, jar, vase] = await Promise.all(
      ["dinner-plate", "bowl", "cup-saucer", "sugar-bowl", "ginger-jar", "celadon-vase"].map((n) => load(`/models/china/${n}.glb`)),
    );
    const put = (src: THREE.Object3D, x: number, y: number, z: number, opts: { yaw?: number; tilt?: number; scale?: number } = {}) => {
      const o = src.clone(true);
      o.position.set(x, y, z);
      o.rotation.set(opts.tilt ?? 0, opts.yaw ?? 0, 0, "YXZ");
      if (opts.scale) o.scale.setScalar(opts.scale);
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
      });
      root.add(o);
      return o;
    };
    // Top shelves of the wall: a row of cups, stacked plates, bowls.
    for (let i = 0; i < 4; i++) put(cup, -1.0 + i * 0.2, 1.66, BACK + 0.2, { yaw: 0.3 + i * 0.05 });
    for (let i = 0; i < 5; i++) put(plate, 0.18, 1.66 + i * 0.0165, BACK + 0.19, { yaw: i * 0.7 });
    put(bowl, 0.62, 1.66, BACK + 0.19);
    put(sugar, 1.0, 1.66, BACK + 0.2, { yaw: 0.4 });
    put(vase, -0.85, 2.04, BACK + 0.19, { scale: 0.85 });
    put(jar, -0.35, 2.04, BACK + 0.19, { scale: 0.8, yaw: 1.2 });
    put(jar, 0.35, 2.04, BACK + 0.19, { scale: 0.8, yaw: 2.6 });
    put(vase, 0.85, 2.04, BACK + 0.19, { scale: 0.85, yaw: 1 });
    // Behind the labelled pieces on the shelf: the rest of their stock.
    put(cup, -0.92, 1.28, BACK + 0.12, { yaw: 0.6 });
    put(sugar, 0.52, 1.28, BACK + 0.1, { yaw: 1.1, scale: 0.98 });
    // Plates hung on the wall either side, three high.
    for (const sx of [-1, 1])
      for (let i = 0; i < 3; i++) put(plate, sx * 2.2, 1.15 + i * 0.36, -2.49, { tilt: Math.PI / 2, yaw: 0 });
    // The table: a stack of plates, two bowls, a cup.
    for (let i = 0; i < 6; i++) put(plate, TB.x - 0.16, TB.h + i * 0.0165, TB.z + 0.05, { yaw: i * 0.9 });
    put(bowl, TB.x + 0.2, TB.h, TB.z - 0.12);
    put(bowl, TB.x + 0.2, TB.h + 0.046, TB.z - 0.12, { scale: 0.8, yaw: 1 });
    put(cup, TB.x + 0.12, TB.h, TB.z + 0.28, { yaw: -0.7 });
    put(vase, TB.x - 0.05, TB.h, TB.z - 0.32, { yaw: 2 });
  };

  return {
    root,
    floor,
    walk: {
      minX: -3.3, maxX: 3.3, minZ: -1.75, maxZ: 9,
      blocked: [
        { x0: PL.x - PL.w / 2 - 0.25, x1: PL.x + PL.w / 2 + 0.25, z0: PL.z - PL.d / 2 - 0.25, z1: PL.z + PL.d / 2 + 0.25 },
        { x0: TB.x - TB.r - 0.25, x1: TB.x + TB.r + 0.25, z0: TB.z - TB.r - 0.25, z1: TB.z + TB.r + 0.25 },
        // The front wall either side of the doorway.
        { x0: -9, x1: -DOOR_W / 2 + 0.2, z0: FRONT_Z - 0.3, z1: FRONT_Z + 0.3 },
        { x0: DOOR_W / 2 - 0.2, x1: 9, z0: FRONT_Z - 0.3, z1: FRONT_Z + 0.3 },
      ],
    },
    dress,
  };
}
