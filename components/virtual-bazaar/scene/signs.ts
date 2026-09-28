import * as THREE from "three";

/**
 * SIGNS — Persian text drawn right-to-left on a canvas, used as a texture.
 *
 * ⚠️ REDRAWN WHEN THE WEB FONT ARRIVES. A canvas draws with whatever font is
 * loaded at that instant; drawn before Vazirmatn has loaded, every sign would
 * keep the fallback face for good. `redrawSignsWhenFontsLoad` draws them all
 * again once `document.fonts` is ready.
 *
 * ⚠️ EVERY SIGN CARRIES BOTH LANGUAGES. A `Label` is Persian and English;
 * `setSignLanguage` redraws every sign in the other one — right-to-left for
 * Persian, left-to-right for English, the logo at the start of the line.
 */

export type Label = string | { fa: string; en: string };
type Lang = "fa" | "en";
let lang: Lang = "fa";
const pick = (l: Label | undefined) => (l === undefined ? undefined : typeof l === "string" ? l : l[lang]);

export type SignStyle = {
  bg: string;
  fg: string;
  /** A second, smaller line under the name. */
  sub?: Label;
  /** Border colour; none when absent. */
  border?: string;
  /** An image drawn at the sign's right (its start, in Persian). */
  logo?: HTMLImageElement | null;
};

type Sign = { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; text: Label; style: SignStyle };

const FONT = "Vazirmatn, Tahoma, system-ui, sans-serif";
const signs = new Set<Sign>();

function draw(sign: Sign) {
  const { canvas, style } = sign;
  const text = pick(sign.text)!;
  const sub = pick(style.sub);
  const rtl = lang === "fa";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, w, h);
  if (style.border) {
    ctx.strokeStyle = style.border;
    ctx.lineWidth = Math.max(6, h * 0.05);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  }

  // The text's room, left to right; the logo takes the line's start.
  let left = 0;
  let right = w;
  if (style.logo && style.logo.complete && style.logo.naturalWidth) {
    const size = h * 0.8;
    if (rtl) {
      ctx.drawImage(style.logo, w - size - h * 0.1, h * 0.1, size, size);
      right = w - size - h * 0.15;
    } else {
      ctx.drawImage(style.logo, h * 0.1, h * 0.1, size, size);
      left = size + h * 0.15;
    }
  }
  const centre = (left + right) / 2;

  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = style.fg;
  const main = sub ? h * 0.44 : h * 0.56;
  ctx.font = `700 ${main}px ${FONT}`;
  // Shrink a long name to fit rather than letting it run off the board.
  const room = (right - left) * 0.9;
  const measured = ctx.measureText(text).width;
  if (measured > room) ctx.font = `700 ${(main * room) / measured}px ${FONT}`;
  ctx.fillText(text, centre, sub ? h * 0.38 : h * 0.54);
  if (sub) {
    ctx.font = `500 ${h * 0.22}px ${FONT}`;
    ctx.fillText(sub, centre, h * 0.76);
  }
  sign.texture.needsUpdate = true;
}

/** A texture of `text` on a board `aspect` times as wide as it is tall. */
export function makeSignTexture(text: Label, aspect: number, style: SignStyle): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.height = 128;
  canvas.width = Math.round(128 * aspect);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sign: Sign = { canvas, texture, text, style };
  signs.add(sign);
  draw(sign);
  // Forget it when the scene frees it.
  texture.addEventListener("dispose", () => signs.delete(sign));
  if (style.logo && !style.logo.complete) style.logo.addEventListener("load", () => draw(sign), { once: true });
  return texture;
}

export function redrawSignsWhenFontsLoad(onRedrawn: () => void) {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  document.fonts.ready.then(() => {
    signs.forEach(draw);
    onRedrawn();
  }).catch(() => {});
}

/** A flat board carrying a sign, facing +z. */
export function makeSignBoard(
  text: Label,
  width: number,
  height: number,
  style: SignStyle,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const map = makeSignTexture(text, width / height, style);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }),
  );
}

/** Redraws every sign in `next`. */
export function setSignLanguage(next: Lang) {
  if (next === lang) return;
  lang = next;
  signs.forEach(draw);
}

/**
 * A label floating in the air that always faces the visitor and keeps its
 * size on screen however far away it is (`sizeAttenuation: false`) — so a
 * gate's name reads from the far side of the square. The engine sets its
 * scale (a share of the screen's height) on every resize; `userData.aspect`
 * is its width over height.
 */
export function makeSignSprite(text: Label, aspect: number, style: SignStyle): THREE.Sprite {
  const map = makeSignTexture(text, aspect, style);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, sizeAttenuation: false, toneMapped: false }));
  sprite.userData.aspect = aspect;
  return sprite;
}

export const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
