/**
 * What the splat viewers share: where scenes are fetched from, how a scene's
 * file is downloaded, and how an exit's marker looks. `/vca/splat`
 * (`SplatTour`) and `/vr` (`SplatVR`) both use these, so a scene loads and
 * reads the same in a phone and in a headset.
 */

import * as THREE from "three";

/** Baked in at build time when it was set then; otherwise asked of the server at load (`/api/splats/config`). */
const BUILT_BASE = (process.env.NEXT_PUBLIC_SPLAT_BASE_URL || "").trim().replace(/\/+$/, "");

export async function splatBase(): Promise<string> {
  if (BUILT_BASE) return BUILT_BASE;
  try {
    const res = await fetch("/api/splats/config", { cache: "no-store" });
    const { base } = (await res.json()) as { base: string | null };
    return (base || "").trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** A scene's file, downloaded whole; `onProgress` gets 0–1 (0 throughout when the size is not known). */
export async function downloadSplat(src: string, onProgress: (share: number) => void): Promise<Uint8Array> {
  const res = await fetch(src);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${src}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  // ⚠️ ONE COPY, NOT TWO. A phone's browser is reloaded by the system
  // when a page takes too much memory (iOS does it silently: the visitor
  // finds themselves back at «Start»). Knowing the size, the download
  // goes straight into its buffer instead of pieces plus a joined copy.
  let bytes = new Uint8Array(total || 0);
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total && got + value.length <= total) bytes.set(value, got);
    else chunks.push(value);
    got += value.length;
    onProgress(total ? got / total : 0);
  }
  if (chunks.length || got !== bytes.length) {
    // No size given (or a wrong one): join what came.
    const all = new Uint8Array(got);
    let at = 0;
    if (total) {
      all.set(bytes.subarray(0, Math.min(total, got)), 0);
      at = Math.min(total, got);
    }
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    bytes = all;
  }
  return bytes;
}

/** A marker: a glowing ring with a name under it, always facing the camera. Amber for exits; another colour for shop doors. */
export function makeMarker(text: string, rgb = "252, 211, 77"): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = `rgba(${rgb}, 0.25)`;
  g.strokeStyle = `rgba(${rgb}, 0.95)`;
  g.lineWidth = 10;
  g.beginPath();
  g.arc(256, 80, 56, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.font = "bold 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillStyle = "rgba(0,0,0,0.6)";
  const w = Math.min(500, g.measureText(text).width + 40);
  g.fillRect(256 - w / 2, 160, w, 64);
  g.fillStyle = "#fff";
  g.fillText(text, 256, 208, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.8, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}
