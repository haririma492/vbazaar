"use client";

/**
 * A 360° WALK SEEN AS A SHOPPER SEES IT, for the store page's «When the tray shows each shelf» (owner, 2026-11-16:
 * "you need to show the .mp4 normally rather than an odd looking sphere shape video"). The `<video>` itself is
 * hidden and drawn onto the inside of a sphere (three.js); a drag looks round, the wheel or a pinch zooms. It opens
 * looking right, at the shelves, as the Free Tour does inside a store (`STORE_FACE`). The parent drives the video
 * (time, play) through the element handed back by `onVideo`.
 *
 * The video is given the SIGNED link (`directMediaUrl`), never the `/api/media` redirect: WebGL needs CORS, which
 * iOS Safari drops across a cross-origin media redirect.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { directMediaUrl } from "@/lib/splats/directMedia";

export default function PanoView({ video, onVideo }: { video: string; onVideo: (el: HTMLVideoElement | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { let on = true; void directMediaUrl(video).then((u) => { if (on) setSrc(u); }); return () => { on = false; }; }, [video]);
  useEffect(() => { onVideo(vid.current); return () => onVideo(null); }, [onVideo, src]);

  useEffect(() => {
    const el = box.current, v = vid.current;
    if (!el || !v || !src) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.SphereGeometry(10, 96, 64);
    geo.scale(-1, 1, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    scene.add(mesh);

    // lon 0 is the way the camera walked (the panorama's middle); 90° is its right.
    let lon = 90, lat = 0, fov = 75;
    const fit = () => {
      const w = el.clientWidth || 640, h = Math.round(w * 9 / 16);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const down = (e: PointerEvent) => { renderer.domElement.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); renderer.domElement.style.cursor = "grabbing"; };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [c, d] = [...pts.values()];
        const d1 = Math.hypot(c.x - d.x, c.y - d.y);
        if (pinch && d0 > 0) fov = Math.min(100, Math.max(30, fov * (d0 / d1)));
        pinch = 1;
        return;
      }
      const k = fov / (el.clientWidth || 640);
      lon -= (e.clientX - p.x) * k;
      lat = Math.min(80, Math.max(-80, lat + (e.clientY - p.y) * k));
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) renderer.domElement.style.cursor = "grab"; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); fov = Math.min(100, Math.max(30, fov + e.deltaY * 0.05)); };
    const c = renderer.domElement;
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      const L = THREE.MathUtils.degToRad(lon), P = THREE.MathUtils.degToRad(lat);
      camera.lookAt(-Math.cos(L) * Math.cos(P), Math.sin(P), -Math.sin(L) * Math.cos(P));
      renderer.render(scene, camera);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
      tex.dispose(); geo.dispose(); (mesh.material as THREE.Material).dispose();
      renderer.dispose();
      c.remove();
    };
  }, [src]);

  return (
    <div className="relative w-full overflow-hidden rounded bg-black" style={{ aspectRatio: "16 / 9" }}>
      <div ref={box} className="absolute inset-0" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {src && <video ref={vid} src={src} crossOrigin="anonymous" playsInline muted preload="auto" className="hidden" onError={() => setFailed(true)} />}
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[11px] text-white/80">Drag to look round · wheel or pinch to zoom</span>
      {!src && <p className="absolute inset-0 grid place-items-center text-white/60">Loading the walk…</p>}
      {failed && <p className="absolute inset-0 grid place-items-center bg-black/80 p-3 text-center text-rose-200">The walk&apos;s video would not load here. Reload the page; if it stays, the video is missing from the bucket.</p>}
    </div>
  );
}
