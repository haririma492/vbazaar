"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * THE VIRTUAL BAZAAR — FIRST POC.
 *
 * A central square with six «راسته»s around it, picked by click or tap. It is
 * deliberately simple: the point of this stage is that Three.js runs smoothly
 * inside the site, on a desktop and on a phone. Camera controls, the phone's
 * motion sensor, walking into a راسته and its shops, and coming back here from
 * a shop's 2D page all come later — which is why picking only says which
 * راسته was chosen, and goes nowhere yet.
 *
 * ⚠️ THE BUTTONS UNDER THE SCENE ARE NOT A DUPLICATE. They are the same six
 * راسته as the boxes, and they are what a keyboard, a screen reader and a
 * device without WebGL use. Both roads end in the same `select`.
 */

type Street = {
  id: string;
  name: string;
  position: [number, number, number];
  color: number;
};

const STREETS: Street[] = [
  { id: "gold", name: "راسته طلافروش‌ها", position: [-12, 2, 0], color: 0xd4af37 },
  { id: "food", name: "راسته خوراکی", position: [12, 2, 0], color: 0xc96b4b },
  { id: "clothing", name: "راسته پوشاک", position: [0, 2, -12], color: 0x6d8fb3 },
  { id: "home", name: "راسته خانه و زندگی", position: [0, 2, 12], color: 0x789b72 },
  { id: "crafts", name: "راسته هنر و صنایع دستی", position: [-9, 2, -9], color: 0x9a6fae },
  { id: "services", name: "راسته خدمات", position: [9, 2, 9], color: 0x777777 },
];

/** Half the width of the whole layout, buildings and labels included. */
const LAYOUT_RADIUS = 16;
/**
 * Higher than the POC's (0, 7, 18), so the ring reads as a square seen from
 * above rather than a wall of boxes, and further back: from 19 units the
 * nearest راسته filled a desktop screen and the services one fell off it.
 */
const CAMERA_DIRECTION = new THREE.Vector3(0, 12, 20).normalize();
const CAMERA_MIN_DISTANCE = 32;
const FOV = 60;

/**
 * ⚠️ A TAP IS A SHORT PRESS THAT HARDLY MOVES. Selecting on `pointerdown`
 * fires at the start of every drag and every pinch, which the camera controls
 * coming next will turn into constant false picks. Measured between down and
 * up instead.
 */
const TAP_MAX_MOVE_PX = 8;
const TAP_MAX_MS = 500;

/**
 * How far back the camera has to stand for the whole ring to fit.
 *
 * ⚠️ A PORTRAIT PHONE IS THE CASE THAT MATTERS. With a fixed camera at
 * (0, 7, 18) a 390 px-wide screen shows about the middle half of the ring, and
 * the gold and food راسته are simply off screen. On a landscape screen the
 * minimum distance already fits.
 *
 * Seen from above at a low angle the ring is a flat ellipse: its full width
 * across, but only a slice of its depth plus the buildings' height up.
 */
function cameraDistance(aspect: number): number {
  const vHalf = THREE.MathUtils.degToRad(FOV / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const elevation = Math.asin(CAMERA_DIRECTION.y);
  const halfWidth = LAYOUT_RADIUS;
  const halfHeight = LAYOUT_RADIUS * Math.sin(elevation) + 4;
  const margin = 1.1;
  const needed = margin * Math.max(halfWidth / Math.tan(hHalf), halfHeight / Math.tan(vHalf));
  return Math.max(CAMERA_MIN_DISTANCE, needed);
}

/** The راسته's name, drawn right-to-left on a canvas and hung above its box. */
function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontPx = 56;
  const font = `600 ${fontPx}px Vazirmatn, Tahoma, system-ui, sans-serif`;
  ctx.font = font;
  const padX = 28;
  const width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const height = fontPx + 36;
  canvas.width = width;
  canvas.height = height;

  // Setting the size cleared the context; draw from scratch.
  ctx.fillStyle = "rgba(6, 19, 28, 0.82)";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 20);
    ctx.fill();
  } else {
    // Safari before 16.
    ctx.fillRect(0, 0, width, height);
  }
  ctx.font = font;
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f0fffc";
  ctx.fillText(text, width / 2, height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // ⚠️ THE SAME SIZE ON SCREEN WHATEVER THE DISTANCE. Sized in the world, the
  // nearest label came out five times the furthest one and covered its box.
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
      sizeAttenuation: false,
    }),
  );
  sprite.userData = { labelAspect: width / height };
  sprite.renderOrder = 1;
  return sprite;
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function VirtualBazaar() {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Lets the buttons light the same box a tap would. Set by the scene. */
  const highlightRef = useRef<(id: string | null) => void>(() => {});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** `null` until the browser has been asked, so the server render shows no warning. */
  const [webgl, setWebgl] = useState<boolean | null>(null);

  const selected = STREETS.find((s) => s.id === selectedId) ?? null;

  const select = (id: string | null) => {
    setSelectedId(id);
    highlightRef.current(id);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!webglAvailable()) {
      setWebgl(false);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setWebgl(false);
      return;
    }
    setWebgl(true);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3eee5);

    // Camera
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    // The page never scrolls; the canvas owns every gesture on it.
    renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    // Ground. Wider than the POC's 60, whose edge showed on a portrait phone
    // where the camera stands much further back.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0xd8c6a8 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Central square
    const square = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0xc9a66b }),
    );
    square.position.y = 0.15;
    scene.add(square);

    // Six market streets. One geometry shared by all six boxes.
    const buildingGeometry = new THREE.BoxGeometry(5, 4, 5);
    const buildings = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
    const labels: THREE.Sprite[] = [];

    STREETS.forEach((street) => {
      const building = new THREE.Mesh(
        buildingGeometry,
        new THREE.MeshStandardMaterial({ color: street.color }),
      );
      building.position.set(...street.position);
      building.userData = { id: street.id };
      scene.add(building);
      buildings.set(street.id, building);

      const label = makeLabel(street.name);
      label.position.set(street.position[0], street.position[1] + 2 + 0.9, street.position[2]);
      scene.add(label);
      labels.push(label);
    });

    const clickableObjects = Array.from(buildings.values());

    // ⚠️ RENDERED ON DEMAND, NOT EVERY FRAME. Nothing moves yet, so a
    // 60-a-second loop would only drain a phone's battery drawing the same
    // picture. When the camera controls arrive they call `requestRender` too.
    let frame = 0;
    const requestRender = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
      });
    };

    // Highlight: the selected box glows; a hovered one glows less.
    let selectedHighlight: string | null = null;
    let hovered: string | null = null;
    const paint = () => {
      buildings.forEach((mesh, id) => {
        const level = id === selectedHighlight ? 0.22 : id === hovered ? 0.1 : 0;
        mesh.material.emissive.setHex(0xffffff);
        mesh.material.emissiveIntensity = level;
        mesh.scale.setScalar(id === selectedHighlight ? 1.06 : 1);
      });
      requestRender();
    };
    highlightRef.current = (id) => {
      selectedHighlight = id;
      paint();
    };

    // Mouse / touch interaction
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const pick = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickableObjects, false)[0];
      return hit ? (hit.object.userData.id as string) : null;
    };

    let down: { x: number; y: number; t: number; id: number } | null = null;

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      down = { x: event.clientX, y: event.clientY, t: performance.now(), id: event.pointerId };
    };

    const handlePointerUp = (event: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || start.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved > TAP_MAX_MOVE_PX || performance.now() - start.t > TAP_MAX_MS) return;
      // A tap on empty ground clears the choice.
      const id = pick(event.clientX, event.clientY);
      setSelectedId(id);
      selectedHighlight = id;
      paint();
    };

    const handlePointerCancel = () => {
      down = null;
    };

    // Hover is a mouse thing; a finger has no position between taps.
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const id = pick(event.clientX, event.clientY);
      if (id === hovered) return;
      hovered = id;
      renderer.domElement.style.cursor = id ? "pointer" : "default";
      paint();
    };

    const handlePointerLeave = () => {
      if (!hovered) return;
      hovered = null;
      renderer.domElement.style.cursor = "default";
      paint();
    };

    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    // ⚠️ THE CONTAINER'S SIZE, NOT THE WINDOW'S. A phone's address bar
    // showing and hiding, a rotation, or a split-screen change resizes the
    // box without always firing a window `resize`; a ResizeObserver sees all
    // of them.
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.position.copy(CAMERA_DIRECTION).multiplyScalar(cameraDistance(camera.aspect));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      // A share of the screen's height; a little smaller on a narrow screen so
      // the longest name does not run into its neighbour.
      const labelHeight = camera.aspect < 1 ? 0.026 : 0.05;
      labels.forEach((label) => {
        label.scale.set(labelHeight * label.userData.labelAspect, labelHeight, 1);
      });
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      requestRender();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();

    // A phone under memory pressure can take the GPU context away. Without
    // this the canvas just goes blank; with it the buttons take over.
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setWebgl(false);
    };
    const handleContextRestored = () => {
      setWebgl(true);
      requestRender();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    // Cleanup
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      highlightRef.current = () => {};

      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);

      // ⚠️ `renderer.dispose()` DOES NOT FREE WHAT THE SCENE HOLDS. Every
      // geometry, material and label texture stays on the GPU until disposed
      // by hand, so leaving and re-entering the page would stack them up.
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material: THREE.Material & { map?: THREE.Texture | null }) => {
            material.map?.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();

      if (container.contains(canvas)) {
        container.removeChild(canvas);
      }
    };
  }, []);

  return (
    <main
      style={{
        width: "100%",
        // `dvh` follows a phone's address bar; `vh` is the fallback for older browsers.
        height: "100vh",
        minHeight: "100dvh",
        maxHeight: "100dvh",
        overflow: "hidden",
        position: "relative",
        background: "#f3eee5",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} aria-hidden="true" />

      {webgl === false && (
        <p
          role="status"
          className="absolute inset-x-4 top-4 rounded-xl bg-[var(--sk-ground)]/90 p-3 text-center text-sm text-[var(--sk-ink)]"
        >
          نمای سه‌بعدی روی این دستگاه در دسترس نیست. راسته را از فهرست پایین انتخاب کنید.
        </p>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {selected && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl bg-[var(--sk-ground)]/90 px-4 py-3 text-[var(--sk-ink)] shadow-lg"
          >
            <span className="font-semibold">ورود به {selected.name}</span>
            <button
              type="button"
              onClick={() => select(null)}
              className="rounded-full px-3 py-1 text-sm ring-1 ring-[var(--sk)]"
            >
              بستن
            </button>
          </div>
        )}

        <nav aria-label="راسته‌های بازار" className="pointer-events-auto">
          <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:justify-center">
            {STREETS.map((street) => (
              <li key={street.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => select(street.id)}
                  aria-pressed={street.id === selectedId}
                  className={`rounded-full px-3 py-2 text-sm whitespace-nowrap shadow ${
                    street.id === selectedId
                      ? "bg-[var(--sk)] text-[var(--sk-ground)]"
                      : "bg-[var(--sk-ground)]/85 text-[var(--sk-ink)]"
                  }`}
                >
                  {street.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
