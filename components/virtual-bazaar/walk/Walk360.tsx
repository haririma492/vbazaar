"use client";

/**
 * THE 360° WALK — the real video, not a reconstruction.
 *
 * The operator walked the place with an Insta360; this plays that walk back as
 * an equirectangular video wrapped round the visitor, at the camera's own
 * quality. The visitor cannot step off the path the camera took, but along it
 * everything is exactly as filmed:
 *
 *   stick up      walk on (the video plays forward; further up, faster)
 *   stick down    walk back (it plays backward)
 *   let go        stand still (it pauses)
 *   stick ←/→, a finger, or the phone itself   look round
 *   the bar at the bottom                      jump along the path
 *
 * ⚠️ BACKWARD IS SEEKING, NOT PLAYING. No browser plays a video in reverse, so
 * walking back steps `currentTime` down one seek at a time. It is only smooth
 * when the video has a keyframe every few frames: `scripts/splats/walk-video.md`
 * gives the ffmpeg line (`-g 10`). A camera's own file (a keyframe every
 * second or two) walks back in jerks.
 *
 * STEPPING INTO A SHOP (founder, 2026-10-10: "360 video mp4 quality and choice
 * to break away and enter in a shop"). `scenes/walks.json`
 * (`lib/splats/walks.ts`) puts DOORS on a walk: a moment of the video and a
 * direction in it. Near one, looking its way, «Step inside» cross-fades to
 * the shop's own video at its start; «Back to the street» cross-fades back to
 * the street at the door, still facing the row of shops. The shop's video starts loading
 * 6 s before its door, so the step is immediate.
 *
 *   ⚠️ ONE VIDEO PLAYS AT A TIME. The next one only loads (paused) while the
 *   visitor nears a door; the one left behind is released — its decoder
 *   memory too — as soon as the cross-fade ends. Two 8K videos at once crash
 *   a phone.
 *
 *   ⚠️ THE SPHERE TURNS, NOT THE VISITOR. Each video's sphere has a `spin`, so
 *   whatever the visitor faces when they step in becomes the shop video's
 *   forward: the view never jumps. Coming back out, the visitor faces what
 *   they faced going in — the shops, not the far side of the street. Doors are stored in the video's OWN frame (`yaw`, positive right),
 *   so `videoYaw = heading + spin`.
 *
 *   A SHOP FILMED WITH A PHONE (founder, 2026-10-10: the first interiors are
 *   iPhone videos) is FLAT, not 360°: a door to a phone video (`.mov`, kept
 *   privately by the uploader and shown through `/api/splats/walks/video`),
 *   a door ticked «flat», or any video that is not 2:1 is shown full screen
 *   as a plain <video> over the sphere — the same stick, the same fades, no
 *   looking round.
 *
 *   /vca/walk                               the walk visitors start on (walks.json `start`, else `startOf`'s street)
 *   /vca/walk?v=scenes/<scene>/<file>.mp4   a video in the scenes bucket
 *   /vca/walk?src=<url>                     any video (https, or this site); no doors
 *   …&debug=1                               resolution, buffering, rate
 *   …&edit=1                                place doors (operator token, like /vca/splat)
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import SteeringWheel from "./SteeringWheel";
import { ItemCard, ItemsEditor, PRODUCTS_PANEL_SHIFT } from "./WalkItems";
import { SoundEditor, WalkSound, sayAloud } from "./WalkSound";
import { CutEditor } from "./WalkCut";
import { EAC_GLSL, type Projection } from "@/lib/splats/projection";
import { STORE_RE, checkCatalogue, productOf, storeOfScene, unitPriceSay, type Aisle, type Catalogue } from "@/lib/splats/catalogue";
import { TURN_COLS, bandProfile, ringShift, turnRate } from "@/lib/splats/walkTurn";
import { deviceQuaternion, hasDeviceOrientation, requestDeviceOrientation, screenAngle } from "../scene/deviceOrientation";
import { armAdminMode, readAdminToken } from "@/lib/admin/useAdminMode";
import {
  DEFAULT_PITCH, DOOR_SIZE, PRELOAD_DT, addDoor, angleDiff, doorsAround, signAt, sortPins, startOf, type SignPin, doorsNear, emptyWalks, isFlatDoor, isSiteOnlyDoor, isSiteUrl, isPhoneCopy, isPhoneVideoKey, isVideoKey, isWalkKey,
  itemsAt, specialSay, type ItemPin, type WalkItem, looksFlat, parseWalks, phoneKeyOf, removeDoor, returnPoint, setProjection, setHide, setTagsFrom, setTilt, hideFacing, hideAt, HIDE_WIDTH, HIDE_TOP, setStart, updateDoor, walkOf, wrapAngle, type WalkDoor, type Walks,
} from "@/lib/splats/walks";

/**
 * How fast the pedal plays the walk (1 = as filmed). One speed: the founder
 * (2026-10-10) found the Slow/Normal/Fast button extra next to self-drive's
 * slow and fast.
 */
const PEDAL_RATE = 1;
/**
 * SELF-DRIVE (founder, 2026-10-10: "add two self drive button below the
 * wheel one slow one faster however, still shopper can enter a store while
 * on self drive"): the walk plays on by itself; the wheel, the pedals and the
 * keys still work over it, and a tap on a door's sign still steps inside
 * (which ends the drive — the shop is looked round, not driven through).
 */
const DRIVES = {
  slow: { rate: 0.4, label: "▶ آهسته · Auto slow" }, // 0.6 until 2026-11-01 (owner: "a bit slower")
  fast: { rate: 1.5, label: "▶▶ تند · Auto fast" },
  // Walking back by itself (owner, 2026-11-01: "add a key under the steering wheel for going backward").
  back: { rate: -0.6, label: "◀ عقب · Back" },
} as const;
type Drive = keyof typeof DRIVES;
/** Full steering turns this fast (rad/s). */
const TURN_RATE = 0.8;
/** How long starting, stopping and turning take to settle (s). */
const EASE_S = 0.35;
/** Facing further than this from the video's forward (rad, ~100°), walking on plays the walk backwards; back under ~80°, forwards again. */
const FACE_BACK = 1.75;
/** Below this the walk stands still. */
const DEAD = 0.04;
/** Forward slower than this is stepped like backward: browsers play no slower smoothly. */
const MIN_PLAY_RATE = 0.25;
/** The cross-fade between the street and a shop (ms). */
const FADE_MS = 400;
/** A door's sign floats this far out, in the direction its pins give (`signAt`). */
const MARK_R = 20;
/**
 * ⚠️ THE OPERATOR UNDER THE CAMERA (founder, 2026-10-21: "remove my top of head
 * (the photographer) from this view … filming is done, block that view now").
 * The walks were filmed with the camera held over the head, so the head sits
 * straight down. A dark cap covers the floor this many degrees round it on
 * every 360° walk, solid inside `NADIR_SOLID` and fading out to the edge.
 * `?nadir=<deg>` tries another size (0 = off).
 */
const NADIR_DEG = 30;
const NADIR_SOLID = 0.7;
const UP = new THREE.Vector3(0, 1, 0);
/** `?v=` as it was always accepted (a little looser than `isWalkKey`). */
const V_RE = /^scenes\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/;

function safeSrc(raw: string): string | null {
  try {
    const u = new URL(raw, window.location.href);
    if (u.protocol === "https:" || u.origin === window.location.origin) return u.href;
    if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) return u.href;
  } catch {
    /* fall through */
  }
  return null;
}

let basePromise: Promise<string | null> | null = null;
/** The scenes bucket's public address (`/api/splats/config`), asked once. */
function sceneBase(): Promise<string | null> {
  basePromise ??= fetch("/api/splats/config", { cache: "no-store" })
    .then((r) => r.json() as Promise<{ base: string | null }>)
    .then(({ base }) => (base ? base.replace(/\/+$/, "") : null))
    .catch(() => null);
  return basePromise;
}

/** A walk sound's address (`Walk.audio`), in the public bucket. */
async function soundSrc(key: string): Promise<string | null> {
  const base = await sceneBase();
  return base ? `${base}/${key}` : null;
}

const isTouch = () => (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) ?? false;

const phoneCopies = new Map<string, Promise<boolean>>();
/** Whether the lighter phone copy (`<name>-phone.mp4`) was uploaded next to a walk: one HEAD, remembered. */
function hasPhoneCopy(url: string): Promise<boolean> {
  let p = phoneCopies.get(url);
  if (!p) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    p = fetch(url, { method: "HEAD", signal: ac.signal, cache: "no-store" }).then((r) => r.ok).catch(() => false).finally(() => clearTimeout(timer));
    phoneCopies.set(url, p);
  }
  return p;
}

/**
 * Where a video key is played from. A phone (a touch screen) gets the 4K
 * `-phone.mp4` copy when one was uploaded next to the original — same
 * timeline, same frame, so the doors fit both. A phone video of a shop
 * (`masters/…`) comes through the server's short-lived link.
 */
/** `rev`: the walk's cut count (`Walk.rev`) — a cut video keeps its name, so the address changes instead. */
async function srcFor(key: string, rev?: number): Promise<string | null> {
  if (isPhoneVideoKey(key)) return `/api/splats/walks/video?key=${encodeURIComponent(key)}`;
  const base = await sceneBase();
  if (!base) return null;
  const r = rev ? `?r=${rev}` : "";
  if (isTouch() && !isPhoneCopy(key)) {
    const phone = `${base}/${phoneKeyOf(key)}${r}`;
    if (await hasPhoneCopy(phone)) return phone;
  }
  return `${base}/${key}${r}`;
}

async function loadWalks(): Promise<Walks> {
  try {
    const res = await fetch("/api/splats/walks", { cache: "no-store" });
    const json = await res.json();
    return json?.ok ? parseWalks(json.walks) : emptyWalks();
  } catch {
    // ⚠️ NO WALKS IS NOT AN ERROR: the single-video walk works without them.
    return emptyWalks();
  }
}

const mmss = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "–:––");
/** A shop's website, in a new tab that cannot reach back into the walk. */
function openSite(url: string | null | undefined) {
  if (isSiteUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
}

const shortKey = (k: string | null) => (k ? k.replace(/^(scenes|masters)\//, "") : "(a video by address)");

/** One video on screen (or loading for it): a sphere round the visitor, or flat over everything. */
type Layer = {
  key: string | null;
  video: HTMLVideoElement;
  /** Flat by its door or its key; else decided by its shape when its size is known. */
  forcedFlat: boolean;
  flat: boolean;
  spin: number;
  texture: THREE.VideoTexture | null;
  material: THREE.MeshBasicMaterial | null;
  mesh: THREE.Mesh | null;
  ready: Promise<void>;
  fail: (why: string) => void;
  released: boolean;
  purpose: "main" | "door" | "back";
  /** How it holds its picture when its shape does not say (its walk's `projection`, or ?proj= to try one). */
  projection: Projection | null;
};

/**
 * A PRICE TAG ON A STICK (founder, 2026-10-18: "the label need to be pined on
 * the product on top of product … we need like a stick that holds the price
 * tag up attached to the product"): the tag — name and price, or for a special
 * a red «SPECIAL» with the old price crossed out — held up on a stick whose
 * foot (a dot) is the product's own spot. Drawn once; `foot` is where that
 * spot is, as a share of the height from the bottom (`Sprite.center`).
 */
const TAG_W = 560;
function tagTexture(item: WalkItem, listPrice?: string): { texture: THREE.CanvasTexture; aspect: number; foot: number } {
  const sp = item.special;
  const en = item.label.en.length > 22 ? `${item.label.en.slice(0, 21)}…` : item.label.en;
  const price = sp?.now ?? listPrice ?? "";
  const tagH = sp ? 330 : price ? 220 : 140;
  const stick = 150, dot = 22;
  const c = document.createElement("canvas");
  c.width = TAG_W;
  c.height = tagH + stick + dot * 2;
  const g = c.getContext("2d")!;
  const box = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  // The stick, then the foot on the product.
  const cx = TAG_W / 2, footY = tagH + stick + dot;
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fillRect(cx - 5, tagH - 4, 14, stick + 4);
  g.fillStyle = "#f4f4f4";
  g.fillRect(cx - 7, tagH - 4, 14, stick + 4);
  g.beginPath();
  g.arc(cx, footY, dot, 0, Math.PI * 2);
  g.fillStyle = sp ? "#d61424" : "#00B8C8";
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = "#fff";
  g.stroke();
  // The tag.
  box(8, 8, TAG_W - 16, tagH - 16, 30);
  g.fillStyle = sp ? "rgba(214,20,36,0.95)" : "rgba(10,22,28,0.9)";
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = sp ? "#fff" : "#00B8C8";
  g.stroke();
  g.textAlign = "center";
  if (sp) {
    g.fillStyle = "#ffe14d";
    g.font = "900 64px system-ui, sans-serif";
    g.fillText("SPECIAL", cx, 84);
    g.fillStyle = "#fff";
    g.font = "700 40px system-ui, sans-serif";
    g.fillText(en, cx, 146);
    g.font = "600 44px system-ui, sans-serif";
    g.fillStyle = "rgba(255,255,255,0.8)";
    const wasW = g.measureText(sp.was).width;
    g.fillText(sp.was, cx, 210);
    g.fillRect(cx - wasW / 2 - 6, 194, wasW + 12, 5);
    g.fillStyle = "#fff";
    g.font = "900 84px system-ui, sans-serif";
    g.fillText(sp.now, cx, 298);
  } else {
    g.fillStyle = "#fff";
    g.font = "700 46px system-ui, sans-serif";
    g.fillText(en, cx, price ? 84 : 88);
    if (price) {
      g.fillStyle = "#ffd75e";
      g.font = "900 76px system-ui, sans-serif";
      g.fillText(price, cx, 176);
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: c.height / c.width, foot: 1 - footY / c.height };
}

/** What the screen shows about the engine, a few times a second. */
type View = {
  key: string | null;
  inside: number;
  flat: boolean;
  near: WalkDoor[];
  /** Inside a shop: the website its door names, if any. */
  site: string | null;
  atEnd: boolean;
  busy: boolean;
};

type Engine = {
  video: () => HTMLVideoElement;
  setMove: (x: number, y: number) => void;
  setGyro: (on: boolean) => void;
  /** Self-drive at this rate (times as filmed), or null: only the wheel's pedals and the keys walk. */
  setDrive: (rate: number | null) => void;
  /** Inside a tap: start the video, so a phone that refuses play() without one lets it walk on. */
  kick: () => void;
  /** The photographer's turn at this moment of the walk (rad/s, + right), read from the picture. */
  turn: () => number;
  setWalks: (w: Walks) => void;
  enter: (door: WalkDoor) => void;
  back: () => void;
  /** Cross-fade to another walk video from its start — the next or previous aisle of a store. */
  goToWalk: (key: string) => void;
  /** Where the visitor is, in the current video's own frame (the operator's «Door here»). */
  here: () => { key: string | null; t: number; yaw: number; pitch: number; flat: boolean; projection: Projection | null };
  /** The locked zone (`Walk.hide`) off, while the operator sets it. */
  setLockOff: (off: boolean) => void;
  /** Jump to a door's moment and face it. */
  goTo: (door: WalkDoor) => void;
  /** Edit mode: the next tap on the picture is a sign pin (null: taps are a visitor's again). */
  setPick: (f: ((pin: SignPin) => void) | null) => void;
  /** Edit mode: the door being placed, its sign shown as it is pinned. */
  setPreview: (door: WalkDoor | null) => void;
  /** Edit mode: the next tap on the picture is an item's pin (`ItemPin`: a fraction of a flat frame, or a direction). */
  setItemPick: (f: ((pin: ItemPin) => void) | null) => void;
  /** Edit mode: the item being placed, its dot shown as it is pinned. */
  setItemPreview: (item: WalkItem | null) => void;
  /** A tap on an item's dot. */
  setOnItem: (f: ((item: WalkItem) => void) | null) => void;
  /** What an item's tag says as its price: the store's list where it has one (`productOf`), else its own. */
  setPriceText: (f: (item: WalkItem) => string | undefined) => void;
  /** What an item's tag says as its name: the store's list where it has one (the owner names products found in a video). */
  setLabelOf: (f: (item: WalkItem) => WalkItem["label"]) => void;
  /** Jump to a moment of this video (stands there). */
  seek: (t: number) => void;
};

/**
 * THE STORE'S REAL DOOR on the hallway wall (owner, 2026-10-30: "the door of
 * the store should be EXACTLY as the real door of each store"): its photo,
 * `door.size` radians wide (`DOOR_SIZE` when not given), its height from the
 * photo's own shape once it has loaded. Until then it is a blank of a door's
 * shape, so nothing jumps.
 */
function doorTexture(door: WalkDoor, setSize: (w: number, h: number) => void): THREE.Texture {
  const w = 2 * MARK_R * Math.tan((door.size ?? DOOR_SIZE) / 2);
  setSize(w, w * 1.6);
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const t = loader.load(door.image!, (tex) => {
    const img = tex.image as { width: number; height: number };
    if (img?.width) setSize(w, (w * img.height) / img.width);
  });
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A door's sign — «Step inside · name» (and the Persian name) on an amber card — drawn once. */
function signTexture(en: string, fa?: string, site = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 300;
  const g = c.getContext("2d")!;
  const r = 36;
  g.beginPath();
  g.moveTo(r, 8);
  g.arcTo(632, 8, 632, 292, r);
  g.arcTo(632, 292, 8, 292, r);
  g.arcTo(8, 292, 8, 8, r);
  g.arcTo(8, 8, 632, 8, r);
  g.closePath();
  g.fillStyle = "rgba(120,72,6,0.72)";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "rgba(252,211,77,0.95)";
  g.stroke();
  g.textAlign = "center";
  g.fillStyle = "rgba(255,251,235,1)";
  g.shadowColor = "rgba(0,0,0,0.8)";
  g.shadowBlur = 8;
  g.font = "700 54px system-ui, sans-serif";
  g.fillText(site ? "Visit website ↗" : "Step inside ›", 320, fa ? 92 : 112);
  g.font = "600 50px system-ui, sans-serif";
  g.fillText(en.length > 20 ? `${en.slice(0, 19)}…` : en, 320, fa ? 168 : 200);
  if (fa) {
    g.font = "600 46px system-ui, sans-serif";
    g.direction = "rtl";
    g.fillText(`${site ? "وبسایت" : "ورود"} · ${fa.length > 18 ? `${fa.slice(0, 17)}…` : fa}`, 320, 246);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function Walk360() {
  const host = useRef<HTMLDivElement>(null);
  const flatHost = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "walking" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [time, setTime] = useState({ now: 0, total: 0 });
  const [drive, setDrive] = useState<Drive | null>(null);
  /** The item whose card is open (a tap on its dot). */
  const [card, setCard] = useState<WalkItem | null>(null);
  /** The product list of the store this video belongs to (`lib/splats/catalogue.ts`), or null. */
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  /** The store's aisles (its shelf videos, in order), for Next / Previous. */
  const [aisles, setAisles] = useState<Aisle[]>([]);
  const [debug, setDebug] = useState(false);
  const [info, setInfo] = useState("");
  const [diag, setDiag] = useState("");
  const [view, setView] = useState<View>({ key: null, inside: 0, flat: false, near: [], site: null, atEnd: false, busy: false });
  const [walks, setWalks] = useState<Walks>(emptyWalks());
  const [editing, setEditing] = useState(false);
  /** ?spots=1 (the operator, from /stores/areas): «Door spot here» marks where a store's door can go on the hallway. */
  const [spotMode, setSpotMode] = useState(false);
  const [spotSaid, setSpotSaid] = useState<string | null>(null);
  /** ?edit=1 in a browser not signed in as operator: ask here, rather than show nothing. */
  const [needSignIn, setNeedSignIn] = useState(false);
  /** The walks as last read from (or saved to) the server: the `base` of a merged save. */
  const serverWalks = useRef<Walks>(emptyWalks());

  useEffect(() => {
    const el = host.current;
    const flatEl = flatHost.current;
    if (!el || !flatEl) return;
    const params = new URLSearchParams(window.location.search);
    const debugOn = params.get("debug") === "1";
    setDebug(debugOn);
    // ?debug=1&fade=<ms>: a slower cross-fade, to look at it (and screenshot it).
    const fadeMs = params.get("debug") === "1" && Number(params.get("fade")) > 0 ? Math.min(10000, Number(params.get("fade"))) : FADE_MS;
    setEditing(params.get("edit") === "1" && Boolean(readAdminToken()));
    // ⚠️ SAY SO (founder, 2026-10-12, on staging: "this does not have the panel …
    // although operator is logged in"). The sign-in is kept per site address;
    // without it the edit panel silently did not appear.
    setNeedSignIn((params.get("edit") === "1" || params.get("spots") === "1") && !readAdminToken());
    setSpotMode(params.get("spots") === "1" && Boolean(readAdminToken()));
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, el.clientWidth / el.clientHeight, 0.1, 200);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const geometry = new THREE.SphereGeometry(50, 128, 64);
    geometry.scale(-1, 1, 1); // seen from inside

    // The cap over the operator's head (`NADIR_DEG`): over the videos (0, 1),
    // under the doors' signs and the price tags (10, 11).
    /** Edit mode, Lock tab open: the view turns freely, to find the photographer. */
    let lockOff = false;
    const nadirParam = params.get("nadir");
    const nadirDeg = nadirParam !== null && Number.isFinite(Number(nadirParam)) ? THREE.MathUtils.clamp(Number(nadirParam), 0, 90) : NADIR_DEG;
    const nadirRad = THREE.MathUtils.degToRad(nadirDeg);
    const nadirCanvas = document.createElement("canvas");
    nadirCanvas.width = 1;
    nadirCanvas.height = 64;
    const nctx = nadirCanvas.getContext("2d")!;
    // The canvas's top is the cap's edge, its bottom straight down.
    const ngrad = nctx.createLinearGradient(0, 0, 0, 64);
    ngrad.addColorStop(0, "rgba(22,22,24,0)");
    ngrad.addColorStop(1 - NADIR_SOLID, "rgba(22,22,24,1)");
    ngrad.addColorStop(1, "rgba(22,22,24,1)");
    nctx.fillStyle = ngrad;
    nctx.fillRect(0, 0, 1, 64);
    const nadirTexture = new THREE.CanvasTexture(nadirCanvas);
    nadirTexture.colorSpace = THREE.SRGBColorSpace;
    const nadirGeometry = new THREE.SphereGeometry(45, 64, 8, 0, Math.PI * 2, Math.PI - Math.max(nadirRad, 1e-3), Math.max(nadirRad, 1e-3));
    nadirGeometry.scale(-1, 1, 1);
    const nadirMaterial = new THREE.MeshBasicMaterial({ map: nadirTexture, transparent: true, depthTest: false, depthWrite: false });
    const nadir = new THREE.Mesh(nadirGeometry, nadirMaterial);
    nadir.renderOrder = 5;
    nadir.visible = false;
    scene.add(nadir);

    let walksNow: Walks = emptyWalks();
    let current: Layer | null = null;
    let pending: Layer | null = null;
    /** The doors stepped through, innermost last: «Back to the street» pops one. */
    const trail: Array<{ key: string; door: WalkDoor; yaw: number }> = [];
    let busy = false;
    let fade: { from: Layer; to: Layer; start: number; done: () => void } | null = null;

    // ── A video: made, loaded (paused, at its moment), shown, released ────
    const errorText = (l: Layer) => {
      if (l.key && /\.mov$/i.test(l.key)) {
        return "This browser cannot play this shop's video (an iPhone .mov, usually HEVC: Safari plays it, Chrome often does not). Export it from the iPhone as an .mp4 (H.264, «Most Compatible») and upload that.";
      }
      if (l.purpose === "main") return "The walk video could not be loaded. Is the bucket's CORS set, and is the file an MP4 (H.264)?";
      return "This video could not be loaded in this browser. An .mp4 in H.264 plays everywhere.";
    };

    /**
     * Why a walk video did not load: the bucket refusing this site (CORS), the
     * file not being in the bucket this site reads, or the file itself.
     */
    async function diagnose(src: string): Promise<string> {
      const host = (() => { try { return new URL(src).host; } catch { return src; } })();
      const site = window.location.origin;
      try {
        const res = await fetch(src, { method: "HEAD", mode: "cors", cache: "no-store" });
        if (res.status === 404) return `The video is not in the bucket this site reads (${host}): 404 for ${src}. Upload it there, or point this site at the bucket that has it.`;
        if (!res.ok) return `The bucket (${host}) answered ${res.status} for the video.`;
        return "The video was found, but this browser cannot play it. An .mp4 in H.264 plays everywhere.";
      } catch {
        return `The bucket (${host}) does not let this site (${site}) load its videos. In Cloudflare → R2 → the bucket → Settings → CORS policy, add "${site}" to AllowedOrigins.`;
      }
    }

    function makeLayer(opts: { key: string | null; src?: string | null; t?: number; flat?: boolean; purpose: Layer["purpose"] }): Layer {
      const phoneVideo = Boolean(opts.key && isPhoneVideoKey(opts.key));
      const video = document.createElement("video");
      // A sphere's WebGL texture needs the bucket's CORS. A phone video is
      // only ever shown flat (a plain <video>), so it asks for none — its
      // signed link is to the private bucket.
      if (!phoneVideo) video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "auto";
      video.loop = false;
      Object.assign(video.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", background: "#000", opacity: "0" });
      const forcedFlat = Boolean(opts.flat) || phoneVideo;
      const at = Math.max(0, opts.t ?? 0);
      // ?proj= tries a projection on the video in the address (the operator's «Which looks right?»).
      const tried = opts.purpose === "main" && opts.key && opts.key === params.get("v") ? params.get("proj") : null;
      const projection = (tried === "eac" || tried === "equirect" || tried === "flat" ? tried : walkOf(walksNow, opts.key)?.projection) ?? null;
      const layer: Layer = {
        key: opts.key, video, forcedFlat, flat: forcedFlat || projection === "flat", spin: 0, texture: null, material: null, mesh: null,
        ready: Promise.resolve(), fail: () => {}, released: false, purpose: opts.purpose, projection,
      };
      layer.ready = new Promise<void>((resolve, reject) => {
        let settled = false;
        const timers: number[] = [];
        const finish = (why?: string) => {
          if (settled) return;
          settled = true;
          timers.forEach((t) => window.clearTimeout(t));
          if (why) reject(new Error(why));
          else resolve();
        };
        layer.fail = finish;
        const check = () => {
          if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - Math.min(at, video.duration || at)) < 0.5) finish();
        };
        video.addEventListener("loadedmetadata", () => {
          // Its walk may say (a YouTube 360° download is 16:9, which would look flat).
          layer.flat = forcedFlat || (projection ? projection === "flat" : looksFlat(video.videoWidth, video.videoHeight));
          if (at > 0) video.currentTime = Math.min(at, Math.max(0, video.duration - 0.05));
          check();
        });
        for (const ev of ["loadeddata", "canplay", "seeked"]) video.addEventListener(ev, check);
        video.addEventListener("error", () => {
          // The walk's own video: find out WHY, and say it (staging, 2026-10-12, got
          // only "is the bucket's CORS set" — which of the causes it was, nobody could tell).
          if (layer.purpose === "main" && video.currentSrc && !/\.mov$/i.test(layer.key ?? "")) void diagnose(video.currentSrc).then((why) => finish(why));
          else finish(errorText(layer));
        });
        // iOS may not decode a frame of a video nobody plays: play a moment, then stand.
        timers.push(window.setTimeout(() => {
          if (settled || layer.released || video.readyState >= 2) return;
          video.play().then(() => {
            video.pause();
            video.currentTime = at;
          }).catch(() => {});
        }, 1500));
        timers.push(window.setTimeout(() => finish("The video took too long to load."), 45000));
      });
      layer.ready.catch(() => {}); // a preload nobody used fails quietly
      void (async () => {
        const src = opts.src !== undefined ? opts.src : opts.key ? await srcFor(opts.key, walkOf(walksNow, opts.key)?.rev) : null;
        if (layer.released) return;
        if (!src) return layer.fail("No address for the video: is NEXT_PUBLIC_SPLAT_BASE_URL set?");
        video.src = src;
        video.load();
      })();
      return layer;
    }

    /** Put a loaded layer on screen, invisible: the cross-fade brings it in. */
    function show(l: Layer, opacity: number) {
      if (l.flat) {
        l.video.style.opacity = String(opacity);
        flatEl!.appendChild(l.video);
        return;
      }
      const texture = new THREE.VideoTexture(l.video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.anisotropy = maxAniso;
      texture.needsUpdate = true; // the paused frame, before any new one is presented
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, depthTest: false, depthWrite: false });
      // ⚠️ YOUTUBE'S CUBE MAP: the sphere keeps its panorama uv, and each pixel
      // looks itself up in the 3×2 cube-map frame instead (`EAC_GLSL`), so the
      // front, doors and dots stay where a panorama would put them.
      if (l.projection === "eac") {
        material.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader
            .replace("void main() {", `${EAC_GLSL}\nvoid main() {`)
            .replace("#include <map_fragment>", `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, eacUv( vMapUv ) );
  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif
`);
        };
        material.customProgramCacheKey = () => "eac";
      }
      const mesh = new THREE.Mesh(geometry, material);
      // The middle of an equirectangular frame is where the camera faced; turn
      // it to −Z, where a three.js camera looks at yaw 0 — then by its spin.
      mesh.rotation.y = -Math.PI / 2 + l.spin;
      Object.assign(l, { texture, material, mesh });
      scene.add(mesh);
    }

    /** Let go of a video entirely — its download and its decoder memory. */
    function release(l: Layer | null) {
      if (!l || l.released) return;
      l.released = true;
      l.fail("released");
      l.video.pause();
      l.video.removeAttribute("src");
      l.video.load();
      l.video.remove();
      if (l.mesh) scene.remove(l.mesh);
      l.texture?.dispose();
      l.material?.dispose();
      l.mesh = null;
    }

    const lookDir = new THREE.Vector3();
    /** Which way the visitor faces: 0 is −Z, positive right. */
    const heading = () => {
      camera.getWorldDirection(lookDir);
      return Math.atan2(lookDir.x, -lookDir.z);
    };
    const videoYaw = () => (current ? wrapAngle(heading() + current.spin) : 0);

    function crossFade(from: Layer, to: Layer): Promise<void> {
      // A flat video always lies over the sphere: going from flat back to a
      // sphere, the sphere is drawn whole underneath and the flat one fades out.
      show(to, to.flat || !from.flat ? 0 : 1);
      if (to.mesh) to.mesh.renderOrder = 1;
      if (from.mesh) from.mesh.renderOrder = 0;
      return new Promise((done) => (fade = { from, to, start: performance.now(), done }));
    }

    async function switchTo(to: Layer, spinFor: (l: Layer) => number) {
      const from = current!;
      busy = true;
      report(true);
      from.video.pause();
      rate = 0;
      stepDebt = 0;
      try {
        await to.ready;
      } catch (e) {
        release(to);
        busy = false;
        if ((e as Error).message !== "released") setNotice((e as Error).message);
        report(true);
        return false;
      }
      if (disposed) return false;
      to.spin = spinFor(to);
      await crossFade(from, to);
      current = to;
      release(from);
      if (to.mesh) to.mesh.renderOrder = 0;
      setInfo(`${to.video.videoWidth}×${to.video.videoHeight} · ${mmss(to.video.duration)}${to.flat ? " · flat" : ""}`);
      busy = false;
      return true;
    }

    async function enter(door: WalkDoor) {
      // A door with no shop video is the shop's website: a new tab, the walk
      // stays where it is.
      if (isSiteOnlyDoor(door)) return openSite(door.url);
      if (busy || !current?.key || !door.to) return;
      const fromKey = current.key;
      let to = pending && pending.key === door.to && pending.purpose === "door" ? pending : null;
      pending = to ? null : pending;
      if (!to) {
        release(pending);
        pending = null;
        to = makeLayer({ key: door.to, t: 0, flat: isFlatDoor(door), purpose: "door" });
      }
      if (isFlatDoor(door)) to.forcedFlat = to.flat = true;
      // What the visitor faces now becomes the shop video's forward — and is
      // what they face again when they come back out.
      const h = heading();
      const yawIn = videoYaw();
      if (await switchTo(to, () => -h)) trail.push({ key: fromKey, door, yaw: yawIn });
      report(true);
    }

    /**
     * Another aisle of the store: the same cross-fade as a door, from its start,
     * and no way «back» (the aisles are side by side, not one inside another).
     * The address follows, so a reload or the edit link stays on this aisle.
     */
    async function goToWalk(key: string) {
      if (busy || !current || current.key === key) return;
      release(pending);
      pending = null;
      trail.length = 0;
      const to = makeLayer({ key, t: 0, purpose: "main" });
      const h = heading();
      if (await switchTo(to, () => -h)) {
        try {
          const u = new URL(window.location.href);
          u.searchParams.set("v", key);
          window.history.replaceState(null, "", u.toString());
        } catch { /* the address is a convenience */ }
      }
      report(true);
    }

    /**
     * THE WALKS JOINED (owner, 2026-10-30: "connect the area's nicely and
     * seamlessly"): at the end of a walk whose `next` is set, the next one
     * starts from its beginning with the same spin, so the visitor keeps
     * facing the same way and walks on (outside → lobby → hallway).
     */
    let carrying = false;
    async function carryOn(key: string) {
      if (busy || carrying || !current || current.key === key) return;
      carrying = true;
      let to = pending && pending.key === key && pending.purpose === "main" ? pending : null;
      pending = to ? null : pending;
      if (!to) {
        release(pending);
        pending = null;
        to = makeLayer({ key, t: 0, purpose: "main" });
      }
      const spin = current.spin;
      const playing = rate > 0;
      if (await switchTo(to, () => spin)) {
        try {
          const u = new URL(window.location.href);
          u.searchParams.set("v", key);
          window.history.replaceState(null, "", u.toString());
        } catch { /* the address is a convenience */ }
        if (playing) current?.video.play().catch(() => {});
      }
      carrying = false;
      report(true);
    }

    async function back() {
      const top = trail[trail.length - 1];
      if (busy || !top || !current) return;
      const rp = top.door.back ?? { t: returnPoint(top.door).t, yaw: top.yaw };
      let to = pending && pending.key === top.key && pending.purpose === "back" ? pending : null;
      pending = to ? null : pending;
      if (!to) {
        release(pending);
        pending = null;
        to = makeLayer({ key: top.key, t: rp.t, purpose: "back" });
      }
      // The shops they faced going in appear where the visitor faces now.
      const h = heading();
      if (await switchTo(to, () => rp.yaw - h)) trail.pop();
      report(true);
    }

    // ── Telling the screen ────────────────────────────────────────────────
    let shownAt = 0;
    let lastView = "";
    function report(force = false) {
      const now = performance.now();
      if (!force && now - shownAt < 250) return;
      shownAt = now;
      const v = current?.video;
      if (v) setTime({ now: v.currentTime, total: v.duration });
      const walk = walkOf(walksNow, current?.key);
      const near = current && !busy && v && v.readyState >= 1 ? doorsNear(walk, v.currentTime, videoYaw(), current.flat ? { dyaw: 4 } : {}) : [];
      const atEnd = Boolean(v && trail.length && Number.isFinite(v.duration) && v.currentTime >= v.duration - 0.3);
      const onward = !trail.length && walk?.next && v && Number.isFinite(v.duration) && v.currentTime >= v.duration - 0.15 ? walk.next : null;
      if (onward && !busy) void carryOn(onward);
      const site = trail[trail.length - 1]?.door.url ?? null;
      const next: View = { key: current?.key ?? null, inside: trail.length, flat: current?.flat ?? false, near, site, atEnd, busy };
      if (debugOn && v) {
        setDiag(`rate ${rate.toFixed(2)} → ${(drive ?? 0).toFixed(1)} · ${facingBack ? "facing back" : "facing on"} · yaw ${Math.round((videoYaw() * 180) / Math.PI)}° · ${v.paused ? "paused" : `playing ×${v.playbackRate.toFixed(2)}`}${playRefused === v ? " · play refused" : ""}${gyroOn && gyroHave ? " · phone motion" : ""} · ready ${v.readyState}` +
          // The items on this walk: how many, which are on screen now, and when each one's dot shows.
          ` · ${current?.flat ? "flat" : "360°"} · items ${(walk?.items ?? []).length}` +
          `${(walk?.items ?? []).map((it) => ` [${it.label.en}: ${it.pins.length ? `${it.pins[0].t.toFixed(1)}–${it.pins[it.pins.length - 1].t.toFixed(1)}s` : "no dot"}]`).join("")}` +
          ` · shown now ${itemButtons.size + itemSprites.size}`);
      }
      const s = JSON.stringify(next);
      if (s !== lastView) {
        lastView = s;
        setView(next);
      }
    }

    // ── Doors on the sphere, and the next video loading ahead ─────────────
    // ⚠️ THE SIGN IS ON THE DOOR, AND IT IS THE BUTTON (founder, 2026-10-10:
    // "I need ability to move the Step Inside rectangle exactly where the door
    // is"). Each door's «Step inside» card sits where `signAt` says — between
    // the pins the operator put on the door — and a tap on it steps inside.
    const markers = new Map<string, { sprite: THREE.Sprite; door: WalkDoor }>();
    let preview: WalkDoor | null = null;
    let pick: ((pin: SignPin) => void) | null = null;

    // ── Items you can pick up: a dot on each, a tap opens its card ────────
    // On a 360° walk a sprite like a door's sign; on a flat video a button
    // over the picture, where the pins put it (fractions of the frame).
    let itemPick: ((pin: ItemPin) => void) | null = null;
    let itemPreview: WalkItem | null = null;
    let onItem: ((item: WalkItem) => void) | null = null;
    let priceText: (item: WalkItem) => string | undefined = (item) => item.price;
    let labelOf: (item: WalkItem) => WalkItem["label"] = (item) => item.label;
    const itemSprites = new Map<string, { sprite: THREE.Sprite; item: WalkItem }>();
    const itemButtons = new Map<string, { el: HTMLButtonElement; item: WalkItem }>();
    /** Specials in view a moment ago, and when each was last said aloud. */
    let seen = new Set<string>();
    const spokenAt = new Map<string, number>();
    /** Where a flat video's picture sits on the screen (it is shown «contain»). */
    function flatRect(v: HTMLVideoElement) {
      const W = flatEl.clientWidth, H = flatEl.clientHeight;
      const vw = v.videoWidth || W, vh = v.videoHeight || H;
      const k = Math.min(W / vw, H / vh);
      const w = vw * k, h = vh * k;
      return { x: (W - w) / 2, y: (H - h) / 2, w, h };
    }
    function updateItems() {
      const v = current?.video;
      const ready = Boolean(current && !busy && v && v.readyState >= 1);
      const walk = walkOf(walksNow, current?.key);
      const t = v?.currentTime ?? 0;
      const flat = Boolean(current?.flat);
      let shown = ready ? itemsAt(walk, t, !flat) : [];
      if (ready && itemPreview) {
        shown = shown.filter((s) => s.item.id !== itemPreview!.id);
        const p = itemsAt({ doors: [], items: [itemPreview] }, t, !flat)[0];
        if (p) shown.push(p);
      }
      const wantSprites = new Set<string>();
      const wantButtons = new Set<string>();
      // A special coming into view is said aloud, once a minute at most (not to the operator placing it).
      for (const { item } of shown) {
        const said = specialSay(item);
        if (!said || item === itemPreview || itemPick) continue;
        const key = `${current!.key}#${item.id}`;
        const last = spokenAt.get(key) ?? -Infinity;
        if (!seen.has(key) && performance.now() - last > 60_000) {
          spokenAt.set(key, performance.now());
          sayAloud(said);
        }
      }
      seen = new Set(shown.map(({ item }) => `${current!.key}#${item.id}`));
      for (const { item, x, y } of shown) {
        const sp = item.special;
        const price = priceText(item);
        const label = labelOf(item);
        const id = `${current!.key}#${item.id}#${label.en}#${price ?? ""}#${sp ? `${sp.was}>${sp.now}` : ""}`;
        if (flat) {
          wantButtons.add(id);
          let b = itemButtons.get(id);
          if (!b) {
            const el = document.createElement("button");
            el.type = "button";
            el.style.zIndex = "2"; // above the video, which is put on screen after it on re-entry
            // A price tag on a stick: the stick's foot (the dot) is the product's spot (founder, 2026-10-18).
            el.className = "pointer-events-auto absolute flex flex-col items-center";
            el.style.transform = "translate(-50%, calc(-100% + 10px))";
            const stick = `<span class="h-14 w-[5px] bg-white/95 shadow"></span><span class="h-5 w-5 rounded-full border-[3px] border-white ${sp ? "bg-[#d61424]" : "bg-[#00B8C8]"} shadow-lg"></span>`;
            if (sp) {
              // On special: a big red tag, English only (founder).
              el.innerHTML = `<span class="flex flex-col items-center rounded-2xl border-[3px] border-white bg-[#d61424]/95 px-4 py-2 text-center text-white shadow-xl"><span class="text-[18px] font-black tracking-wide text-[#ffe14d]">SPECIAL</span><span data-n class="max-w-[12rem] truncate text-[14px] font-bold"></span><span data-w class="text-[14px] text-white/80 line-through"></span><span data-p class="text-[26px] font-black leading-tight"></span></span>${stick}`;
              (el.querySelector("[data-w]") as HTMLElement).textContent = sp.was;
              (el.querySelector("[data-p]") as HTMLElement).textContent = sp.now;
            } else {
              el.innerHTML = `<span class="flex flex-col items-center rounded-xl border-[3px] border-[#00B8C8] bg-[#0a161c]/90 px-3 py-1.5 text-center text-white shadow-xl"><span data-n class="max-w-[12rem] truncate text-[14px] font-bold"></span><span data-p class="text-[20px] font-black leading-tight text-[#ffd75e]"></span></span>${stick}`;
              const pr = el.querySelector("[data-p]") as HTMLElement;
              if (price) pr.textContent = price;
              else pr.remove();
            }
            (el.querySelector("[data-n]") as HTMLElement).textContent = sp ? label.en : label.fa ? `${label.en} · ${label.fa}` : label.en;
            el.addEventListener("click", () => {
              const m = itemButtons.get(id);
              if (m && m.item !== itemPreview && !itemPick) onItem?.(m.item);
            });
            b = { el, item };
            itemButtons.set(id, b);
            flatEl.appendChild(el);
          }
          b.item = item;
          const r = flatRect(v!);
          b.el.style.left = `${r.x + x * r.w}px`;
          b.el.style.top = `${r.y + y * r.h}px`;
          b.el.style.opacity = item === itemPreview ? "0.8" : "1";
          // While pinning, taps go through to the picture.
          b.el.style.pointerEvents = itemPick ? "none" : "auto";
        } else {
          wantSprites.add(id);
          let m = itemSprites.get(id);
          if (!m) {
            // The tag on its stick, the stick's foot on the product's spot.
            const tag = tagTexture({ ...item, label }, price);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag.texture, depthTest: false, depthWrite: false, transparent: true }));
            const width = sp ? 5.4 : 4.2;
            sprite.scale.set(width, width * tag.aspect, 1);
            sprite.center.set(0.5, tag.foot);
            sprite.renderOrder = 11;
            m = { sprite, item };
            itemSprites.set(id, m);
            scene.add(sprite);
          }
          m.item = item;
          const h = x - current!.spin;
          const cp = Math.cos(y);
          m.sprite.position.set(Math.sin(h) * cp * MARK_R, Math.sin(y) * MARK_R, -Math.cos(h) * cp * MARK_R);
          (m.sprite.material as THREE.SpriteMaterial).opacity = item === itemPreview ? 0.8 : 1;
        }
      }
      for (const [id, m] of itemSprites) {
        if (wantSprites.has(id)) continue;
        scene.remove(m.sprite);
        (m.sprite.material as THREE.SpriteMaterial).map?.dispose();
        m.sprite.material.dispose();
        itemSprites.delete(id);
      }
      for (const [id, b] of itemButtons) {
        if (wantButtons.has(id)) continue;
        b.el.remove();
        itemButtons.delete(id);
      }
    }
    function updateDoors() {
      const v = current?.video;
      const walk = walkOf(walksNow, current?.key);
      const t = v?.currentTime ?? 0;
      const around = current && !busy && v && v.readyState >= 1 ? doorsAround(walk, t) : [];
      const shown = preview && current && !current.flat ? [...around.filter((d) => d.id !== preview!.id), preview] : around;
      const want = new Set<string>();
      if (current && !current.flat) {
        for (const d of shown) {
          const sign = signAt(d, t);
          if (!sign) continue;
          const site = isSiteOnlyDoor(d);
          const id = `${current.key}#${d.id}#${d.label.en}#${d.label.fa ?? ""}#${site}#${d.image ?? ""}#${d.size ?? ""}`;
          want.add(id);
          let m = markers.get(id);
          if (!m) {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: d.image ? doorTexture(d, (w, h) => sprite.scale.set(w, h, 1)) : signTexture(d.label.en, d.label.fa, site), depthTest: false, depthWrite: false, transparent: true }));
            if (!d.image) sprite.scale.set(7.4, 3.45, 1);
            sprite.renderOrder = 10;
            m = { sprite, door: d };
            markers.set(id, m);
            scene.add(sprite);
          }
          m.door = d;
          const h = sign.yaw - current.spin;
          const cp = Math.cos(sign.pitch);
          m.sprite.position.set(Math.sin(h) * cp * MARK_R, Math.sin(sign.pitch) * MARK_R, -Math.cos(h) * cp * MARK_R);
          (m.sprite.material as THREE.SpriteMaterial).opacity = d === preview ? 0.85 : 1;
        }
      }
      for (const [id, m] of markers) {
        if (want.has(id)) continue;
        const s = m.sprite;
        scene.remove(s);
        (s.material as THREE.SpriteMaterial).map?.dispose();
        s.material.dispose();
        markers.delete(id);
      }

      if (busy || !current) return;
      // ⚠️ ONE AHEAD, NEVER MORE: the nearest door's shop, or the street to go back to.
      let wantKey: { key: string; t: number; flat: boolean; purpose: Layer["purpose"] } | null = null;
      const ahead = around.find((d) => d.to);
      if (ahead?.to) wantKey = { key: ahead.to, t: 0, flat: isFlatDoor(ahead), purpose: "door" };
      const top = trail[trail.length - 1];
      const onward = walk?.next;
      if (!wantKey && !top && onward && v && Number.isFinite(v.duration) && v.duration - t < PRELOAD_DT) {
        wantKey = { key: onward, t: 0, flat: false, purpose: "main" };
      }
      if (!wantKey && top && v && Number.isFinite(v.duration) && v.duration - t < PRELOAD_DT) {
        wantKey = { key: top.key, t: returnPoint(top.door).t, flat: false, purpose: "back" };
      }
      if (pending && (!wantKey || pending.key !== wantKey.key || pending.purpose !== wantKey.purpose)) {
        release(pending);
        pending = null;
      }
      if (!pending && wantKey) pending = makeLayer(wantKey);
    }

    engine.current = {
      video: () => current?.video ?? document.createElement("video"),
      setMove(x, y) {
        stickX = x;
        stickY = y;
        if (y !== 0) kick(); // the pedal is pressed inside a tap
      },
      setGyro(on) {
        gyroOn = on;
      },
      setDrive(r) {
        drive = r;
      },
      kick,
      turn: () => turnNow,
      setWalks(w) {
        walksNow = w;
      },
      enter: (d) => void enter(d),
      setPick(f) {
        pick = f;
      },
      setPreview(d) {
        preview = d;
      },
      setItemPick(f) {
        itemPick = f;
      },
      setItemPreview(item) {
        itemPreview = item;
      },
      setOnItem(f) {
        onItem = f;
      },
      setPriceText(f) {
        priceText = f;
      },
      setLabelOf(f) {
        labelOf = f;
      },
      seek(t) {
        if (!current || busy) return;
        current.video.pause();
        rate = 0;
        current.video.currentTime = Math.max(0, t);
      },
      back: () => void back(),
      goToWalk: (k) => void goToWalk(k),
      setLockOff(off) {
        lockOff = off;
      },
      here: () => {
        camera.getWorldDirection(lookDir);
        return { key: current?.key ?? null, t: current?.video.currentTime ?? 0, yaw: videoYaw(), pitch: Math.asin(Math.max(-1, Math.min(1, lookDir.y))), flat: current?.flat ?? false, projection: current?.projection ?? null };
      },
      goTo(door) {
        if (!current || busy) return;
        current.video.pause();
        rate = 0;
        current.video.currentTime = door.t;
        const sign = signAt(door, door.t, Infinity) ?? { yaw: door.yaw, pitch: DEFAULT_PITCH };
        if (!current.flat) turnYaw += angleDiff(sign.yaw - current.spin, heading());
        pitch = sign.pitch;
      },
    };

    // ── The first video: ?src, ?v, or the walk visitors start on ──────────
    void (async () => {
      const w = await loadWalks();
      if (disposed) return;
      walksNow = w;
      serverWalks.current = w;
      setWalks(w);
    })();
    void (async () => {
      const raw = params.get("src");
      let layer: Layer | null = null;
      if (raw) {
        layer = makeLayer({ key: null, src: safeSrc(raw), purpose: "main" });
      } else {
        let key = params.get("v") || "";
        // The walks first: a video's walk may say how it holds its picture (`projection`).
        const w = await loadWalks();
        walksNow = w;
        if (!key) key = startOf(w) ?? "";
        if (disposed) return;
        if (V_RE.test(key) || isWalkKey(key)) layer = makeLayer({ key, purpose: "main" });
      }
      if (!layer) {
        setPhase("error");
        setError("No walk video: open with ?v=scenes/<scene>/<file>.mp4 (from /operator/splats).");
        return;
      }
      current = layer;
      layer.video.addEventListener("loadedmetadata", () => {
        if (current !== layer) return;
        setTime({ now: layer!.video.currentTime, total: layer!.video.duration });
        setInfo(`${layer!.video.videoWidth}×${layer!.video.videoHeight} · ${mmss(layer!.video.duration)}${layer!.flat ? " · flat" : ""}`);
        // ⚠️ NO PHONE PLAYS AN 8K WALK (founder, 2026-10-10: "on mobile-web
        // auto drive does not work, manual drive does not work either" — the
        // plaza was the 8K export, and no `-phone.mp4` next to it). Say so,
        // rather than a walk that won't move.
        if (isTouch() && layer!.video.videoWidth > 4096) {
          setNotice(`This walk is ${layer!.video.videoWidth}×${layer!.video.videoHeight} — too big for a phone; it may not move. Its 4K copy (…-phone.mp4, see scripts/splats/walk-video.md) fixes it. · این ویدیو برای گوشی بزرگ است.`);
        }
      });
      try {
        await layer.ready;
      } catch (e) {
        if (disposed || layer.released) return;
        setPhase("error");
        setError((e as Error).message);
        return;
      }
      if (disposed) return;
      show(layer, 1);
      report(true);
      setPhase((p) => (p === "loading" ? "ready" : p));
    })();

    let stickX = 0;
    let stickY = 0;
    const maxRate = PEDAL_RATE;
    let drive: number | null = null;
    let playRefused: HTMLVideoElement | null = null;
    function kick() {
      const v = current?.video;
      if (!v || !v.paused || v.currentTime >= v.duration - 0.05) return;
      v.play().then(() => {
        if (playRefused === v) playRefused = null;
      }, () => {});
    }
    // Any tap on the page is a chance to be allowed to play again.
    const onAnyTap = () => {
      if (playRefused && playRefused === current?.video) kick();
    };
    window.addEventListener("pointerdown", onAnyTap, true);
    let facingBack = false;
    let gyroOn = false;
    let gyroHave = false;
    let gyroAligned = false;
    const gyroQ = new THREE.Quaternion();
    const turnQ = new THREE.Quaternion();
    let yaw = 0;
    let pitch = 0;
    let turnYaw = 0;
    let velTurn = 0;
    let rate = 0; // eased walk rate: + forward, − back, in "times as filmed"
    let stepDebt = 0; // seconds of stepping owed while a seek was in flight

    // ── Looking: finger, wheel/pinch, phone ───────────────────────────────
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const zoom = (f: number) => {
      camera.fov = THREE.MathUtils.clamp(camera.fov * f, 30, 100);
      camera.updateProjectionMatrix();
    };
    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    let tapFrom: { x: number; y: number; at: number } | null = null;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tapFrom = pointers.size === 1 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
    };
    // A tap (not a drag): on a door's sign, step inside; in edit mode while
    // pinning, the spot tapped is where the sign goes at this moment.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function onTap(x: number, y: number) {
      if (!current || busy) return;
      if (current.flat) {
        // A flat video: only the operator's item pins are taps on the picture.
        if (!itemPick) return;
        const box = flatEl.getBoundingClientRect();
        const r = flatRect(current.video);
        const fx = (x - box.left - r.x) / r.w, fy = (y - box.top - r.y) / r.h;
        if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) itemPick({ t: current.video.currentTime, x: Math.round(fx * 1000) / 1000, y: Math.round(fy * 1000) / 1000 });
        return;
      }
      const r = canvas.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (itemPick) {
        const d = raycaster.ray.direction;
        const worldYaw = Math.atan2(d.x, -d.z);
        itemPick({ t: current.video.currentTime, x: wrapAngle(worldYaw + current.spin), y: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) });
        return;
      }
      const itemHit = raycaster.intersectObjects([...itemSprites.values()].map((m) => m.sprite), false)[0];
      const im = itemHit && [...itemSprites.values()].find((m) => m.sprite === itemHit.object);
      if (im && im.item !== itemPreview) {
        onItem?.(im.item);
        return;
      }
      if (pick) {
        const d = raycaster.ray.direction;
        const worldYaw = Math.atan2(d.x, -d.z);
        pick({ t: current.video.currentTime, yaw: wrapAngle(worldYaw + current.spin), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) });
        return;
      }
      const hit = raycaster.intersectObjects([...markers.values()].map((m) => m.sprite), false)[0];
      const m = hit && [...markers.values()].find((x) => x.sprite === hit.object);
      if (m && m.door !== preview) void enter(m.door);
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      // A flat video has no "round" to look at. ⚠️ THE FINGER WORKS WITH THE
      // PHONE'S MOTION ON (founder, 2026-10-10: «Look by phone» must be
      // automatic, no button): a sideways drag turns round on top of where the
      // phone points; up and down is the phone's own.
      if (pointers.size === 1 && !current?.flat) {
        const k = (camera.fov / el.clientHeight) * (Math.PI / 180);
        if (gyroOn && gyroHave) turnYaw += (e.clientX - prev.x) * k;
        else {
          yaw += (e.clientX - prev.x) * k;
          pitch = THREE.MathUtils.clamp(pitch + (e.clientY - prev.y) * k, -1.45, 1.45);
        }
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoom(pinch / d);
        pinch = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      if (tapFrom && e.type === "pointerup" && Math.hypot(e.clientX - tapFrom.x, e.clientY - tapFrom.y) < 8 && performance.now() - tapFrom.at < 500) onTap(e.clientX, e.clientY);
      tapFrom = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoom(Math.exp(THREE.MathUtils.clamp(px, -40, 40) * 0.0006));
    };
    const onBlur = () => keys.clear();
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      deviceQuaternion(gyroQ, e.alpha, e.beta, e.gamma, screenAngle());
      gyroHave = true;
    };
    const keys = new Set<string>();
    const typing = (t: EventTarget | null) => {
      const tag = (t as HTMLElement | null)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return; // the operator typing a door's name is not walking
      if (e.type === "keydown") keys.add(e.key.toLowerCase());
      else keys.delete(e.key.toLowerCase());
    };
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);

    // ── The photographer's turns, for the wheel (`lib/splats/walkTurn.ts`) ──
    // A band round the horizon, a few times a second, compared with the last
    // one: how far it came back rotated over how much video time is the turn.
    const BAND_H = 16;
    const turnCanvas = document.createElement("canvas");
    turnCanvas.width = TURN_COLS;
    turnCanvas.height = BAND_H;
    const turnCtx = turnCanvas.getContext("2d", { willReadFrequently: true });
    let turnPrev: { p: Float32Array; t: number; layer: Layer } | null = null;
    let turnAt = 0;
    let turnNow = 0;
    let turnBlind: Layer | null = null; // a video the browser won't let us read (no CORS)
    function readTurn() {
      const v = current?.video;
      // (A cube map's band is not a ring of the horizon: no reading.)
      if (!turnCtx || !current || current.flat || current.projection === "eac" || busy || current === turnBlind || !v || v.readyState < 2 || v.seeking || !v.videoWidth) {
        if (!current || current.flat || current.projection === "eac" || current === turnBlind) turnNow = 0;
        return;
      }
      const now = performance.now();
      if (now - turnAt < (isTouch() ? 250 : 120)) return;
      turnAt = now;
      const t = v.currentTime;
      // Standing still: the wheel stays where it was, as a car's does.
      if (turnPrev && turnPrev.layer === current && Math.abs(t - turnPrev.t) < 0.06) return;
      let p: Float32Array;
      try {
        turnCtx.drawImage(v, 0, v.videoHeight * 0.4, v.videoWidth, v.videoHeight * 0.2, 0, 0, TURN_COLS, BAND_H);
        p = bandProfile(turnCtx.getImageData(0, 0, TURN_COLS, BAND_H).data, TURN_COLS, BAND_H);
      } catch {
        turnBlind = current;
        return;
      }
      const prev = turnPrev;
      turnPrev = { p, t, layer: current };
      if (!prev || prev.layer !== current || Math.abs(t - prev.t) > 1.5) return;
      const m = ringShift(prev.p, p, 24);
      // The turn as the visitor feels it: walking the path backwards, the
      // photographer's right turn comes as a left one.
      const r = m.score > 0.5 ? THREE.MathUtils.clamp(turnRate(m.shift, TURN_COLS, Math.abs(t - prev.t)), -2, 2) : 0;
      turnNow += (r - turnNow) * 0.35;
    }

    // ── The loop: look, then walk the video ───────────────────────────────
    const clock = new THREE.Clock();
    const look = new THREE.Euler(0, 0, 0, "YXZ");
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const ease = 1 - Math.exp(-dt / EASE_S);
      const shape = (v: number) => Math.sign(v) * v * v;

      let wantTurn = shape(stickX);
      if (keys.has("d") || keys.has("arrowright")) wantTurn = 1;
      if (keys.has("a") || keys.has("arrowleft")) wantTurn = -1;
      if (current?.flat) wantTurn = 0;
      velTurn += (wantTurn * TURN_RATE - velTurn) * ease;
      turnYaw += velTurn * dt;
      // ⚠️ THE PHONE'S COMPASS IS NOT THE WALK'S FORWARD. Its heading is
      // wherever the phone happened to point, so the first reading is turned
      // to what the visitor already faced — without this, a phone could start
      // facing back along the path, where «on» means back in time from 0:00 and
      // self-drive stood still (founder, 2026-10-10: "self drive does not work
      // on mobile").
      if (gyroOn && gyroHave && !gyroAligned) {
        gyroAligned = true;
        const wanted = yaw + turnYaw;
        camera.quaternion.copy(turnQ.setFromAxisAngle(UP, -turnYaw)).multiply(gyroQ);
        turnYaw += angleDiff(wanted, heading());
      }
      const aim = () => {
        if (gyroOn && gyroHave) camera.quaternion.copy(turnQ.setFromAxisAngle(UP, -turnYaw)).multiply(gyroQ);
        else camera.quaternion.setFromEuler(look.set(-pitch, -(yaw + turnYaw), 0));
      };
      aim();
      // ⚠️ THE VIEW STOPS SHORT OF THE PHOTOGRAPHER (owner, 2026-11-01: in a
      // small store the dark patch "blackened a full side of the store").
      // Then: "lock the zone where I am visible INSTEAD of creating black cloud
      // … remove all black cloud". The view turns on the horizontal plane and
      // stops where the zone would enter the picture, so the photographer is
      // never on screen and nothing is darkened. The operator (`?edit=1`)
      // still turns freely, to find and set the zone.
      // Then (start lock / end lock): the zone is the arc the operator turned
      // the view's MIDDLE through, from their face first showing at one edge
      // of the screen to its going off the other — so the view's middle may
      // not enter it, and the screen's width is already counted in.
      const tilt = !lockOff && current && !current.flat ? walkOf(walksNow, current.key)?.tilt : undefined;
      if (tilt && !(gyroOn && gyroHave)) {
        // `pitch` is positive looking DOWN (the camera turns by −pitch); the limits are above the horizon.
        const p = THREE.MathUtils.clamp(pitch, -(tilt.up ?? Math.PI / 2), -(tilt.down ?? -Math.PI / 2));
        if (p !== pitch) { pitch = p; aim(); }
      }
      const hid = !lockOff && current && !current.flat ? walkOf(walksNow, current.key)?.hide : undefined;
      if (hid) {
        const zone = hideAt(hid, current!.video.currentTime);
        const lim = Math.min(Math.PI - 0.05, zone.width / 2);
        const d = angleDiff(videoYaw(), zone.yaw);
        if (Math.abs(d) < lim) {
          turnYaw += (d >= 0 ? 1 : -1) * (lim - Math.abs(d));
          velTurn = 0;
          aim();
        }
      }

      let wantRate = shape(-stickY);
      if (keys.has("w") || keys.has("arrowup")) wantRate = 1;
      if (keys.has("s") || keys.has("arrowdown")) wantRate = -1;
      // Self-drive walks on unless the pedals or the keys say otherwise.
      let target = wantRate !== 0 || drive === null ? wantRate * maxRate : drive;
      // ⚠️ "ON" IS THE WAY THE VISITOR FACES (founder, 2026-10-10: "when we use
      // the wheel to turn the view backward then forward key should move the
      // shopper in that direction"). The video's forward is where the camera
      // went; facing more than a right angle away from it, walking on plays the
      // walk backwards (with a little slack either side, so it doesn't flicker).
      // Looking at the ground or the sky has no "way": keep the last one.
      if (current && !current.flat) {
        const away = Math.abs(videoYaw()); // (fills lookDir)
        if (Math.abs(lookDir.y) < 0.85) {
          if (!facingBack && away > FACE_BACK) facingBack = true;
          else if (facingBack && away < Math.PI - FACE_BACK) facingBack = false;
        }
      } else facingBack = false;
      if (facingBack) target = -target;
      if (busy) target = 0;
      rate += (target - rate) * ease;

      const video = current?.video;
      if (video && !busy && video.readyState >= 2 && Number.isFinite(video.duration)) {
        if (rate >= MIN_PLAY_RATE && video !== playRefused) {
          // Walking on at a pace a browser plays smoothly: let it play.
          video.playbackRate = Math.min(4, rate);
          if (video.paused && video.currentTime < video.duration - 0.05) {
            void video.play().catch((e: unknown) => {
              // ⚠️ A PHONE MAY REFUSE play() OUTSIDE A TAP (an iPhone in Low
              // Power Mode always does). Then walking on steps the time like
              // walking back, until the next tap lets it play (`kick`).
              if ((e as Error)?.name === "NotAllowedError") playRefused = video;
            });
          }
          stepDebt = 0;
        } else {
          if (!video.paused) video.pause();
          if (Math.abs(rate) > DEAD) {
            // Walking back, creeping on, or a phone that won't play: step the time, one seek in flight at a time.
            stepDebt += rate * dt;
            if (!video.seeking && Math.abs(stepDebt) >= 1 / 60) {
              const to = THREE.MathUtils.clamp(video.currentTime + stepDebt, 0, video.duration);
              stepDebt = 0;
              if (to !== video.currentTime) video.currentTime = to;
            }
          } else stepDebt = 0;
        }
      }

      if (fade) {
        const k = Math.min(1, (performance.now() - fade.start) / fadeMs);
        const { from, to } = fade;
        if (to.flat) to.video.style.opacity = String(k);
        else if (from.flat) from.video.style.opacity = String(1 - k);
        else if (to.material) to.material.opacity = k;
        if (k >= 1) {
          const done = fade.done;
          fade = null;
          done();
        }
      }

      readTurn();
      updateDoors();
      updateItems();
      nadir.visible = nadirDeg > 0 && Boolean(current && !current.flat);
      renderer.render(scene, camera);
      report();
    });

    return () => {
      disposed = true;
      engine.current = null;
      renderer.setAnimationLoop(null);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("pointerdown", onAnyTap, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      release(current);
      release(pending);
      for (const { el } of itemButtons.values()) el.remove();
      for (const { sprite } of [...markers.values(), ...itemSprites.values()]) {
        (sprite.material as THREE.SpriteMaterial).map?.dispose();
        sprite.material.dispose();
      }
      geometry.dispose();
      nadirGeometry.dispose();
      nadirMaterial.dispose();
      nadirTexture.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    engine.current?.setDrive(drive ? DRIVES[drive].rate : null);
  }, [drive]);
  // The store's product list: what the cards show, and what the operator tags by number.
  const store = view.key ? storeOfScene(view.key) : "";
  useEffect(() => {
    setCatalogue(null);
    setAisles([]);
    if (!STORE_RE.test(store)) return;
    let gone = false;
    void fetch(`/api/splats/catalogue?store=${encodeURIComponent(store)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!gone && j?.ok && j.catalogue) setCatalogue(checkCatalogue(j.catalogue).catalogue); })
      .catch(() => { /* no list: the cards show what each product was tagged with */ });
    void fetch(`/api/splats/store?store=${encodeURIComponent(store)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!gone && j?.ok && Array.isArray(j.aisles)) setAisles(j.aisles); })
      .catch(() => { /* no aisles: no Next / Previous */ });
    return () => { gone = true; };
  }, [store]);
  async function saveCatalogue(c: Catalogue): Promise<string | null> {
    try {
      const res = await fetch("/api/operator/splats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
        body: JSON.stringify({ action: "catalogueSave", catalogue: c }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!json.ok) return json.error || `HTTP ${res.status}`;
      setCatalogue(checkCatalogue(json.catalogue).catalogue);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  // Tags show the store's list price for products tagged by their number.
  useEffect(() => {
    engine.current?.setPriceText((item) => {
      const p = productOf(catalogue, item.n);
      return p && p.priceCents !== null ? unitPriceSay(p, "en") : item.price;
    });
    engine.current?.setLabelOf((item) => {
      const p = productOf(catalogue, item.n);
      if (!p) return item.label;
      if (!p.en && !p.fa) return { en: `#${p.n}` };
      return { en: p.en || p.fa!, ...(p.fa ? { fa: p.fa } : {}) };
    });
  }, [catalogue]);

  // A tap on an item's dot opens its card, and the walk stands while it is open.
  useEffect(() => {
    engine.current?.setOnItem((item) => {
      setDrive(null);
      setCard(item);
    });
    return () => engine.current?.setOnItem(null);
  }, []);

  // Stepping into a shop (or back out) ends the drive: the visitor looks round first.
  useEffect(() => {
    setDrive(null);
  }, [view.inside]);
  useEffect(() => {
    engine.current?.setWalks(walks);
  }, [walks]);

  /**
   * «Start walking». ⚠️ ONE TAP, TWO PERMISSIONS, IN THIS ORDER: iOS only
   * shares the phone's motion when asked inside a tap, before any other await;
   * then the video is started once so later play() calls are allowed.
   */
  async function start() {
    const v = engine.current?.video();
    // ⚠️ AUTOMATIC, NO BUTTON: on a phone or tablet (a touch screen) the view
    // follows the device as it is turned; a computer reports the API but has
    // no sensor, so it looks with the mouse. The finger turns the view either way.
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    // ⚠️ BOTH CALLS BEFORE ANY AWAIT: play() too must start inside the tap —
    // after the motion permission's dialog the tap has expired, and a phone
    // that only plays from a tap would never walk on.
    const warm = v ? v.play().then(() => v.pause(), () => {}) : Promise.resolve();
    const ok = touch && hasDeviceOrientation() && (await requestDeviceOrientation());
    engine.current?.setGyro(ok);
    await warm;
    setPhase("walking");
  }

  const door = view.near[0];
  const aisleAt = view.key ? aisles.findIndex((a) => a.key === view.key) : -1;
  /** An aisle's name, from its shelf id: «Aisle 3a» (the walk's title is the shop's name, the same on every aisle). */
  const aisleName = (i: number) => (aisles[i] ? `Aisle ${aisles[i].shelf.replace(/^0+(?=\d)/, "")}` : "");

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={host} className="absolute inset-0" />
      {/* A flat (phone) video of a shop is shown here, over the sphere. */}
      <div ref={flatHost} className="pointer-events-none absolute inset-0" />

      {phase === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] text-white/85">
          در حال آماده‌سازی… · Getting ready…
        </div>
      )}
      {phase === "ready" && (
        // z-30: above the items' dots, which are already on the picture (one in the
        // middle covered this button — found 2026-10-12).
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
          <button onClick={() => void start()} className="rounded-full border border-amber-300/70 bg-amber-300/25 px-8 py-4 text-[18px] font-bold text-amber-50">
            شروع قدم زدن · Start walking
          </button>
        </div>
      )}
      {phase === "error" && (
        <div dir="ltr" className="absolute inset-x-4 top-16 rounded-xl bg-black/75 p-3 text-center text-[14px] text-rose-200">{error}</div>
      )}
      {notice && (
        <button dir="ltr" onClick={() => setNotice(null)} className="absolute inset-x-4 top-16 z-20 rounded-xl bg-black/80 p-3 text-center text-[14px] text-rose-200">
          {notice} <span className="text-white/50">(tap to close)</span>
        </button>
      )}

      {debug && (
        <div dir="ltr" className="pointer-events-none absolute bottom-16 left-3 rounded-xl bg-black/60 p-2 font-mono text-[11px] text-white/80">
          {info} · {mmss(time.now)} · {shortKey(view.key)}
          {diag && <div>{diag}</div>}
        </div>
      )}

      {phase === "walking" && (
        <>
          <SteeringWheel
            className="bottom-[6.75rem] right-5"
            onMove={(x, y) => engine.current?.setMove(x, y)}
            follow={() => engine.current?.turn() ?? 0}
          />
          {/* Self-drive, below the wheel. */}
          <div dir="ltr" className="absolute bottom-[3.75rem] right-5 flex w-56 gap-1.5">
            {(["back", "slow", "fast"] as Drive[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  if (drive !== k) engine.current?.kick();
                  setDrive(drive === k ? null : k);
                }}
                aria-pressed={drive === k}
                className={`h-9 flex-1 rounded-full border px-1 text-[11px] leading-tight ${drive === k ? "border-amber-300/90 bg-amber-300/40 font-semibold text-amber-50" : "border-white/25 bg-black/60 text-white/85"}`}
              >
                {drive === k ? "■ توقف · Stop" : DRIVES[k].label}
              </button>
            ))}
          </div>

          {/* A door in reach: step inside. */}
          {/* In a 360° walk the sign on the door is the button; a flat video has no round to put it in. */}
          {/* ⚠️ CENTRED, NOT IN A CORNER: a flat video is shown whole in the middle,
              so a portrait one leaves black margins either side on a wide screen —
              the founder (2026-10-12) found the door's button out in that margin.
              The bottom middle is always on the picture. */}
          {door && !view.busy && view.flat && (
            <button
              dir="ltr"
              onClick={() => engine.current?.enter(door)}
              className="absolute bottom-28 left-1/2 z-10 w-max max-w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-amber-300/80 bg-amber-300/30 px-5 py-3 text-left text-amber-50 shadow-lg backdrop-blur-sm"
            >
              <span className="block text-[17px] font-bold">{isSiteOnlyDoor(door) ? "Visit website ↗" : "Step inside"} · {door.label.en}</span>
              {door.label.fa && <span dir="rtl" className="block text-right text-[15px] text-amber-100/90">{isSiteOnlyDoor(door) ? "وبسایت" : "ورود"} · {door.label.fa}</span>}
            </button>
          )}

          {/* The hallway's door spots (from /stores/areas): stand where a door should be, face the wall, press. */}
          {spotMode && !view.busy && !view.flat && (
            <div dir="ltr" className="absolute left-1/2 top-16 z-20 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 text-center">
              <button
                onClick={async () => {
                  const h = engine.current?.here();
                  if (!h) return;
                  setSpotSaid("…");
                  try {
                    const res = await fetch("/api/stores/areas", {
                      method: "POST",
                      headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
                      body: JSON.stringify({ action: "spotAdd", area: new URLSearchParams(window.location.search).get("area") || undefined, t: Math.round(h.t * 100) / 100, yaw: Math.round(h.yaw * 1000) / 1000, pitch: Math.round(h.pitch * 1000) / 1000 }),
                    });
                    const out = await res.json().catch(() => ({}));
                    setSpotSaid(res.ok && out.ok ? `✓ Spot ${out.bazaar?.spots?.length ?? ""} saved at ${mmss(h.t)} · ذخیره شد` : `Not saved: ${out.error || res.status}`);
                  } catch (e) {
                    setSpotSaid(`Not saved: ${(e as Error).message}`);
                  }
                }}
                className="rounded-2xl border border-amber-300/80 bg-amber-300/30 px-5 py-3 text-[16px] font-bold text-amber-50 shadow-lg backdrop-blur-sm"
              >
                جای در اینجا · Door spot here
              </button>
              {spotSaid && <p className="mt-1 rounded-lg bg-black/60 px-2 py-1 text-[12px] text-white/85">{spotSaid}</p>}
            </div>
          )}

          {/* Inside a shop: the way back, always. */}
          {view.inside > 0 && !view.busy && !view.atEnd && (
            <button
              dir="ltr"
              onClick={() => engine.current?.back()}
              className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-white/40 bg-black/65 px-5 py-2 text-[15px] font-semibold text-white"
            >
              ← Back to the street · بازگشت به خیابان
            </button>
          )}
          {/* A store's aisles: «‹ Aisle 2 · Aisle 3 of 6 · Aisle 4 ›» (founder, 2026-10-12: "map later, simple next previous now"). */}
          {aisleAt >= 0 && aisles.length > 1 && !view.busy && (
            <div dir="ltr" className={`absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black/65 p-1 text-[13px] text-white ${view.inside > 0 ? "top-16" : "top-3"}`}>
              <button disabled={aisleAt === 0} onClick={() => engine.current?.goToWalk(aisles[aisleAt - 1].key)}
                className="rounded-full px-3 py-1.5 hover:bg-white/15 disabled:opacity-30">‹ {aisleName(aisleAt - 1)}</button>
              <span className="px-1 text-white/60">{aisleName(aisleAt)} · {aisleAt + 1} / {aisles.length}</span>
              <button disabled={aisleAt === aisles.length - 1} onClick={() => engine.current?.goToWalk(aisles[aisleAt + 1].key)}
                className="rounded-full px-3 py-1.5 hover:bg-white/15 disabled:opacity-30">{aisleName(aisleAt + 1)} ›</button>
            </div>
          )}
          {/* The end of an aisle: on to the next. */}
          {aisleAt >= 0 && aisleAt < aisles.length - 1 && !view.busy && Number.isFinite(time.total) && time.now >= time.total - 0.4 && (
            <div className="absolute inset-x-0 bottom-28 z-10 flex justify-center">
              <button dir="ltr" onClick={() => engine.current?.goToWalk(aisles[aisleAt + 1].key)}
                className="rounded-full border border-amber-300/80 bg-amber-300/30 px-7 py-3.5 text-[17px] font-bold text-amber-50 shadow-lg">
                Next aisle · {aisleName(aisleAt + 1)} → · راهروی بعد
              </button>
            </div>
          )}

          {/* Inside a shop whose door names its website. */}
          {view.inside > 0 && view.site && !view.busy && (
            <button
              dir="ltr"
              onClick={() => openSite(view.site)}
              className={`absolute right-4 z-10 top-16 rounded-full border border-sky-300/70 bg-sky-400/25 px-4 py-2 text-[14px] font-semibold text-white`}
            >
              🌐 Visit the website · وبسایت فروشگاه
            </button>
          )}
          {view.inside > 0 && view.atEnd && !view.busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
              <button
                dir="ltr"
                onClick={() => engine.current?.back()}
                className="rounded-full border border-amber-300/80 bg-amber-300/30 px-8 py-4 text-[18px] font-bold text-amber-50"
              >
                ← Back to the street · بازگشت به خیابان
              </button>
            </div>
          )}
          {view.busy && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-[13px] text-white/80">
              …
            </div>
          )}

          {/* Where along the walk: drag to jump. */}
          <div dir="ltr" className="absolute inset-x-4 bottom-5 flex items-center gap-3 sm:right-56">
            <span className="w-10 text-right font-mono text-[12px] text-white/70">{mmss(time.now)}</span>
            <input
              type="range"
              min={0}
              max={Number.isFinite(time.total) ? time.total : 0}
              step={0.1}
              value={time.now}
              onChange={(e) => {
                const v = engine.current?.video();
                if (v) v.currentTime = Number(e.target.value);
              }}
              aria-label="Where along the walk"
              className="h-8 flex-1 accent-amber-300"
            />
            <span className="w-10 font-mono text-[12px] text-white/70">{mmss(time.total)}</span>
          </div>
        </>
      )}

      {phase !== "loading" && (
        <WalkSound audioKey={walkOf(walks, view.key)?.audio ?? null} srcOf={soundSrc}
          specials={Boolean(walkOf(walks, view.key)?.items?.some((it) => it.special))} />
      )}

      {card && view.key && (
        <ItemCard item={card} walkKey={view.key} walk={walkOf(walks, view.key)} catalogue={catalogue} onClose={() => setCard(null)} />
      )}

      {needSignIn && (
        <OperatorSignIn onIn={() => { setNeedSignIn(false); setEditing(true); }} />
      )}

      {editing && phase !== "loading" && (
        <DoorEditor
          engine={engine}
          walks={walks}
          viewKey={view.key}
          onChange={setWalks}
          serverWalks={serverWalks}
          store={store}
          catalogue={catalogue}
          saveCatalogue={saveCatalogue}
        />
      )}
    </div>
  );
}

// ── The operator's door editor (?edit=1, with the admin token) ────────────────

/** The door being placed, as the walk draws it (its sign, while pinning). */
function draftDoor(d: { id?: string; t: number; yaw: number; en: string; fa: string; to: string; url: string; pins: SignPin[] }): WalkDoor {
  return {
    id: d.id ?? "__draft", t: d.t, yaw: d.yaw,
    ...(d.to ? { to: d.to } : d.url.trim() ? { url: d.url.trim() } : { to: "scenes/draft/draft.mp4" }),
    label: d.fa.trim() ? { en: d.en.trim() || "…", fa: d.fa.trim() } : { en: d.en.trim() || "…" },
    ...(d.pins.length ? { pins: d.pins } : {}),
  };
}

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

type VideoChoice = { key: string; label: string };

function DoorEditor({ engine, walks, viewKey, onChange, serverWalks, store, catalogue, saveCatalogue }: {
  engine: React.MutableRefObject<Engine | null>;
  walks: Walks;
  viewKey: string | null;
  onChange: (w: Walks) => void;
  serverWalks: React.MutableRefObject<Walks>;
  store: string;
  catalogue: Catalogue | null;
  saveCatalogue: (c: Catalogue) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(true);
  const [videos, setVideos] = useState<VideoChoice[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  type Draft = { id?: string; t: number; yaw: number; en: string; fa: string; to: string; url: string; flat: boolean; pins: SignPin[]; pinning: boolean };
  const [draft, setDraft] = useState<null | Draft>(null);
  const [tab, setTab] = useState<"doors" | "items" | "sound" | "cut" | "hide">("doors");
  const [status, setStatus] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  // The uploaded videos a door may lead to: the operator API's own listing.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/operator/splats", { headers: { "x-admin-token": readAdminToken() }, cache: "no-store" });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const list: VideoChoice[] = [];
        for (const o of json.objects as Array<{ key: string; kind: string }>) {
          if (o.kind === "web" && isWalkKey(o.key) && !isPhoneCopy(o.key)) list.push({ key: o.key, label: `${shortKey(o.key)} (360°)` });
          else if (o.kind === "master" && isPhoneVideoKey(o.key)) list.push({ key: o.key, label: `${shortKey(o.key)} (phone video, flat)` });
        }
        list.sort((a, b) => a.key.localeCompare(b.key));
        setVideos(list);
      } catch (e) {
        setListError(`The list of uploaded videos could not be read: ${(e as Error).message}`);
        setVideos([]);
      }
    })();
  }, []);

  // The door being placed: its sign shown as it is pinned, and taps on the
  // picture are pins while «Pin the sign» is on.
  const pinning = Boolean(draft?.pinning);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setPick(pinning ? (pin) => setDraft((d) => (d ? { ...d, pins: sortPins([...d.pins.filter((q) => Math.abs(q.t - pin.t) >= 0.05), pin]) } : d)) : null);
    return () => e.setPick(null);
  }, [engine, pinning]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setPreview(draft ? draftDoor(draft) : null);
    return () => e.setPreview(null);
  }, [engine, draft]);

  const walk = walkOf(walks, viewKey);
  const change = (w: Walks) => {
    onChange(w);
    setDirty(true);
    setStatus(null);
  };

  function doorHere() {
    const h = engine.current?.here();
    if (!h?.key) return setStatus({ tone: "bad", text: "Doors can only be placed on a video from the bucket (?v=…), not one opened by address." });
    engine.current?.video().pause();
    const first = (videos?.find((v) => v.key !== h.key && isWalkKey(v.key)) ?? videos?.find((v) => v.key !== h.key))?.key ?? "";
    setDraft({ t: h.t, yaw: h.yaw, en: "", fa: "", to: first, url: "", flat: isPhoneVideoKey(first), pins: [], pinning: true });
  }

  function saveDraft() {
    if (!draft || !viewKey) return;
    if (!draft.en.trim()) return setStatus({ tone: "bad", text: "The door needs an English label." });
    const url = draft.url.trim();
    if (url && !isSiteUrl(url)) return setStatus({ tone: "bad", text: "The website must be a full https:// address (e.g. https://alisbakery.ca)." });
    if (draft.to ? !isVideoKey(draft.to) || draft.to === viewKey : !url) {
      return setStatus({ tone: "bad", text: "Choose the shop's video in «Leads to», or give its website." });
    }
    // With pins, the door's moment and heading are its middle pin's.
    const mid = draft.pins.length ? draft.pins[Math.floor((draft.pins.length - 1) / 2)] : null;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const fields = {
      t: Math.round((mid?.t ?? draft.t) * 100) / 100,
      yaw: r3(mid?.yaw ?? draft.yaw),
      ...(mid ? { pitch: r3(mid.pitch), pins: draft.pins.map((q) => ({ t: Math.round(q.t * 100) / 100, yaw: r3(q.yaw), pitch: r3(q.pitch) })) } : {}),
      label: draft.fa.trim() ? { en: draft.en.trim(), fa: draft.fa.trim() } : { en: draft.en.trim() },
      ...(draft.to ? { to: draft.to } : {}),
      ...(url ? { url } : {}),
      ...(draft.to && draft.flat && !isPhoneVideoKey(draft.to) ? { flat: true } : {}),
    };
    // An edit replaces «flat» too: unticked is no flag (dropped when saved).
    if (draft.id) change(updateDoor(walks, viewKey, draft.id, { to: undefined, url: undefined, flat: undefined, pitch: undefined, pins: undefined, ...fields }));
    else change(addDoor(walks, viewKey, fields));
    setDraft(null);
  }

  async function save() {
    setStatus({ tone: "ok", text: "Saving…" });
    try {
      const res = await fetch("/api/operator/splats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
        // `base`: the walks as last read — the server merges (`mergeWalks`).
        body: JSON.stringify({ action: "walksSave", walks, base: serverWalks.current }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const saved = parseWalks(json.walks);
      serverWalks.current = saved;
      onChange(saved);
      setDirty(false);
      const conflicts: string[] = json.conflicts ?? [];
      setStatus(conflicts.length
        ? { tone: "warn", text: `Saved, but someone else changed the walks meanwhile:\n${conflicts.join("\n")}` }
        : { tone: "ok", text: "Saved — shoppers see it now." });
    } catch (e) {
      setStatus({ tone: "bad", text: `Not saved: ${(e as Error).message}` });
    }
  }

  // ⚠️ SAVED BY ITSELF, A SECOND AFTER EACH CHANGE (founder, 2026-10-12:
  // "dots I added on a product does not show up on shopper's walk" — «Add
  // item» changed only the operator's own screen until «Save» was pressed,
  // and nothing made that plain). A failed save stays «unsaved» and says why;
  // the next change, or «Save», tries again.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void saveRef.current(), 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, walks]);
  // Leaving with a change not yet saved: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const isStart = Boolean(viewKey && walks.start === viewKey);
  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const field = "w-full rounded-md border border-white/20 bg-black/50 px-2 py-1 text-[13px] text-white";

  return (<>
    {viewKey && <ProjectionCard engine={engine} viewKey={viewKey} projection={walk?.projection ?? null}
      onKeep={(p) => change(setProjection(walks, viewKey, p))} />}
    <div dir="ltr" data-walk-editor className={`absolute left-3 top-3 z-30 w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-white/20 bg-black/80 p-3 text-[13px] text-white/90 shadow-xl ${tab === "items" && catalogue?.products.length ? PRODUCTS_PANEL_SHIFT : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["doors", "items", "sound", "cut", "hide"] as const).map((k) => (
            <button key={k} className={`${btn} ${tab === k ? "border-white/60 bg-white/25 font-semibold" : ""}`} onClick={() => setTab(k)}>
              {k === "doors" ? "Doors" : k === "items" ? "Products" : k === "sound" ? "Sound" : k === "cut" ? "Cut" : "Lock"}
            </button>
          ))}
        </div>
        <button className={btn} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <div className="mt-2 max-h-[70vh] space-y-2 overflow-y-auto">
          <div className="truncate text-[11px] text-white/60">This walk: {shortKey(viewKey)}{walk?.doors.length ? ` · ${walk.doors.length} door(s)` : ""}</div>
          {listError && <div className="text-rose-300">{listError}</div>}

          {tab === "hide" && <HideEditor engine={engine} walks={walks} viewKey={viewKey} change={change} />}
          {tab === "cut" && <CutEditor video={() => engine.current?.video() ?? null} viewKey={viewKey} />}
          {tab === "sound" && <SoundEditor walks={walks} viewKey={viewKey} change={change} setStatus={setStatus} />}
          {tab === "items" && <TagsFromControl engine={engine} walks={walks} viewKey={viewKey} change={change} />}
          {tab === "items" && <ItemsEditor engine={engine} walks={walks} viewKey={viewKey} change={change} setStatus={setStatus} store={store} catalogue={catalogue} saveCatalogue={saveCatalogue} />}

          {tab === "doors" && !draft && (
            <button className={`${btn} w-full border-amber-300/60 bg-amber-300/20 py-2 text-[13px] font-semibold`} disabled={!viewKey} onClick={doorHere}>
              Door here (this moment, the way I look)
            </button>
          )}

          {tab === "doors" && draft && (
            <div className="space-y-1.5 rounded-lg border border-amber-300/40 p-2">
              <div className="text-[11px] text-white/60">
                At {mmss(draft.t)} ({draft.t.toFixed(2)} s), heading {Math.round((draft.yaw * 180) / Math.PI)}° in the video
              </div>
              <input className={field} placeholder="English label (e.g. Ali's Bakery)" value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} autoFocus />
              <input className={field} dir="rtl" placeholder="برچسب فارسی (optional)" value={draft.fa} onChange={(e) => setDraft({ ...draft, fa: e.target.value })} />
              <label className="block text-[11px] text-white/60">Leads to</label>
              <select className={field} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value, flat: isPhoneVideoKey(e.target.value) })}>
                <option value="">— no video (the website only) —</option>
                {(videos ?? []).filter((v) => v.key !== viewKey).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
              {videos === null && <div className="text-[11px] text-white/50">Reading the uploaded videos…</div>}
              <label className="block text-[11px] text-white/60">The shop's website (optional)</label>
              <input className={field} type="url" inputMode="url" placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
              <div className="text-[11px] leading-snug text-white/45">
                {draft.to ? "Inside the shop, a «Visit the website» button opens it in a new tab." : "No video chosen: the sign says «Visit website» and opens it in a new tab."}
              </div>
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={draft.flat || isPhoneVideoKey(draft.to)} disabled={!draft.to || isPhoneVideoKey(draft.to)} onChange={(e) => setDraft({ ...draft, flat: e.target.checked })} />
                Flat video (filmed with a phone, not 360°)
              </label>
              <div className="space-y-1 rounded-md border border-white/15 p-1.5">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[12px]">Sign on the door</b>
                  <button className={`${btn} ${draft.pinning ? "border-amber-300/70 bg-amber-300/25" : ""}`} onClick={() => setDraft({ ...draft, pinning: !draft.pinning })}>
                    {draft.pinning ? "Pinning: on" : "Pin the sign"}
                  </button>
                </div>
                {draft.pinning && (
                  <div className="text-[11px] leading-snug text-white/65">
                    Tap the door in the picture: the sign goes there at this moment. Walk on a little (stick, or W/S) and tap the door again —
                    2 or 3 pins: where it comes into view, in the middle, where it leaves. The sign follows the door between pins.
                  </div>
                )}
                {draft.pins.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {draft.pins.map((q) => (
                      <span key={q.t} className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]">
                        {mmss(q.t)}.{Math.floor((q.t % 1) * 10)}
                        <button className="ms-1 text-white/60" title="Remove this pin" onClick={() => setDraft({ ...draft, pins: draft.pins.filter((x) => x !== q) })}>×</button>
                      </span>
                    ))}
                    <button className="text-[11px] text-white/50 underline" onClick={() => setDraft({ ...draft, pins: [] })}>clear</button>
                  </div>
                ) : (
                  <div className="text-[11px] text-white/45">No pins: the sign stands at the heading you looked when you pressed «Door here».</div>
                )}
              </div>
              <div className="flex gap-2">
                <button className={`${btn} border-amber-300/60`} onClick={saveDraft}>{draft.id ? "Apply" : "Add door"}</button>
                {draft.id && (
                  <button className={btn} onClick={() => { const h = engine.current?.here(); if (h) setDraft({ ...draft, t: h.t, yaw: h.yaw }); }}>
                    Move here
                  </button>
                )}
                <button className={btn} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          )}

          {tab === "doors" && <ul className="space-y-1">
            {(walk?.doors ?? []).map((d) => (
              <li key={d.id} className="rounded-md bg-white/5 p-1.5">
                <div className="truncate">
                  <span className="font-mono text-white/60">{mmss(d.t)}</span> {d.label.en}
                  {d.label.fa && <span className="text-white/60"> · {d.label.fa}</span>}
                </div>
                <div className="truncate text-[11px] text-white/50">→ {d.to ? shortKey(d.to) : "website only"}{isFlatDoor(d) ? " (flat)" : ""}{d.url ? ` · 🌐 ${hostOf(d.url)}` : ""}</div>
                <div className="mt-1 flex gap-1.5">
                  <button className={btn} onClick={() => engine.current?.goTo(d)}>Go to</button>
                  <button className={btn} onClick={() => setDraft({ id: d.id, t: d.t, yaw: d.yaw, en: d.label.en, fa: d.label.fa ?? "", to: d.to ?? "", url: d.url ?? "", flat: isFlatDoor(d), pins: d.pins ?? [], pinning: false })}>Edit</button>
                  <button className={btn} onClick={() => { if (viewKey && window.confirm(`Delete the door «${d.label.en}»?`)) change(removeDoor(walks, viewKey, d.id)); }}>Delete</button>
                </div>
              </li>
            ))}
            {walk && !walk.doors.length && <li className="text-white/50">No doors on this walk yet.</li>}
          </ul>}

          {tab === "doors" && (
            <button className={`${btn} w-full`} disabled={!viewKey || !isWalkKey(viewKey) || isStart} onClick={() => viewKey && change(setStart(walks, viewKey))}>
              {isStart ? "✓ Visitors start on this walk" : "Set as the street walk visitors start on"}
            </button>
          )}
          {/* It saves by itself; the key is for saving again after a failure. */}
          <button className={`${btn} w-full border-emerald-300/60 bg-emerald-300/20 py-2 text-[13px] font-semibold`} onClick={() => void save()}>
            {dirty ? "Saving… (or press to save now)" : "✓ Saved"}
          </button>
          {status && (
            <div className={`whitespace-pre-wrap text-[12px] ${status.tone === "bad" ? "text-rose-300" : status.tone === "warn" ? "text-amber-200" : "text-emerald-200"}`}>
              {status.text}
            </div>
          )}
        </div>
      )}
    </div>
  </>);
}

/**
 * «IS THIS A 360° VIDEO?» (founder, 2026-10-17: a YouTube 360° download showed
 * flat). A landscape video that is not 2:1 is shown flat by its shape; in
 * edit mode this card asks, one question at a time: «Yes» reloads it as
 * YouTube's cube map (?proj=eac), and «Does it look right?» keeps it, tries the
 * other layout (a squeezed panorama, ?proj=equirect), or says it is flat.
 * What is kept is the walk's `projection`, saved by itself.
 */
function ProjectionCard({ engine, viewKey, projection, onKeep }: {
  engine: React.MutableRefObject<Engine | null>;
  viewKey: string;
  projection: Projection | null;
  onKeep: (p: Projection) => void;
}) {
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const trying = params?.get("v") === viewKey ? params.get("proj") : null;
  const v = engine.current?.video();
  const w = v?.videoWidth ?? 0, h = v?.videoHeight ?? 0;
  const [done, setDone] = useState(false);
  // A big video knows its size only seconds after the page draws: look again
  // until it does, or the question never comes and the walk stays flat.
  const [, setSeen] = useState("");
  useEffect(() => {
    if (done || projection) return;
    const id = window.setInterval(() => {
      const el = engine.current?.video();
      setSeen(el && el.videoWidth ? `${el.currentSrc}|${el.videoWidth}x${el.videoHeight}` : "");
    }, 500);
    return () => window.clearInterval(id);
  }, [engine, done, projection]);
  const reloadWith = (p: string | null) => {
    const u = new URL(window.location.href);
    if (p) u.searchParams.set("proj", p);
    else u.searchParams.delete("proj");
    window.location.href = u.toString();
  };
  const primary = "rounded-xl bg-[#00B8C8] px-4 py-2.5 text-[15px] font-bold text-black";
  const quiet = "rounded-xl border border-white/25 px-4 py-2.5 text-[14px] text-white/85";
  const box = "fixed bottom-24 left-1/2 z-40 w-[min(27rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-[#00B8C8]/60 bg-[#0f1418]/95 p-4 text-white shadow-2xl";
  if (done) return null;

  if (trying === "eac" || trying === "equirect") {
    const name = trying === "eac" ? "YouTube's cube map" : "a squeezed panorama";
    return (
      <div dir="ltr" className={box}>
        <div className="mb-1 text-[11px] text-white/45">Showing it as {name}</div>
        <div className="mb-2 text-[19px] font-bold">Does it look right?</div>
        <p className="mb-3 text-[13px] text-white/70">Look around (drag the picture): straight lines and one whole scene mean right; a picture cut into squares, or stretched, means try the other.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="me-auto text-[14px] text-white/70 underline" onClick={() => { onKeep("flat"); setDone(true); window.setTimeout(() => reloadWith(null), 2500); /* after it saves (a second) */ }}>It&apos;s flat</button>
          <button className={quiet} onClick={() => reloadWith(trying === "eac" ? "equirect" : "eac")}>Try the other way</button>
          <button className={primary} onClick={() => { onKeep(trying); setDone(true); }}>✓ Looks right</button>
        </div>
      </div>
    );
  }
  // Asked only of a landscape video, not 2:1, that nothing has decided yet.
  if (projection || !v || !w || !h || h >= w || Math.abs(w / h - 2) < 0.05) return null;
  return (
    <div dir="ltr" className={box}>
      <div className="mb-1 text-[11px] text-white/45">{w}×{h} · shown flat by its shape</div>
      <div className="mb-2 text-[19px] font-bold">Is this a 360° video?</div>
      <p className="mb-3 text-[13px] text-white/70">360° videos downloaded from YouTube come in this shape. Tell it once; it is saved for this video.</p>
      <div className="flex items-center gap-2">
        <button className={`${quiet} me-auto`} onClick={() => { onKeep("flat"); setDone(true); }}>No, it&apos;s flat</button>
        <button className={primary} onClick={() => reloadWith("eac")}>Yes, 360°</button>
      </div>
    </div>
  );
}

/** The edit link opened in a browser not signed in as operator on this site: sign in here. */
function OperatorSignIn({ onIn }: { onIn: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      dir="ltr"
      className="absolute left-3 top-3 z-30 w-[min(22rem,calc(100%-1.5rem))] space-y-2 rounded-xl border border-amber-300/50 bg-black/85 p-3 text-[13px] text-white shadow-xl"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (await armAdminMode(typed)) onIn();
        else setError("That admin token was refused on this site.");
      }}
    >
      <b>Edit mode needs the operator sign-in</b>
      <div className="text-[12px] text-white/65">
        This browser is not signed in as operator on {typeof window === "undefined" ? "this site" : window.location.host} (each site address keeps its own sign-in).
      </div>
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Admin token"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="w-full rounded-md border border-white/20 bg-black/50 px-2 py-1.5 text-[13px] text-white"
      />
      {error && <div className="text-rose-300">{error}</div>}
      <button type="submit" disabled={!typed.trim()} className="w-full rounded-md border border-amber-300/60 bg-amber-300/20 py-1.5 font-semibold disabled:opacity-40">
        Sign in · ورود
      </button>
    </form>
  );
}

/**
 * «Lock» on the walk's edit page (owner, 2026-11-01): "I rotate the view
 * until the first part of my face appears I press start lock and then when my
 * face disappear I press end lock and then that angle should be locked". The
 * arc the view's middle turned through between the two presses is locked at
 * that moment; done again after a turn in the walk, the zone turns with it.
 */
function HideEditor({ engine, walks, viewKey, change }: {
  engine: React.MutableRefObject<Engine | null>;
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
}) {
  const walk = walkOf(walks, viewKey);
  const hide = walk?.hide ?? null;
  const [start, setStart] = useState<{ t: number; yaw: number } | null>(null);
  const [swept, setSwept] = useState(0);
  const last = useRef(0);
  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  const deg = (r: number) => Math.round((r * 180) / Math.PI);
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  // While this tab is open the view turns freely, so the operator can see themselves.
  useEffect(() => {
    engine.current?.setLockOff(true);
    return () => engine.current?.setLockOff(false);
  }, [engine]);

  // Between the two presses: how far, and which way, the view has turned.
  useEffect(() => {
    if (!start) return;
    last.current = start.yaw;
    const id = window.setInterval(() => {
      const h = engine.current?.here();
      if (!h) return;
      const step = wrapAngle(h.yaw - last.current);
      last.current = h.yaw;
      setSwept((s) => s + step);
    }, 50);
    return () => window.clearInterval(id);
  }, [start, engine]);

  if (!viewKey) return <p className="text-white/70">Open a walk video from the bucket (?v=scenes/…) to lock a direction on it.</p>;
  if (engine.current?.here().flat) return <p className="text-white/70">This is a flat video: there is nothing behind the camera to lock.</p>;

  const begin = () => {
    const h = engine.current?.here();
    if (!h) return;
    engine.current?.video().pause();
    setSwept(0);
    setStart({ t: h.t, yaw: h.yaw });
  };
  const finish = () => {
    if (!start) return;
    const width = Math.abs(swept);
    if (width < HIDE_WIDTH.min || width > HIDE_WIDTH.max) {
      setStart(null);
      return;
    }
    const middle = wrapAngle(start.yaw + swept / 2);
    change(setHide(walks, viewKey, hideFacing(hide, start.t, middle, width, 0, width)));
    setStart(null);
  };
  const dropPoint = (t: number) => {
    if (!hide) return;
    const at = (hide.at ?? [{ t: 0, yaw: hide.yaw }]).filter((p) => p.t !== t);
    change(setHide(walks, viewKey, at.length ? { ...hide, yaw: at[0].yaw, at } : null));
  };
  const points = hide ? (hide.at?.length ? hide.at : [{ t: 0, yaw: hide.yaw, width: hide.width }]) : [];

  return (
    <div className="space-y-2">
      {!start ? (<>
        <p className="text-white/80">Stop the walk. Turn the view slowly towards yourself. The moment the first part of you appears at the edge of the screen, press:</p>
        <button className={`${btn} w-full border-amber-300/60 bg-amber-300/20 py-2 text-[13px] font-semibold`} onClick={begin}>
          Start lock
        </button>
      </>) : (<>
        <p className="text-white/80">Keep turning the same way, past yourself. When the last of you has gone off the other edge of the screen, press:</p>
        <button className={`${btn} w-full border-emerald-300/60 bg-emerald-300/20 py-2 text-[13px] font-semibold`} onClick={finish}>
          End lock ({Math.abs(deg(swept))}° so far)
        </button>
        <button className={`${btn} w-full`} onClick={() => setStart(null)}>Cancel</button>
      </>)}
      <p className="text-[11px] text-white/60">
        Shoppers cannot turn the view into a locked angle. If you turn round during the walk, go to a moment after the turn and lock again: the lock then turns with you.
      </p>
      {points.length > 0 && (
        <ul className="space-y-1">
          {points.map((p) => (
            <li key={p.t} className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1">
              <span>At {mmss(p.t)}: {deg(p.width ?? hide!.width)}° locked</span>
              <button className={btn} onClick={() => dropPoint(p.t)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {hide && <button className={`${btn} w-full`} onClick={() => change(setHide(walks, viewKey, null))}>Remove all locks</button>}
      <div className="space-y-1 border-t border-white/15 pt-2">
        <p className="text-white/80">Up and down: tilt the view as far as shoppers may look, then press.</p>
        {(["up", "down"] as const).map((side) => {
          const v = walk?.tilt?.[side];
          return (
            <div key={side} className="flex items-center justify-between gap-2">
              <span>{side === "up" ? "Up" : "Down"}: {v === undefined ? "free" : `${Math.abs(deg(v))}° ${side === "up" ? "above" : "below"} the horizon`}</span>
              <span className="flex gap-1">
                <button className={btn} onClick={() => { const h = engine.current?.here(); if (h) change(setTilt(walks, viewKey, side, h.pitch)); }}>
                  {side === "up" ? "Highest here" : "Lowest here"}
                </button>
                {v !== undefined && <button className={btn} onClick={() => change(setTilt(walks, viewKey, side, null))}>Free</button>}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-white/60">To try it, open the walk without &amp;edit=1 (here the view turns freely).</p>
    </div>
  );
}

/**
 * In «Products»: price tags only from here on (`Walk.tagsFrom`) — the first
 * part of a one-take store walk is the overall look, without tags.
 */
export function TagsFromControl({ engine, walks, viewKey, change }: {
  engine: React.MutableRefObject<Engine | null>;
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
}) {
  const from = walkOf(walks, viewKey)?.tagsFrom ?? null;
  const btn = "rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[12px] hover:bg-white/20 disabled:opacity-40";
  if (!viewKey) return null;
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div className="space-y-1 rounded-md border border-white/15 p-2">
      <div>{from ? `Price tags show from ${mmss(from)} on (none before).` : "Price tags show for the whole walk."}</div>
      <div className="flex gap-1">
        <button className={btn} onClick={() => { const h = engine.current?.here(); if (h) change(setTagsFrom(walks, viewKey, h.t)); }}>
          Tags only from this moment on
        </button>
        {from && <button className={btn} onClick={() => change(setTagsFrom(walks, viewKey, null))}>Whole walk</button>}
      </div>
    </div>
  );
}
