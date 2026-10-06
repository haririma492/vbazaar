// THE CHINA STORE'S COMMERCE DATA — kept apart from anything that draws it.
//
// Three things, deliberately separate, because each has a different owner and
// a different lifetime:
//
//   CATALOGUE  what the merchant sells: SKU, name, price, the GLB that stands
//              for it. The merchant's spreadsheet, later a database row.
//              Changing a price here changes it for the next shopper — no
//              rescan, no new model, no new scene.
//   HOTSPOTS   where a SKU sits in one scene: an XYZ anchor and how near a
//              shopper must be. Today placed by hand in the simulated store;
//              later clicked onto a Gaussian-splat capture by the merchant
//              (scene id + SKU + XYZ). The splat never carries a price.
//   DISPLAY    how the simulator stands the GLB on its shelf. Only the
//              simulated store reads it; in a captured store the shelf is the
//              splat's, and the GLB appears only when a shopper picks it up.
//
//   CATALOGUE ⨝ HOTSPOTS (by SKU)  →  Product, what the interaction layer uses.
//
// Import-free so `npm test` runs it directly.

export type Vec3 = { x: number; y: number; z: number };

/** One row of the merchant's catalogue. */
export type CatalogItem = {
  sku: string;
  name: string;
  price: number;
  currency: string;
  /** The interactive 3D stand-in for the product (GLB). */
  modelUrl: string;
  /** A line for the product card. */
  blurb?: string;
  /** A sale price, while the merchant runs one (the label shows both). */
  salePrice?: number;
  /** What the product says out loud as a shopper passes (an audio ad). */
  ad?: string;
};

/**
 * Where the product is held in the hand, in the model's own coordinates:
 * the point the grip closes on and the hand's orientation as a quaternion
 * [x, y, z, w]. Only pieces the hand can take need one.
 */
export type Grasp = { point: [number, number, number]; quaternion: [number, number, number, number] };

/** One SKU placed in one scene. */
export type Hotspot = {
  sceneId: string;
  sku: string;
  id: string;
  /** World point the label and proximity are measured from (the product's centre). */
  anchor: Vec3;
  /** Within this distance (m) the label is fully shown; it fades over the next metre. */
  labelDistance: number;
  /** Within this distance (m) the product can be picked up. */
  selectionDistance: number;
  hero?: boolean;
  /** Which side of the product its label sits. */
  labelSide?: "above" | "below";
  /**
   * How the simulated store stands the GLB: where the model's origin goes,
   * turned `yaw` about the vertical and then `tilt` about x (radians).
   */
  display?: { position: Vec3; yaw?: number; tilt?: number; scale?: number };
  grasp?: Grasp;
  /** Within this distance (m), in view, the product's audio ad plays (once per pass). */
  adDistance?: number;
};

/** The joined record the interaction layer works with. */
export type Product = CatalogItem & Omit<Hotspot, "sku">;

export const SCENE_ID = "vca-china-sim-01";
/** Next door in the same mall: the jewellery store. */
export const JEWELRY_SCENE_ID = "vca-jewelry-sim-01";

/** Each scene is one store; the basket and the checkout span them all. */
export const STORES: Record<string, string> = {
  [SCENE_ID]: "VCA Porcelain",
  [JEWELRY_SCENE_ID]: "VCA Fine Jewellery",
};

// ── the merchant's catalogue ──────────────────────────────────────────────

export const CATALOG: CatalogItem[] = [
  { sku: "CT-1001", name: "Tea Cup & Saucer", price: 29, currency: "CAD", modelUrl: "/models/china/cup-saucer.glb", blurb: "Cobalt Royal · bone china" },
  { sku: "CT-1002", name: "Dinner Plate", price: 39, currency: "CAD", modelUrl: "/models/china/dinner-plate.glb", blurb: "Cobalt Royal · 27 cm" },
  { sku: "CT-1003", name: "Serving Bowl", price: 59, currency: "CAD", modelUrl: "/models/china/bowl.glb", blurb: "Cobalt Royal · 21 cm" },
  { sku: "CT-1004", name: "Porcelain Teapot", price: 89, currency: "CAD", modelUrl: "/models/china/teapot.glb", blurb: "Cobalt Royal · 1.1 L · hand-gilded" },
  { sku: "CT-1005", name: "Serving Platter", price: 64, currency: "CAD", modelUrl: "/models/china/platter.glb", blurb: "Cobalt Royal · 34 cm" },
  { sku: "CT-1006", name: "Sugar Bowl", price: 34, currency: "CAD", modelUrl: "/models/china/sugar-bowl.glb", blurb: "Cobalt Royal · gilded handles" },
  // On the sale post by the door.
  {
    sku: "CT-1042", name: "Prunus Ginger Jar", price: 129, salePrice: 99, currency: "CAD", modelUrl: "/models/china/ginger-jar.glb", blurb: "Cobalt ground · cracked ice & blossom",
    ad: "Psst — over here! I'm on sale! The Prunus Ginger Jar: was one twenty-nine, today just ninety-nine dollars.",
  },
  { sku: "CT-1043", name: "Celadon Vase", price: 72, salePrice: 58, currency: "CAD", modelUrl: "/models/china/celadon-vase.glb", blurb: "Crackle glaze · 30 cm" },
  { sku: "CT-1044", name: "Celadon Bud Vase", price: 38, salePrice: 29, currency: "CAD", modelUrl: "/models/china/celadon-vase.glb", blurb: "Crackle glaze · 18 cm" },
  // The Prunus wall (left).
  { sku: "CT-1051", name: "Prunus Dinner Plate", price: 45, currency: "CAD", modelUrl: "/models/china/prunus-plate.glb", blurb: "Prunus · 27 cm" },
  { sku: "CT-1052", name: "Prunus Bowl", price: 62, currency: "CAD", modelUrl: "/models/china/prunus-bowl.glb", blurb: "Prunus · 21 cm" },
  { sku: "CT-1053", name: "Prunus Cup & Saucer", price: 34, currency: "CAD", modelUrl: "/models/china/prunus-cup-saucer.glb", blurb: "Prunus · gilded rim" },
  // The Celadon wall (right).
  { sku: "CT-1061", name: "Celadon Teapot", price: 95, currency: "CAD", modelUrl: "/models/china/celadon-teapot.glb", blurb: "Crackle glaze · 1.1 L" },
  { sku: "CT-1062", name: "Celadon Bowl", price: 55, currency: "CAD", modelUrl: "/models/china/celadon-bowl.glb", blurb: "Crackle glaze · 21 cm" },
  { sku: "CT-1063", name: "Celadon Plate", price: 42, currency: "CAD", modelUrl: "/models/china/celadon-plate.glb", blurb: "Crackle glaze · 27 cm" },
  // ── the jewellery store's catalogue ──
  { sku: "JW-2001", name: "Solitaire Diamond Ring", price: 4900, currency: "CAD", modelUrl: "/models/china/ring-solitaire.glb", blurb: "1.0 ct round brilliant · 18k gold" },
  { sku: "JW-2002", name: "Diamond Eternity Band", price: 2350, currency: "CAD", modelUrl: "/models/china/ring-eternity.glb", blurb: "22 brilliants · white gold" },
  { sku: "JW-2003", name: "Sapphire Halo Pendant", price: 1850, currency: "CAD", modelUrl: "/models/china/pendant-sapphire.glb", blurb: "Oval sapphire · diamond halo · 18k" },
  { sku: "JW-2004", name: "Akoya Pearl Strand", price: 1290, currency: "CAD", modelUrl: "/models/china/pearl-strand.glb", blurb: "7.5 mm pearls · 45 cm" },
  { sku: "JW-2005", name: "Gold Oval Bangle", price: 980, currency: "CAD", modelUrl: "/models/china/bangle-gold.glb", blurb: "18k yellow gold" },
  { sku: "JW-2006", name: "Pear Diamond Drops", price: 2750, currency: "CAD", modelUrl: "/models/china/earrings-drop.glb", blurb: "Pear & round brilliants · white gold" },
];

// ── where they sit in the simulated store ─────────────────────────────────
//
// The display wall: its counter top at y 0.90, a shelf at y 1.28, the wall
// at z −2.45. The sale post the shopper passes on the way in stands at
// x −1.12, z 1.95, its top at y 0.92. Two smaller units stand against the
// side walls (x ±3.6), centred at z 0.6, with the same counter and shelf
// heights; their pieces sit at x ±3.38 and face into the room.

const SHELF_Y = 1.28;
const COUNTER_Y = 0.9;
const PLINTH_Y = 0.92;
// A plate stands on its stand face-on, leaning back 15°: turned 75° about x.
const PLATE_TILT = (75 * Math.PI) / 180;

/** The teapot held by its handle: fingers into the loop, palm on the bar. */
const TEAPOT_GRASP: Grasp = {
  point: [0.13, 0.07, 0],
  // Fingers into the loop (−z), back of the hand to the right (+x), little
  // finger down; then the wrist turned 34° and dropped 17° so the forearm
  // comes from the shopper's lower right, not straight out of the shelf.
  quaternion: [-0.5249, 0.7119, -0.2769, 0.3755],
};

export const HOTSPOTS: Hotspot[] = [
  // The shelf.
  { sceneId: SCENE_ID, sku: "CT-1001", id: "cup-01", anchor: { x: -0.72, y: SHELF_Y + 0.05, z: -2.24 }, labelDistance: 3.0, selectionDistance: 1.6, display: { position: { x: -0.72, y: SHELF_Y, z: -2.24 }, yaw: 0.2 } },
  { sceneId: SCENE_ID, sku: "CT-1004", id: "teapot-01", hero: true, anchor: { x: 0.04, y: SHELF_Y + 0.085, z: -2.25 }, labelDistance: 3.5, selectionDistance: 1.6, display: { position: { x: 0.04, y: SHELF_Y, z: -2.25 }, yaw: 0.12 }, grasp: TEAPOT_GRASP },
  { sceneId: SCENE_ID, sku: "CT-1006", id: "sugar-01", anchor: { x: 0.72, y: SHELF_Y + 0.055, z: -2.24 }, labelDistance: 3.0, selectionDistance: 1.6, display: { position: { x: 0.72, y: SHELF_Y, z: -2.24 }, yaw: -0.1 } },
  // The counter.
  { sceneId: SCENE_ID, sku: "CT-1005", id: "platter-01", labelSide: "below", anchor: { x: -0.72, y: COUNTER_Y + 0.182, z: -2.19 }, labelDistance: 3.0, selectionDistance: 1.6, display: { position: { x: -0.72, y: COUNTER_Y + 0.182, z: -2.2 }, tilt: PLATE_TILT } },
  { sceneId: SCENE_ID, sku: "CT-1003", id: "bowl-01", labelSide: "below", anchor: { x: 0.0, y: COUNTER_Y + 0.04, z: -2.12 }, labelDistance: 3.2, selectionDistance: 1.6, display: { position: { x: 0.0, y: COUNTER_Y, z: -2.12 } } },
  { sceneId: SCENE_ID, sku: "CT-1002", id: "plate-01", labelSide: "below", anchor: { x: 0.72, y: COUNTER_Y + 0.15, z: -2.19 }, labelDistance: 3.0, selectionDistance: 1.6, display: { position: { x: 0.72, y: COUNTER_Y + 0.15, z: -2.2 }, tilt: PLATE_TILT } },
  // The plinth by the entrance.
  { sceneId: SCENE_ID, sku: "CT-1042", id: "jar-01", adDistance: 2.6, anchor: { x: -1.3, y: PLINTH_Y + 0.13, z: 2.0 }, labelDistance: 3.0, selectionDistance: 1.6, display: { position: { x: -1.3, y: PLINTH_Y, z: 2.0 }, yaw: 0.4 } },
  { sceneId: SCENE_ID, sku: "CT-1043", id: "vase-01", anchor: { x: -1.08, y: PLINTH_Y + 0.16, z: 1.82 }, labelDistance: 3.0, selectionDistance: 1.6, labelSide: "below", display: { position: { x: -1.08, y: PLINTH_Y, z: 1.82 } } },
  { sceneId: SCENE_ID, sku: "CT-1044", id: "budvase-01", anchor: { x: -0.86, y: PLINTH_Y + 0.09, z: 2.08 }, labelDistance: 2.6, selectionDistance: 1.6, display: { position: { x: -0.86, y: PLINTH_Y, z: 2.08 }, scale: 0.6, yaw: 1.1 } },
  // The Prunus wall, left: facing +x.
  ...sideUnit(-1, [
    { sku: "CT-1053", id: "prunus-cup-01", at: "shelf", z: 1.05, rise: 0.05 },
    { sku: "CT-1052", id: "prunus-bowl-01", at: "shelf", z: 0.2, rise: 0.04 },
    { sku: "CT-1051", id: "prunus-plate-01", at: "counter", z: 0.6, rise: 0.15, plate: true },
  ]),
  // The Celadon wall, right: facing −x.
  ...sideUnit(1, [
    { sku: "CT-1061", id: "celadon-teapot-01", at: "shelf", z: 0.6, rise: 0.085 },
    { sku: "CT-1062", id: "celadon-bowl-01", at: "counter", z: 0.12, rise: 0.04 },
    { sku: "CT-1063", id: "celadon-plate-01", at: "counter", z: 1.08, rise: 0.15, plate: true },
  ]),
];

// ── next door: the jewellery store ────────────────────────────────────────
//
// Its room runs x 4.1 … 10.9 (centre 7.5), z −2.45 … 4.6, the door at x 7.5.
// A glass vitrine across the back (velvet deck at y 0.98, z −1.25) holds the
// rings, the earrings and the bangle; two counters by the walls carry
// velvet neck forms with the pearls (left) and the pendant (right).

const DECK_Y = 0.98;
const JX = 7.5;

export const JEWELRY_HOTSPOTS: Hotspot[] = [
  { sceneId: JEWELRY_SCENE_ID, sku: "JW-2001", id: "ring-01", hero: true, anchor: { x: JX, y: DECK_Y + 0.05, z: -1.22 }, labelDistance: 2.8, selectionDistance: 1.3, display: { position: { x: JX, y: DECK_Y + 0.03, z: -1.22 }, yaw: 0.35 } },
  { sceneId: JEWELRY_SCENE_ID, sku: "JW-2002", id: "eternity-01", labelSide: "below", anchor: { x: JX - 0.48, y: DECK_Y + 0.045, z: -1.22 }, labelDistance: 2.6, selectionDistance: 1.3, display: { position: { x: JX - 0.48, y: DECK_Y + 0.03, z: -1.22 }, yaw: -0.3 } },
  { sceneId: JEWELRY_SCENE_ID, sku: "JW-2006", id: "earrings-01", labelSide: "below", anchor: { x: JX + 0.46, y: DECK_Y + 0.05, z: -1.25 }, labelDistance: 2.6, selectionDistance: 1.3, display: { position: { x: JX + 0.46, y: DECK_Y + 0.075, z: -1.25 } } },
  { sceneId: JEWELRY_SCENE_ID, sku: "JW-2005", id: "bangle-01", anchor: { x: JX + 0.95, y: DECK_Y + 0.03, z: -1.25 }, labelDistance: 2.6, selectionDistance: 1.3, display: { position: { x: JX + 0.95, y: DECK_Y, z: -1.25 }, yaw: -0.4 } },
  { sceneId: JEWELRY_SCENE_ID, sku: "JW-2004", id: "pearls-01", anchor: { x: 4.98, y: 1.24, z: 0.6 }, labelDistance: 3.0, selectionDistance: 1.6, display: { position: { x: 4.98, y: 1.17, z: 0.6 }, yaw: Math.PI / 2, tilt: -0.12 } },
  { sceneId: JEWELRY_SCENE_ID, sku: "JW-2003", id: "pendant-01", anchor: { x: 10.02, y: 1.2, z: 0.6 }, labelDistance: 3.0, selectionDistance: 1.6, display: { position: { x: 10.02, y: 1.16, z: 0.6 }, yaw: -Math.PI / 2, tilt: -0.12 } },
];

/** Every product in the mall, store by store. */
export function mallProducts(catalog: CatalogItem[] = CATALOG): Product[] {
  return [...productsFor(SCENE_ID, catalog), ...productsFor(JEWELRY_SCENE_ID, catalog, JEWELRY_HOTSPOTS)];
}

/** Hotspots on a side-wall unit: side −1 is the left wall, 1 the right. */
function sideUnit(side: -1 | 1, items: { sku: string; id: string; at: "shelf" | "counter"; z: number; rise: number; plate?: boolean }[]): Hotspot[] {
  const x = side * 3.38;
  const yaw = (-side * Math.PI) / 2; // the piece's front (+z) turned to face the room
  return items.map((it) => {
    const base = it.at === "shelf" ? SHELF_Y : COUNTER_Y;
    // A plate on its stand stands forward of the wall, centred at its own height.
    const y = it.plate ? base + it.rise : base;
    const px = it.plate ? x - side * 0.02 : x;
    return {
      sceneId: SCENE_ID, sku: it.sku, id: it.id,
      anchor: { x: px, y: base + it.rise, z: it.z },
      labelDistance: 3.0, selectionDistance: 1.6,
      labelSide: it.at === "counter" ? "below" : "above",
      display: { position: { x: px, y, z: it.z }, yaw, ...(it.plate ? { tilt: PLATE_TILT } : {}) },
    } satisfies Hotspot;
  });
}

/**
 * Joins the catalogue to a scene's hotspots by SKU. A hotspot whose SKU the
 * merchant no longer sells is dropped (nothing to label); a SKU with no
 * hotspot is simply not in this scene.
 */
export function productsFor(sceneId: string, catalog: CatalogItem[] = CATALOG, hotspots: Hotspot[] = HOTSPOTS): Product[] {
  const bySku = new Map(catalog.map((c) => [c.sku, c]));
  const out: Product[] = [];
  for (const h of hotspots) {
    if (h.sceneId !== sceneId) continue;
    const item = bySku.get(h.sku);
    if (!item) continue;
    const { sku: _sku, ...place } = h;
    out.push({ ...item, ...place });
  }
  return out;
}

/** What the shopper pays now: the sale price while there is one. */
export function priceNow(item: Pick<CatalogItem, "price" | "salePrice">): number {
  return item.salePrice !== undefined && item.salePrice < item.price ? item.salePrice : item.price;
}

/** "$89" for whole dollars, "$89.50" otherwise, "$4,900" with thousands — the label's price. */
export function formatPrice(price: number): string {
  const whole = Math.round(price * 100) % 100 === 0;
  const [int, frac] = (whole ? Math.round(price).toString() : price.toFixed(2)).split(".");
  return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

export type BasketLine = { sku: string; name: string; store: string; price: number };

/** The checkout: lines grouped by store, in the order first visited, and the total. */
export function checkout(lines: BasketLine[]): { stores: { store: string; lines: BasketLine[]; subtotal: number }[]; total: number } {
  const stores: { store: string; lines: BasketLine[]; subtotal: number }[] = [];
  for (const l of lines) {
    let s = stores.find((x) => x.store === l.store);
    if (!s) stores.push((s = { store: l.store, lines: [], subtotal: 0 }));
    s.lines.push(l);
    s.subtotal += l.price;
  }
  return { stores, total: stores.reduce((a, s) => a + s.subtotal, 0) };
}
