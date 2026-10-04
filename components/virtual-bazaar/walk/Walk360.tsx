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
 *   /vca/walk?v=scenes/<scene>/<file>.mp4   a video in the scenes bucket
 *   /vca/walk?src=<url>                     any video (https, or this site)
 *   …&debug=1                               resolution, buffering, rate
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import WalkStick from "../splat/WalkStick";
import { deviceQuaternion, hasDeviceOrientation, requestDeviceOrientation, screenAngle } from "../scene/deviceOrientation";

/** «Slow / Normal / Fast»: how fast full stick plays the walk (1 = as filmed). */
const SPEEDS = [
  { label: "آهسته · Slow", rate: 0.5 },
  { label: "معمولی · Normal", rate: 1 },
  { label: "تند · Fast", rate: 2 },
];
const SPEED_KEY = "sk-walk-speed";
/** Full steering turns this fast (rad/s). */
const TURN_RATE = 0.8;
/** How long starting, stopping and turning take to settle (s). */
const EASE_S = 0.35;
/** Below this the walk stands still. */
const DEAD = 0.04;
/** Forward slower than this is stepped like backward: browsers play no slower smoothly. */
const MIN_PLAY_RATE = 0.25;
const UP = new THREE.Vector3(0, 1, 0);

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

async function resolveSrc(params: URLSearchParams): Promise<string | null> {
  const src = params.get("src");
  if (src) return safeSrc(src);
  const key = params.get("v") || "";
  if (!/^scenes\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(key)) return null;
  try {
    const res = await fetch("/api/splats/config", { cache: "no-store" });
    const { base } = (await res.json()) as { base: string | null };
    return base ? `${base.replace(/\/+$/, "")}/${key}` : null;
  } catch {
    return null;
  }
}

const mmss = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "–:––");

type Engine = {
  video: HTMLVideoElement;
  setMove: (x: number, y: number) => void;
  setGyro: (on: boolean) => void;
  setSpeed: (rate: number) => void;
};

export default function Walk360() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "walking" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState({ now: 0, total: 0 });
  const [speedIx, setSpeedIx] = useState(1);
  const [gyro, setGyro] = useState<"off" | "on" | "refused">("off");
  const [debug, setDebug] = useState(false);
  const [info, setInfo] = useState("");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const params = new URLSearchParams(window.location.search);
    setDebug(params.get("debug") === "1");
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, el.clientWidth / el.clientHeight, 0.1, 200);

    // ── The video, wrapped round the visitor ──────────────────────────────
    const video = document.createElement("video");
    video.crossOrigin = "anonymous"; // a WebGL texture needs the bucket's CORS
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.loop = false;
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const geometry = new THREE.SphereGeometry(50, 128, 64);
    geometry.scale(-1, 1, 1); // seen from inside
    const sphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
    // The middle of an equirectangular frame is where the camera faced; turn
    // it to −Z, where a three.js camera looks at yaw 0.
    sphere.rotation.y = -Math.PI / 2;
    scene.add(sphere);

    let stickX = 0;
    let stickY = 0;
    let maxRate = SPEEDS[1].rate;
    let gyroOn = false;
    let gyroHave = false;
    const gyroQ = new THREE.Quaternion();
    const turnQ = new THREE.Quaternion();
    let yaw = 0;
    let pitch = 0;
    let turnYaw = 0;
    let velTurn = 0;
    let rate = 0; // eased walk rate: + forward, − back, in "times as filmed"
    let seeking = false;
    let stepDebt = 0; // seconds of stepping owed while a seek was in flight

    video.addEventListener("seeked", () => (seeking = false));
    video.addEventListener("loadedmetadata", () => {
      setTime({ now: video.currentTime, total: video.duration });
      setInfo(`${video.videoWidth}×${video.videoHeight} · ${mmss(video.duration)}`);
    });
    video.addEventListener("canplay", () => setPhase((p) => (p === "loading" ? "ready" : p)), { once: true });
    video.addEventListener("error", () => {
      setPhase("error");
      setError("The walk video could not be loaded. Is the bucket's CORS set, and is the file an MP4 (H.264)?");
    });

    engine.current = {
      video,
      setMove(x, y) {
        stickX = x;
        stickY = y;
      },
      setGyro(on) {
        gyroOn = on;
      },
      setSpeed(r) {
        maxRate = r;
      },
    };

    void resolveSrc(params).then((src) => {
      if (disposed) return;
      if (!src) {
        setPhase("error");
        setError("No walk video: open with ?v=scenes/<scene>/<file>.mp4 (from /operator/splats).");
        return;
      }
      video.src = src;
      video.load();
    });

    // ── Looking: finger, wheel/pinch, phone ───────────────────────────────
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const zoom = (f: number) => {
      camera.fov = THREE.MathUtils.clamp(camera.fov * f, 30, 100);
      camera.updateProjectionMatrix();
    };
    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (pointers.size === 1 && !(gyroOn && gyroHave)) {
        const k = (camera.fov / el.clientHeight) * (Math.PI / 180);
        yaw += (e.clientX - prev.x) * k;
        pitch = THREE.MathUtils.clamp(pitch + (e.clientY - prev.y) * k, -1.45, 1.45);
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
    const onKey = (e: KeyboardEvent) => {
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

    // ── The loop: look, then walk the video ───────────────────────────────
    const clock = new THREE.Clock();
    const look = new THREE.Euler(0, 0, 0, "YXZ");
    let shownAt = 0;
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const ease = 1 - Math.exp(-dt / EASE_S);
      const shape = (v: number) => Math.sign(v) * v * v;

      let wantTurn = shape(stickX);
      if (keys.has("d") || keys.has("arrowright")) wantTurn = 1;
      if (keys.has("a") || keys.has("arrowleft")) wantTurn = -1;
      velTurn += (wantTurn * TURN_RATE - velTurn) * ease;
      turnYaw += velTurn * dt;
      if (gyroOn && gyroHave) camera.quaternion.copy(turnQ.setFromAxisAngle(UP, -turnYaw)).multiply(gyroQ);
      else camera.quaternion.setFromEuler(look.set(-pitch, -(yaw + turnYaw), 0));

      let wantRate = shape(-stickY);
      if (keys.has("w") || keys.has("arrowup")) wantRate = 1;
      if (keys.has("s") || keys.has("arrowdown")) wantRate = -1;
      rate += (wantRate * maxRate - rate) * ease;

      if (video.readyState >= 2 && Number.isFinite(video.duration)) {
        if (rate >= MIN_PLAY_RATE) {
          // Walking on at a pace a browser plays smoothly: let it play.
          video.playbackRate = Math.min(4, rate);
          if (video.paused && video.currentTime < video.duration - 0.05) void video.play().catch(() => {});
          stepDebt = 0;
        } else {
          if (!video.paused) video.pause();
          if (Math.abs(rate) > DEAD) {
            // Walking back, or creeping on: step the time, one seek in flight at a time.
            stepDebt += rate * dt;
            if (!seeking && Math.abs(stepDebt) >= 1 / 60) {
              const to = THREE.MathUtils.clamp(video.currentTime + stepDebt, 0, video.duration);
              stepDebt = 0;
              if (to !== video.currentTime) {
                seeking = true;
                video.currentTime = to;
              }
            }
          } else stepDebt = 0;
        }
      }

      renderer.render(scene, camera);
      const now = performance.now();
      if (now - shownAt > 250) {
        shownAt = now;
        setTime({ now: video.currentTime, total: video.duration });
      }
    });

    return () => {
      disposed = true;
      engine.current = null;
      renderer.setAnimationLoop(null);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      video.pause();
      video.removeAttribute("src");
      video.load();
      texture.dispose();
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  // Walking speed, remembered on this device.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SPEED_KEY);
      const saved = raw == null ? NaN : Number(raw);
      if (Number.isInteger(saved) && saved >= 0 && saved < SPEEDS.length) setSpeedIx(saved);
    } catch {
      /* private mode: Normal */
    }
  }, []);
  useEffect(() => {
    engine.current?.setSpeed(SPEEDS[speedIx].rate);
  }, [speedIx]);

  /**
   * «Start walking». ⚠️ ONE TAP, TWO PERMISSIONS, IN THIS ORDER: iOS only
   * shares the phone's motion when asked inside a tap, before any other await;
   * then the video is started once so later play() calls are allowed.
   */
  async function start() {
    const v = engine.current?.video;
    // Phone motion only on a touch screen: a computer reports the API but has
    // no sensor, and would be left unable to look with the mouse.
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const ok = touch && hasDeviceOrientation() && (await requestDeviceOrientation());
    engine.current?.setGyro(ok);
    setGyro(ok ? "on" : "off");
    if (v) {
      try {
        await v.play();
        v.pause();
      } catch {
        /* the stick will try again */
      }
    }
    setPhase("walking");
  }

  async function toggleGyro() {
    if (gyro === "on") {
      engine.current?.setGyro(false);
      return setGyro("off");
    }
    const ok = hasDeviceOrientation() && (await requestDeviceOrientation());
    engine.current?.setGyro(ok);
    setGyro(ok ? "on" : "refused");
  }

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={host} className="absolute inset-0" />

      {phase === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] text-white/85">
          در حال آماده‌سازی… · Getting ready…
        </div>
      )}
      {phase === "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <button onClick={() => void start()} className="rounded-full border border-amber-300/70 bg-amber-300/25 px-8 py-4 text-[18px] font-bold text-amber-50">
            شروع قدم زدن · Start walking
          </button>
        </div>
      )}
      {phase === "error" && (
        <div dir="ltr" className="absolute inset-x-4 top-16 rounded-xl bg-black/75 p-3 text-center text-[14px] text-rose-200">{error}</div>
      )}

      {debug && (
        <div dir="ltr" className="pointer-events-none absolute left-3 top-3 rounded-xl bg-black/60 p-2 font-mono text-[11px] text-white/80">
          {info} · {mmss(time.now)}
        </div>
      )}

      {phase === "walking" && (
        <>
          <WalkStick onMove={(x, y) => engine.current?.setMove(x, y)} />
          <button
            dir="ltr"
            onClick={() => {
              const next = (speedIx + 1) % SPEEDS.length;
              setSpeedIx(next);
              try { window.localStorage.setItem(SPEED_KEY, String(next)); } catch { /* fine */ }
            }}
            className="absolute bottom-[15.5rem] right-5 w-40 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 text-[12px] text-white/85"
          >
            {SPEEDS[speedIx].label}
          </button>
          <button
            dir="ltr"
            onClick={() => void toggleGyro()}
            className="absolute bottom-[18rem] right-5 w-40 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 text-[12px] text-white/85"
          >
            {gyro === "on" ? "نگاه با انگشت · Look by finger" : gyro === "refused" ? "گوشی اجازه نداد" : "نگاه با گوشی · Look by phone"}
          </button>

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
                const v = engine.current?.video;
                if (v) v.currentTime = Number(e.target.value);
              }}
              aria-label="Where along the walk"
              className="h-8 flex-1 accent-amber-300"
            />
            <span className="w-10 font-mono text-[12px] text-white/70">{mmss(time.total)}</span>
          </div>
        </>
      )}
    </div>
  );
}
