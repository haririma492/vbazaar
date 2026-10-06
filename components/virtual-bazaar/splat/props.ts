/**
 * THINGS PLACED INTO A FILMED SCENE (operator, 2026-10-06): "add two more
 * shelves with china products, one to the wall on the left and one to the
 * wall on the right; add one audio ad — as we walk past the post with a few
 * items on it, saying «I am on sale», bringing the price tag with a Sale
 * label up".
 *
 * Built from simple shapes (no model files to load): a wooden shelf unit of
 * blue-and-white porcelain, and a round display post with a few pieces and a
 * price tag that rises out of them when a shopper comes near. Sizes in
 * metres; `Prop.size` scales them to the scene. The tag and the voice are
 * driven from the viewer's loop (`SalePost.update`).
 */

import * as THREE from "three";

/** A small repeatable random, so a shelf looks the same on every visit. */
function rand(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Materials (made once) ───────────────────────────────────────────────────

let porcelainTex: THREE.CanvasTexture | null = null;
/** Blue-and-white porcelain: rims, a band of scrolls, a flower in the middle. */
function porcelain(): THREE.CanvasTexture {
  if (porcelainTex) return porcelainTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f7f8fb";
  g.fillRect(0, 0, 256, 256);
  const blue = "#1f4fa3";
  g.strokeStyle = blue;
  g.fillStyle = blue;
  // Bands.
  g.lineWidth = 6;
  for (const y of [10, 30, 226, 246]) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
  }
  // Scrolls along the bands.
  g.lineWidth = 3;
  for (let x = 0; x < 256; x += 32) {
    g.beginPath(); g.arc(x + 16, 20, 7, Math.PI, 0); g.stroke();
    g.beginPath(); g.arc(x + 16, 236, 7, 0, Math.PI); g.stroke();
  }
  // A flower and leaves in the field.
  const flower = (cx: number, cy: number, r: number) => {
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.7, r * 0.35, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#f7f8fb";
    g.beginPath(); g.arc(cx, cy, r * 0.45, 0, Math.PI * 2); g.fill();
    g.fillStyle = blue;
  };
  flower(128, 128, 22);
  flower(48, 100, 10);
  flower(208, 156, 10);
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(60, 110); g.bezierCurveTo(90, 150, 160, 90, 196, 150); g.stroke();
  porcelainTex = new THREE.CanvasTexture(c);
  porcelainTex.colorSpace = THREE.SRGBColorSpace;
  porcelainTex.wrapS = porcelainTex.wrapT = THREE.RepeatWrapping;
  return porcelainTex;
}

let woodTex: THREE.CanvasTexture | null = null;
function wood(): THREE.CanvasTexture {
  if (woodTex) return woodTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#7a4a26";
  g.fillRect(0, 0, 256, 64);
  const r = rand(5);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(${60 + r() * 40}, ${30 + r() * 20}, ${10 + r() * 10}, 0.5)`;
    g.lineWidth = 1 + r() * 2;
    const y = r() * 64;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + (r() - 0.5) * 8, 170, y + (r() - 0.5) * 8, 256, y); g.stroke();
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  return woodTex;
}

const china = () => new THREE.MeshStandardMaterial({ map: porcelain(), roughness: 0.18, metalness: 0.05 });
const plain = () => new THREE.MeshStandardMaterial({ color: 0xf7f8fb, roughness: 0.18, metalness: 0.05 });
const timber = () => new THREE.MeshStandardMaterial({ map: wood(), roughness: 0.7 });

// ── Porcelain pieces (each standing on y = 0) ───────────────────────────────

function plate(r = 0.12): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, 0.018, 40), [plain(), china(), plain()]);
  // Standing on its edge, leaning back a little, face forward.
  m.rotation.x = Math.PI / 2 - 0.2;
  m.position.y = r;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

function bowl(r = 0.085): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), china());
  (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  m.position.y = r;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

function cup(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.08, 28, 1, true), china());
  (body.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  body.position.y = 0.04;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 20), plain());
  handle.position.set(0.045, 0.045, 0);
  g.add(body, handle);
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.01, 28), china());
  saucer.position.y = 0.005;
  g.add(saucer);
  body.position.y += 0.01;
  handle.position.y += 0.01;
  return g;
}

function teapot(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 32, 20), china());
  body.scale.set(1, 0.8, 1);
  body.position.y = 0.07;
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), plain());
  lid.position.y = 0.135;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), plain());
  knob.position.y = 0.17;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.018, 0.1, 12), china());
  spout.position.set(0.1, 0.09, 0);
  spout.rotation.z = -0.9;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 8, 20, Math.PI * 1.3), plain());
  handle.position.set(-0.09, 0.08, 0);
  handle.rotation.z = Math.PI * 0.35;
  g.add(body, lid, knob, spout, handle);
  return g;
}

function vase(h = 0.26): THREE.Object3D {
  const pts = [
    [0.0, 0], [0.05, 0], [0.07, 0.04], [0.085, 0.12], [0.08, 0.18], [0.045, 0.22], [0.035, 0.25], [0.05, 0.27], [0.048, 0.28],
  ].map(([x, y]) => new THREE.Vector2(x * (h / 0.28), y * (h / 0.28)));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), china());
  (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

const PIECES = [plate, bowl, cup, teapot, () => vase(0.22), () => vase(0.3), () => plate(0.09)];

// ── The shelf ───────────────────────────────────────────────────────────────

/**
 * A wall shelf of china: 1.6 m wide, 1.9 m tall, 0.38 m deep, five boards,
 * each set with porcelain. Its back against the wall, its front facing +z.
 */
export function chinaShelf(seed = 1): THREE.Group {
  const g = new THREE.Group();
  const W = 1.6, H = 1.9, D = 0.38, T = 0.03;
  const wd = timber();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wd);
    m.position.set(x, y, z);
    g.add(m);
  };
  box(T, H, D, -W / 2, H / 2, 0);
  box(T, H, D, W / 2, H / 2, 0);
  box(W, H, T, 0, H / 2, -D / 2); // back
  box(W + T, T, D + 0.02, 0, H, 0); // top
  const levels = [0.08, 0.5, 0.9, 1.3];
  for (const y of levels) box(W, T, D, 0, y, 0);
  const r = rand(seed * 7919);
  for (const y of levels) {
    let x = -W / 2 + 0.12;
    while (x < W / 2 - 0.12) {
      const piece = PIECES[Math.floor(r() * PIECES.length)]();
      piece.position.set(x, y + T / 2, -0.03 + (r() - 0.5) * 0.06);
      piece.rotation.y = (r() - 0.5) * 0.6;
      g.add(piece);
      x += 0.2 + r() * 0.08;
    }
  }
  return g;
}

// ── The sale post ───────────────────────────────────────────────────────────

/** The price tag: a white card with a red SALE ribbon and the price, always facing the shopper. */
function tagSprite(price: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(0,0,0,0)";
  g.fillRect(0, 0, 512, 320);
  // Card.
  g.fillStyle = "#fffdf5";
  g.strokeStyle = "#b91c1c";
  g.lineWidth = 10;
  const r = 28;
  g.beginPath();
  g.moveTo(r + 20, 20); g.lineTo(492 - r, 20); g.quadraticCurveTo(492, 20, 492, 20 + r);
  g.lineTo(492, 300 - r); g.quadraticCurveTo(492, 300, 492 - r, 300);
  g.lineTo(20 + r, 300); g.quadraticCurveTo(20, 300, 20, 300 - r);
  g.lineTo(20, 20 + r); g.quadraticCurveTo(20, 20, 20 + r, 20);
  g.fill(); g.stroke();
  // Hole and string.
  g.fillStyle = "#b91c1c";
  g.beginPath(); g.arc(256, 52, 12, 0, Math.PI * 2); g.fill();
  // SALE ribbon.
  g.fillStyle = "#dc2626";
  g.fillRect(20, 80, 472, 90);
  g.fillStyle = "#ffffff";
  g.font = "bold 64px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("SALE · حراج", 256, 127, 430);
  // Price.
  g.fillStyle = "#111827";
  g.font = "bold 84px system-ui, sans-serif";
  g.fillText(price, 256, 238, 440);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  s.scale.set(0.42, 0.26, 1);
  s.renderOrder = 11;
  return s;
}

export type SalePost = {
  group: THREE.Group;
  /**
   * Each frame: how far the shopper is (metres, scaled). The tag rises when
   * they come near, and sinks back when they have gone; `onRise` fires once
   * per approach (the voice).
   */
  update: (dt: number, distance: number, onRise: () => void) => void;
  setPrice: (price: string) => void;
};

/** A round display post with a few pieces of china and a price tag hidden among them. */
export function salePost(price: string, seed = 3): SalePost {
  const g = new THREE.Group();
  const wd = timber();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 48), wd);
  top.position.y = 0.9;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.88, 20), wd);
  leg.position.y = 0.44;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.04, 40), wd);
  foot.position.y = 0.02;
  g.add(top, leg, foot);
  const r = rand(seed);
  const items = [teapot(), vase(0.3), plate(0.11), cup()];
  const spots: Array<[number, number]> = [[-0.15, -0.08], [0.14, -0.1], [0, 0.14], [-0.12, 0.12]];
  items.forEach((it, i) => {
    it.position.set(spots[i][0], 0.92, spots[i][1]);
    it.rotation.y = r() * Math.PI * 2;
    g.add(it);
  });
  // The tag: down among the items (hidden, small) until a shopper comes near.
  let tag = tagSprite(price);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 6), new THREE.MeshBasicMaterial({ color: 0xb91c1c }));
  g.add(tag, string);
  const LOW = 1.0, HIGH = 1.62, NEAR = 3.2, AWAY = 6;
  let up = 0; // 0 down … 1 up
  let rising = false;
  let armed = true;
  let t = 0;
  const place = () => {
    // Ease out with a small bounce at the top; a gentle sway once up.
    const e = up >= 1 ? 1 : 1 - Math.pow(1 - up, 3) + Math.sin(up * Math.PI) * 0.12;
    const y = LOW + (HIGH - LOW) * e;
    const sway = up >= 1 ? Math.sin(t * 2.2) * 0.012 : 0;
    tag.position.set(sway, y + 0.13, 0);
    const k = 0.25 + 0.75 * Math.min(1, e);
    tag.scale.set(0.42 * k, 0.26 * k, 1);
    tag.visible = up > 0.01;
    string.visible = tag.visible;
    string.scale.y = Math.max(0.001, y - 0.95);
    string.position.set(sway / 2, 0.95 + (y - 0.95) / 2, 0);
  };
  place();
  return {
    group: g,
    update(dt, distance, onRise) {
      t += dt;
      if (distance < NEAR && armed) {
        armed = false;
        rising = true;
        onRise();
      }
      if (distance > AWAY) {
        armed = true;
        rising = false;
      }
      const target = rising ? 1 : 0;
      up += Math.sign(target - up) * Math.min(Math.abs(target - up), dt / (rising ? 0.9 : 1.6));
      place();
    },
    setPrice(p) {
      g.remove(tag);
      tag.material.map?.dispose();
      tag.material.dispose();
      tag = tagSprite(p);
      g.add(tag);
      place();
    },
  };
}

// ── Sound: a chime, then the voice ──────────────────────────────────────────

let audio: AudioContext | null = null;
/** A browser lets a page make sound only after a tap: called on the first one. */
export function unlockSound() {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    void audio.resume();
    // iOS speaks only after it has spoken once from a tap.
    if ("speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  } catch {
    /* no sound here */
  }
}

/** Two bright notes, then `text` spoken (the price read out too). */
export function announce(text: string) {
  try {
    if (audio && audio.state === "running") {
      const now = audio.currentTime;
      for (const [f, at] of [[1046.5, 0], [1568, 0.14]] as const) {
        const o = audio.createOscillator(), v = audio.createGain();
        o.type = "sine";
        o.frequency.value = f;
        v.gain.setValueAtTime(0, now + at);
        v.gain.linearRampToValueAtTime(0.25, now + at + 0.02);
        v.gain.exponentialRampToValueAtTime(0.001, now + at + 0.5);
        o.connect(v).connect(audio.destination);
        o.start(now + at);
        o.stop(now + at + 0.55);
      }
    }
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1.15;
      window.setTimeout(() => window.speechSynthesis.speak(u), 350);
    }
  } catch {
    /* no sound here */
  }
}
