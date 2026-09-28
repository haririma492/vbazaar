import * as THREE from "three";
import {
  FOOD_STREET, FOUNTAIN_RADIUS, SHOPS, SQUARE_RADIUS, STREETS, sideSign,
  type Shop, type Street,
} from "@/lib/virtualBazaar/layout";
import { hex, makeSignBoard, makeSignSprite } from "./signs";

/**
 * BUILDS THE BAZAAR from the plan in `lib/virtualBazaar/layout.ts`: the square
 * with its pool and arcade, six gates, and the covered food street with its
 * shops.
 *
 * ⚠️ PLAIN ON PURPOSE (operator, 2026-09-27): this stage proves that walking,
 * looking round, entering a راسته and opening a shop work on a phone and a
 * desktop. Boxes, pointed arches and one vault; Lambert materials, no shadows,
 * the arcade's repeated pieces instanced — cheap enough for a mid-range phone.
 * Making it beautiful comes after.
 */

export type Pick = { kind: "street"; id: string } | { kind: "shop"; id: string };

export type BuiltBazaar = {
  root: THREE.Group;
  /** Objects a tap can select; each has `userData.pick` on itself or an ancestor. */
  pickables: THREE.Object3D[];
  /** Floors a tap can walk to. */
  ground: THREE.Object3D[];
  /** The gates' floating names; the engine sizes them to the screen. */
  billboards: THREE.Sprite[];
};

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

/** A pointed (Persian) arch outline, from (−w/2, 0) up and over to (w/2, 0). */
function archOutline(w: number, spring: number, apex: number, segments = 16): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [new THREE.Vector2(-w / 2, 0), new THREE.Vector2(-w / 2, spring)];
  const ctrl = spring + (apex - spring) * 0.8;
  const left = new THREE.QuadraticBezierCurve(
    new THREE.Vector2(-w / 2, spring), new THREE.Vector2(-w / 2, ctrl), new THREE.Vector2(0, apex),
  );
  const right = new THREE.QuadraticBezierCurve(
    new THREE.Vector2(0, apex), new THREE.Vector2(w / 2, ctrl), new THREE.Vector2(w / 2, spring),
  );
  pts.push(...left.getPoints(segments).slice(1), ...right.getPoints(segments).slice(1));
  pts.push(new THREE.Vector2(w / 2, 0));
  return pts;
}

/** A flat face of `outerW × outerH` with a pointed arch cut out of its bottom. */
function portalShape(outerW: number, outerH: number, arch: THREE.Vector2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-outerW / 2, 0);
  arch.forEach((p) => s.lineTo(p.x, p.y));
  s.lineTo(outerW / 2, 0);
  s.lineTo(outerW / 2, outerH);
  s.lineTo(-outerW / 2, outerH);
  s.closePath();
  return s;
}

/** The band of tile between two arches, the outer one wider. */
function archBand(outer: THREE.Vector2[], inner: THREE.Vector2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(outer[0].x, outer[0].y);
  outer.slice(1).forEach((p) => s.lineTo(p.x, p.y));
  [...inner].reverse().forEach((p) => s.lineTo(p.x, p.y));
  s.closePath();
  return s;
}

/** Rotation about Y that turns an object's +z towards (dx, dz). */
const faceY = (dx: number, dz: number) => Math.atan2(dx, dz);

const GATE = { outerW: 9, outerH: 10, archW: 5, spring: 4.2, apex: 6.6, depth: 1.8 };

function buildGate(street: Street): THREE.Group {
  const a = (street.angle * Math.PI) / 180;
  const g = new THREE.Group();
  g.position.set(Math.cos(a) * (SQUARE_RADIUS + GATE.depth / 2), 0, Math.sin(a) * (SQUARE_RADIUS + GATE.depth / 2));
  // Its front (+z) faces the middle of the square.
  g.rotation.y = faceY(-Math.cos(a), -Math.sin(a));
  g.userData.pick = { kind: "street", id: street.id } satisfies Pick;

  const arch = archOutline(GATE.archW, GATE.spring, GATE.apex);
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(portalShape(GATE.outerW, GATE.outerH, arch), { depth: GATE.depth, bevelEnabled: false }),
    lambert(0xb98a5a),
  );
  body.position.z = -GATE.depth / 2;
  g.add(body);

  // A band of tile in the راسته's colour round the arch.
  const band = new THREE.Mesh(
    new THREE.ShapeGeometry(archBand(archOutline(GATE.archW + 1.2, GATE.spring, GATE.apex + 0.8), arch)),
    lambert(street.color, { side: THREE.DoubleSide }),
  );
  band.position.z = GATE.depth / 2 + 0.02;
  g.add(band);

  // ⚠️ AS WIDE AS THE GATE, AND A NAME IN THE AIR ABOVE IT (operator,
  // 2026-09-28: "make the sign of each bazaar larger and visible from far").
  // The board fills the gate's face; the floating name keeps its size on
  // screen however far away you stand, so every راسته reads from anywhere in
  // the square.
  const style = {
    bg: "#1d2a33",
    fg: "#f7ecd6",
    border: hex(street.color),
    sub: street.open ? { fa: "ورود", en: "Enter" } : { fa: "به‌زودی", en: "Coming soon" },
  };
  const label = { fa: street.name, en: street.en };
  const sign = makeSignBoard(label, 8.6, 2.1, style);
  sign.position.set(0, 8.2, GATE.depth / 2 + 0.03);
  g.add(sign);
  const floating = makeSignSprite(label, 4.2, { ...style, sub: undefined });
  floating.position.set(0, 12.4, 0);
  floating.userData.billboard = true;
  g.add(floating);

  if (!street.open) {
    // A closed wooden door in the arch.
    const doorShape = new THREE.Shape(arch);
    const door = new THREE.Mesh(new THREE.ShapeGeometry(doorShape), lambert(0x6b4a2e, { side: THREE.DoubleSide }));
    door.position.z = 0.1;
    g.add(door);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.08, GATE.apex - 0.3, 0.05), lambert(0x3e2a18));
    seam.position.set(0, (GATE.apex - 0.3) / 2, 0.14);
    g.add(seam);
  }
  return g;
}

/** The ring of arcade between the gates: walls, niches and a band of tile. */
function buildArcade(): THREE.Object3D[] {
  const SEGMENTS = 60;
  const seg = (2 * Math.PI * SQUARE_RADIUS) / SEGMENTS;
  const gateGap = 9; // degrees either side of a gate's centre left to the gate
  const angles: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const deg = (i + 0.5) * (360 / SEGMENTS);
    const nearGate = STREETS.some((s) => Math.abs(((deg - s.angle + 540) % 360) - 180) < gateGap);
    if (!nearGate) angles.push((deg * Math.PI) / 180);
  }

  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(seg + 0.15, 7, 1.2), lambert(0xc49a6c), angles.length);
  const niche = new THREE.InstancedMesh(new THREE.BoxGeometry(seg * 0.62, 3.1, 0.12), lambert(0x5a3b24), angles.length);
  const upper = new THREE.InstancedMesh(new THREE.BoxGeometry(seg * 0.5, 1.4, 0.12), lambert(0x6b4a2e), angles.length);
  const tile = new THREE.InstancedMesh(new THREE.BoxGeometry(seg + 0.15, 0.45, 0.14), lambert(0x2f7f9a), angles.length);
  const dummy = new THREE.Object3D();
  const place = (mesh: THREE.InstancedMesh, i: number, a: number, r: number, y: number) => {
    dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    dummy.rotation.set(0, faceY(-Math.cos(a), -Math.sin(a)), 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  angles.forEach((a, i) => {
    place(wall, i, a, SQUARE_RADIUS + 0.6, 3.5);
    place(niche, i, a, SQUARE_RADIUS - 0.05, 1.55);
    place(upper, i, a, SQUARE_RADIUS - 0.05, 4.9);
    place(tile, i, a, SQUARE_RADIUS - 0.07, 6.3);
  });
  return [wall, niche, upper, tile];
}

function buildFountain(): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.2, 0.7, 8), lambert(0xe4d6bd));
  rim.position.y = 0.35;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(FOUNTAIN_RADIUS - 0.3, FOUNTAIN_RADIUS - 0.3, 0.08, 8), lambert(0x4f9fc4));
  water.position.y = 0.66;
  // ⚠️ LOWER THAN THE EYE. The pool stands between the arrival point and the
  // food street's gate; a column any taller hides the gate's sign.
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 1.0, 8), lambert(0xe4d6bd));
  column.position.y = 0.6;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.35, 0.3, 8), lambert(0xe4d6bd));
  bowl.position.y = 1.2;
  g.add(rim, water, column, bowl);
  return g;
}

const SIGN_WOOD = { bg: "#5b3a1e", fg: "#f3e3c3", border: "#c9a66b" };

function buildShop(shop: Shop, logo: HTMLImageElement | null): THREE.Group {
  const s = sideSign(shop.side);
  const g = new THREE.Group();
  g.userData.pick = { kind: "shop", id: shop.id } satisfies Pick;
  const hw = FOOD_STREET.halfWidth;
  const width = FOOD_STREET.bay - 0.8;
  // The side of each board that faces the street.
  const toStreet = s < 0 ? 0 : Math.PI;

  const back = new THREE.Mesh(new THREE.BoxGeometry(width, 5.4, 0.3), lambert(0xd8c3a0));
  back.position.set(shop.x, 2.7, s * (hw + 2.8));
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, 2.8), lambert(0xb89a74));
  ceiling.position.set(shop.x, 3.85, s * (hw + 1.4));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 2.8), lambert(0xb9a07a));
  floor.position.set(shop.x, 0.05, s * (hw + 1.4));
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(FOOD_STREET.bay, 1.5, 0.6), lambert(0xc49a6c));
  lintel.position.set(shop.x, 4.65, s * (hw + 0.3));

  const goods = lambert(shop.color);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(width - 0.8, 1, 0.7), lambert(0x7a5634));
  counter.position.set(shop.x, 0.5, s * (hw + 0.6));
  g.add(back, ceiling, floor, lintel, counter);

  // Goods on the counter and on two shelves.
  const item = new THREE.BoxGeometry(0.5, 0.4, 0.4);
  for (let i = 0; i < 6; i++) {
    const box = new THREE.Mesh(item, goods);
    box.position.set(shop.x - 1.6 + i * 0.64, 1.2, s * (hw + 0.6));
    g.add(box);
  }
  for (const y of [1.4, 2.5]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(width - 0.4, 0.08, 0.5), lambert(0x6b4a2e));
    shelf.position.set(shop.x, y, s * (hw + 2.45));
    g.add(shelf);
    for (let i = 0; i < 7; i++) {
      const box = new THREE.Mesh(item, goods);
      box.position.set(shop.x - 1.9 + i * 0.63, y + 0.24, s * (hw + 2.45));
      g.add(box);
    }
  }

  const style = shop.brand
    ? {
        bg: shop.id === "sarekooche" ? "#00b8c8" : hex(shop.color),
        fg: shop.id === "sarekooche" ? "#06131c" : "#ffffff",
        border: "#f0fffc",
        sub: shop.id === "sarekooche" ? { fa: "Sar-eh Kooche", en: "سرکوچه" } : { fa: "در سرکوچه", en: "at Sarekooche" },
        logo,
      }
    : SIGN_WOOD;

  const label = { fa: shop.name, en: shop.en };
  const sign = makeSignBoard(label, 4.4, 1.1, style);
  sign.position.set(shop.x, 4.65, s * (hw - 0.02));
  sign.rotation.y = toStreet;
  g.add(sign);

  if (shop.brand) {
    // ⚠️ THE SAREKOOCHE SHOPS MUST BE SEEN FROM THE GATE. A board flat on the
    // wall is edge-on to someone standing at the end of the street, so these
    // two also hang a sign across the street, readable both ways, and light
    // their doorway in the house colour.
    const hanging = new THREE.Group();
    hanging.position.set(shop.x - 2.3, 3.5, s * (hw - 0.9));
    const front = makeSignBoard(label, 1.9, 0.95, style);
    front.rotation.y = -Math.PI / 2; // faces the gate (−x)
    const rear = makeSignBoard(label, 1.9, 0.95, style);
    rear.rotation.y = Math.PI / 2;
    rear.position.x = 0.01;
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), lambert(0x333333));
    rod.position.y = 0.75;
    hanging.add(front, rear, rod);
    g.add(hanging);

    const glow = new THREE.MeshBasicMaterial({ color: shop.id === "sarekooche" ? 0x00b8c8 : shop.color });
    const post = new THREE.BoxGeometry(0.12, 3.9, 0.12);
    for (const dx of [-width / 2 + 0.1, width / 2 - 0.1]) {
      const p = new THREE.Mesh(post, glow);
      p.position.set(shop.x + dx, 1.95, s * (hw + 0.05));
      g.add(p);
    }
  }
  return g;
}

/** The covered street east of the square's east gate. */
function buildFoodStreet(shops: THREE.Group[], logo: HTMLImageElement | null): THREE.Group {
  const g = new THREE.Group();
  const { start, end, halfWidth: hw, bay, firstBay } = FOOD_STREET;
  const from = start + GATE.depth;
  const length = end - from;
  const mid = (from + end) / 2;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(end - start + 1, hw * 2), lambert(0xc8b28c));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((start + end) / 2, 0.02, 0);
  floor.userData.ground = true;
  g.add(floor);

  // Piers between the shops, and plain wall where there is no shop.
  const firstEdge = firstBay - bay / 2;
  const lastEdge = firstBay + bay * 5.5;
  const pier = new THREE.BoxGeometry(0.8, 5.4, 2.9);
  const pierMat = lambert(0xc49a6c);
  for (const s of [-1, 1]) {
    for (let x = firstEdge; x <= lastEdge + 0.01; x += bay) {
      const p = new THREE.Mesh(pier, pierMat);
      p.position.set(x, 2.7, s * (hw + 1.45));
      g.add(p);
    }
    for (const [a, b] of [[from, firstEdge], [lastEdge, end]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(b - a, 5.4, 0.6), pierMat);
      w.position.set((a + b) / 2, 2.7, s * (hw + 0.3));
      g.add(w);
    }
  }

  // The vault: one half-cylinder the length of the street.
  const vault = new THREE.Mesh(
    new THREE.CylinderGeometry(hw + 0.6, hw + 0.6, length, 40, 1, true, 0, Math.PI),
    lambert(0xd9c4a0, { side: THREE.DoubleSide }),
  );
  vault.rotation.z = Math.PI / 2;
  vault.position.set(mid, 5.4, 0);
  g.add(vault);

  // A skylight at each bay, and the shaft of light under it.
  const skyGeo = new THREE.CircleGeometry(0.75, 16);
  const skyMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc, side: THREE.DoubleSide });
  const shaftGeo = new THREE.CylinderGeometry(0.75, 1.5, 5.4 + hw, 16, 1, true);
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xfff1c9, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 6; i++) {
    const x = firstBay + i * bay;
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.rotation.x = Math.PI / 2;
    sky.position.set(x, 5.4 + hw + 0.5, 0);
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.set(x, (5.4 + hw) / 2, 0);
    g.add(sky, shaft);
  }

  const endWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, hw * 2 + 2), pierMat);
  endWall.position.set(end + 0.3, 5, 0);
  const endSign = makeSignBoard({ fa: "ادامهٔ بازار", en: "More of the bazaar" }, 4, 1, {
    ...SIGN_WOOD,
    sub: { fa: "به‌زودی", en: "Coming soon" },
  });
  endSign.position.set(end - 0.02, 3.2, 0);
  endSign.rotation.y = -Math.PI / 2;
  g.add(endWall, endSign);

  SHOPS.filter((s) => s.street === "food").forEach((shop) => {
    const built = buildShop(shop, logo);
    shops.push(built);
    g.add(built);
  });
  return g;
}

export function buildBazaar(): BuiltBazaar {
  const root = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  const ground: THREE.Object3D[] = [];

  const square = new THREE.Mesh(new THREE.CircleGeometry(SQUARE_RADIUS + 1, 72), lambert(0xdcc9a6));
  square.rotation.x = -Math.PI / 2;
  square.userData.ground = true;
  root.add(square);
  ground.push(square);

  const inlay = new THREE.Mesh(new THREE.RingGeometry(7.5, 8.1, 64), lambert(0xa9744a));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.01;
  root.add(inlay);

  root.add(buildFountain());
  buildArcade().forEach((m) => root.add(m));

  STREETS.forEach((street) => {
    const gate = buildGate(street);
    root.add(gate);
    pickables.push(gate);
  });

  let logo: HTMLImageElement | null = null;
  if (typeof Image !== "undefined") {
    logo = new Image();
    logo.src = "/sarekooche-logo-5.png";
  }
  const shops: THREE.Group[] = [];
  const street = buildFoodStreet(shops, logo);
  root.add(street);
  pickables.push(...shops);
  street.traverse((o) => {
    if (o.userData.ground) ground.push(o);
  });

  const billboards: THREE.Sprite[] = [];
  root.traverse((o) => {
    if (o.userData.billboard) billboards.push(o as THREE.Sprite);
  });
  return { root, pickables, ground, billboards };
}

/** The `Pick` an intersected object belongs to, looking up its ancestors. */
export function pickOf(object: THREE.Object3D | null): Pick | null {
  for (let o = object; o; o = o.parent) {
    if (o.userData.pick) return o.userData.pick as Pick;
  }
  return null;
}
