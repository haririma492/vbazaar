/**
 * THE VIRTUAL BAZAAR'S PLAN — where everything stands, and where one may walk.
 *
 * Plain numbers, no Three.js: the scene is built from this, the camera is kept
 * inside it, and the tests read it without a browser.
 *
 * Coordinates are metres. `x` runs east, `z` runs south, `y` is up — Three.js's
 * own axes, so nothing is converted on the way into the scene. Angles around
 * the square are measured from east (+x) turning towards south (+z).
 *
 * ⚠️ YAW IS THE CAMERA'S, NOT THE COMPASS'S. A yaw of 0 looks north (−z) and
 * it grows turning LEFT (anticlockwise seen from above), which is what
 * `camera.rotation.y` does. `yawToward` is the one place that converts a
 * direction into it.
 */

export const EYE_HEIGHT = 1.7;

/** Inner face of the arcade that rings the square. */
export const SQUARE_RADIUS = 22;
/** How close to the arcade a visitor may walk. */
export const WALK_RADIUS = 20.5;
/** The pool in the middle of the square, and the clearance kept around it. */
export const FOUNTAIN_RADIUS = 3;
export const FOUNTAIN_CLEAR = 4.2;

export type StreetId = "food" | "clothing" | "gold" | "crafts" | "home" | "services";

export type Street = {
  id: StreetId;
  name: string;
  /** Degrees around the square, from east turning south. */
  angle: number;
  color: number;
  /** Only an open راسته has a street behind its gate; the rest are doors. */
  open: boolean;
};

export const STREETS: Street[] = [
  { id: "food", name: "راسته خوراکی", angle: 0, color: 0xc96b4b, open: true },
  { id: "clothing", name: "راسته پوشاک", angle: 60, color: 0x6d8fb3, open: false },
  { id: "gold", name: "راسته طلافروش‌ها", angle: 120, color: 0xd4af37, open: false },
  { id: "crafts", name: "راسته هنر و صنایع دستی", angle: 180, color: 0x9a6fae, open: false },
  { id: "home", name: "راسته خانه و زندگی", angle: 240, color: 0x789b72, open: false },
  { id: "services", name: "راسته خدمات", angle: 300, color: 0x777777, open: false },
];

export function streetById(id: string | null | undefined): Street | undefined {
  return STREETS.find((s) => s.id === id);
}

/**
 * THE FOOD STREET — a covered راسته running east from the square's east gate.
 * Its floor is `x` from the gate to the end wall, `z` between the shop fronts.
 */
export const FOOD_STREET = {
  start: SQUARE_RADIUS,
  end: 66,
  /** Half the width between the shop fronts. */
  halfWidth: 3.5,
  /** How close to the shop fronts one may walk. */
  walkHalfWidth: 2.4,
  /** Bays are this long, the first centred at `firstBay`. */
  bay: 6,
  firstBay: 28,
};

export type ShopSide = "north" | "south";

export type Shop = {
  id: string;
  name: string;
  street: StreetId;
  side: ShopSide;
  /** Centre of the shop's front along the street. */
  x: number;
  /** Where «ورود» takes the visitor. A shop without one is not open yet. */
  href?: string;
  /** Awning / goods colour. */
  color: number;
  /** The Sarekooche shop is drawn in the house colour, with its logo. */
  brand?: boolean;
};

const bayX = (i: number) => FOOD_STREET.firstBay + i * FOOD_STREET.bay;

/**
 * ⚠️ TWO OF THESE ARE SAREKOOCHE AND THE REST ARE SCENERY. «سرکوچه» opens the
 * site's front page; «قصابی سرکوچه» opens its meat order (`?open=meat-order`,
 * which the home page already reads). The others say «به‌زودی» — they are the
 * bazaar a visitor walks through, not shops that exist.
 */
export const SHOPS: Shop[] = [
  { id: "attari", name: "عطاری", street: "food", side: "north", x: bayX(0), color: 0x8a6a3b },
  { id: "bakery", name: "نانوایی", street: "food", side: "north", x: bayX(1), color: 0xd9a55b },
  { id: "sarekooche", name: "سرکوچه", street: "food", side: "north", x: bayX(2), color: 0x00b8c8, href: "/", brand: true },
  { id: "nuts", name: "خشکبار", street: "food", side: "north", x: bayX(3), color: 0xa0522d },
  { id: "sweets", name: "قنادی", street: "food", side: "north", x: bayX(4), color: 0xe79bb0 },
  { id: "tea", name: "چایخانه", street: "food", side: "north", x: bayX(5), color: 0x7b3f2a },
  { id: "grocer", name: "بقالی", street: "food", side: "south", x: bayX(0), color: 0x6f9b54 },
  { id: "butcher", name: "قصابی سرکوچه", street: "food", side: "south", x: bayX(1), color: 0xb03a3a, href: "/?open=meat-order", brand: true },
  { id: "greens", name: "سبزی‌فروشی", street: "food", side: "south", x: bayX(2), color: 0x4f8f3a },
  { id: "fish", name: "ماهی‌فروشی", street: "food", side: "south", x: bayX(3), color: 0x3f7fa6 },
  { id: "dairy", name: "لبنیاتی", street: "food", side: "south", x: bayX(4), color: 0xe8e2cf },
  { id: "spices", name: "ادویه‌فروشی", street: "food", side: "south", x: bayX(5), color: 0xc2702a },
];

export function shopById(id: string | null | undefined): Shop | undefined {
  return SHOPS.find((s) => s.id === id);
}

export const sideSign = (side: ShopSide) => (side === "north" ? -1 : 1);

// ---------------------------------------------------------------------------
// Where one may stand

/**
 * ⚠️ THE WHOLE COLLISION MODEL, ON PURPOSE THIS SMALL: the paved ring between
 * the pool and the arcade, and the food street's floor. Everything else — a
 * closed gate, a shop counter, a wall — is simply "not in either".
 */
export function isWalkable(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r <= WALK_RADIUS && r >= FOUNTAIN_CLEAR) return true;
  return (
    x >= SQUARE_RADIUS - 3 &&
    x <= FOOD_STREET.end - 2 &&
    Math.abs(z) <= FOOD_STREET.walkHalfWidth
  );
}

export type Point = { x: number; z: number };

/**
 * One step from `from` towards `to`, as far as the plan allows. A step into a
 * wall slides along it (one axis at a time), which is what keeps walking into
 * a corner from feeling like hitting glue.
 */
export function step(from: Point, to: Point): Point {
  if (isWalkable(to.x, to.z)) return to;
  if (isWalkable(to.x, from.z)) return { x: to.x, z: from.z };
  if (isWalkable(from.x, to.z)) return { x: from.x, z: to.z };
  return from;
}

/**
 * A route from `from` to `to` that does not cross the pool: the straight line
 * when it clears it, otherwise via one point beside the pool on the side the
 * line passes nearer.
 */
export function routeAround(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return [to];
  // Nearest point of the segment to the pool's centre.
  const t = Math.max(0, Math.min(1, -(from.x * dx + from.z * dz) / len2));
  const nx = from.x + t * dx;
  const nz = from.z + t * dz;
  const miss = Math.hypot(nx, nz);
  if (miss >= FOUNTAIN_CLEAR) return [to];
  // Step out sideways from the line, on the side it already leans to.
  const len = Math.sqrt(len2);
  let px = -dz / len;
  let pz = dx / len;
  if (px * nx + pz * nz < 0) {
    px = -px;
    pz = -pz;
  }
  const out = FOUNTAIN_CLEAR + 1.5;
  return [{ x: px * out, z: pz * out }, to];
}

// ---------------------------------------------------------------------------
// Where the camera goes

export type Pose = { x: number; z: number; yaw: number; pitch: number };

/** The camera yaw that looks along (dx, dz). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Arrival: the west half of the square, looking east at the food street's
 * gate across the pool. Near enough that the gate's sign reads on a phone.
 */
export const START_POSE: Pose = { x: -9, z: 0, yaw: yawToward(1, 0), pitch: 0.06 };

/** Just inside a gate from the square, looking at it. */
export function gateFrontPose(street: Street): Pose {
  const a = (street.angle * Math.PI) / 180;
  const r = WALK_RADIUS - 3;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: yawToward(Math.cos(a), Math.sin(a)), pitch: 0.12 };
}

/** Through the food street's gate, looking down the street. */
export const FOOD_STREET_ENTRY: Pose = { x: SQUARE_RADIUS + 3, z: 0, yaw: yawToward(1, 0), pitch: 0.02 };

/**
 * Standing in the street before a shop, facing it.
 *
 * ⚠️ FROM ACROSS THE STREET, LOOKING A LITTLE UP. At arm's length the shop's
 * name board is 45° overhead and out of the picture; from the far side of the
 * street the board, the doorway and the counter are all in view.
 */
export function shopFrontPose(shop: Shop): Pose {
  const s = sideSign(shop.side);
  return { x: shop.x, z: -s * 1.8, yaw: yawToward(0, s), pitch: 0.2 };
}

/** Back out of the food street: just inside its gate, facing the pool. */
export const SQUARE_FROM_FOOD: Pose = { x: 15, z: 0, yaw: yawToward(-1, 0), pitch: 0.05 };

/**
 * WINDOW-SHOPPING STOPS along the food street: its entrance, then the middle
 * of each bay, where one shop stands on either side.
 *
 * ⚠️ ONE PRESS, ONE PAIR OF SHOPS (operator, 2026-09-27: a key press "moves a
 * lot ahead and we miss the store we wanted to visit"). A quick press of
 * forward glides to the next stop and stops there, so a visitor can walk the
 * street shop by shop instead of steering past them.
 */
export const STREET_STOPS: number[] = [
  FOOD_STREET_ENTRY.x,
  ...Array.from({ length: 6 }, (_, i) => FOOD_STREET.firstBay + i * FOOD_STREET.bay),
];

/**
 * The next stop along the street from `x`, deeper in (`dir` > 0) or back
 * towards the gate (`dir` < 0), or null at the end. A stop within half a metre
 * counts as "here", so pressing again moves on rather than nudging.
 */
export function nextStop(x: number, dir: number): number | null {
  if (dir > 0) return STREET_STOPS.find((s) => s > x + 0.5) ?? null;
  return [...STREET_STOPS].reverse().find((s) => s < x - 0.5) ?? null;
}

/**
 * Which way along the street "forward" is, for someone looking at `yaw`:
 * deeper (+1) or back towards the gate (−1). Facing a shop side-on, forward
 * means deeper in.
 */
export function streetDirection(yaw: number, forward: boolean): 1 | -1 {
  const alongX = -Math.sin(yaw); // x part of the way the camera faces
  const deeper = Math.abs(alongX) < 0.3 ? true : alongX > 0;
  return deeper === forward ? 1 : -1;
}

export type Zone = "square" | "food";

export function zoneOf(x: number, z: number): Zone {
  return x > SQUARE_RADIUS - 0.5 && Math.abs(z) < FOOD_STREET.halfWidth + 1 ? "food" : "square";
}

/** The square's side of the food street's gate — every route in or out passes it. */
export const FOOD_GATE_INSIDE: Point = { x: SQUARE_RADIUS - 4, z: 0 };

/**
 * The points to travel through from `from` to `to`, not counting `from`.
 *
 * ⚠️ A STRAIGHT LINE FROM THE SQUARE INTO THE STREET GOES THROUGH A WALL for
 * anyone not already standing in front of the gate. So a route between the
 * two passes the gate's square side first, and a route across the square
 * goes round the pool.
 */
export function planRoute(from: Point, to: Point): Point[] {
  const a = zoneOf(from.x, from.z);
  const b = zoneOf(to.x, to.z);
  if (a === b) return a === "square" ? routeAround(from, to) : [to];
  if (a === "square") return [...routeAround(from, FOOD_GATE_INSIDE), to];
  return [FOOD_GATE_INSIDE, ...routeAround(FOOD_GATE_INSIDE, to)];
}

/**
 * The walkable point nearest `to` on the line from `from` — so a tap on the
 * arcade's foot walks up to the arcade rather than doing nothing.
 */
export function nearestWalkable(from: Point, to: Point): Point {
  if (isWalkable(to.x, to.z)) return to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const x = from.x + (to.x - from.x) * mid;
    const z = from.z + (to.z - from.z) * mid;
    if (isWalkable(x, z)) lo = mid;
    else hi = mid;
  }
  return { x: from.x + (to.x - from.x) * lo, z: from.z + (to.z - from.z) * lo };
}

// ---------------------------------------------------------------------------
// The spot in the address bar, so «برگشت» from a shop lands in front of it

export type Spot = { kind: "shop"; shop: Shop } | { kind: "street"; street: Street };

export function spotParam(spot: Spot): string {
  return spot.kind === "shop" ? `shop:${spot.shop.id}` : `street:${spot.street.id}`;
}

export function parseSpot(value: string | null | undefined): Spot | null {
  if (!value) return null;
  const [kind, id] = value.split(":");
  if (kind === "shop") {
    const shop = shopById(id);
    return shop ? { kind: "shop", shop } : null;
  }
  if (kind === "street") {
    const street = streetById(id);
    return street?.open ? { kind: "street", street } : null;
  }
  return null;
}

export function poseForSpot(spot: Spot | null): Pose {
  if (!spot) return START_POSE;
  if (spot.kind === "shop") return shopFrontPose(spot.shop);
  return FOOD_STREET_ENTRY;
}
