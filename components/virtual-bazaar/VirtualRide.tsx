"use client";

import { useEffect, useRef, useState } from "react";
import { arrivalCamera, departureCamera, distanceMeters, rideDurationMillis } from "@/lib/virtualRide/camera";
import type { RideDistrict } from "@/lib/virtualRide/districts";

/**
 * The Virtual Ride: a full-screen Google photorealistic 3D flight from one
 * shopping district to another, then `onArrival()`. Google is the TRANSPORT
 * between our scenes only — this component knows nothing of splats, R2 or the
 * bazaar; its caller swaps in the destination's own scene.
 *
 * The flight is ONE `flyCameraTo`: Google's own move is parabolic, so it lifts
 * off, travels and comes down by itself. Arrival is Google's
 * `gmp-animationend` event, not a timer; the timer below only rescues a ride
 * whose event never comes (a tab put to sleep mid-flight, say).
 *
 * ⚠️ THE SAME KEY AS THE BUTCHER AND COVERAGE MAPS,
 * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, baked in at build time. Photorealistic 3D
 * in the Maps JavaScript API needs nothing more enabled than the Maps
 * JavaScript API itself, and no map id. Without a key the ride says so and
 * offers to go straight to the destination.
 */

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

/** Longest wait for the departure city to draw before taking off anyway. */
const READY_WAIT_MS = 6_000;
/** A beat over the departure point, so it registers where the ride began. */
const DEPART_HOLD_MS = 900;
/** The Google view fades out over this long before `onArrival`. */
const FADE_MS = 900;

let mapsLoad: Promise<any> | null = null;
function loadMaps(key: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google);
  if (mapsLoad) return mapsLoad;
  mapsLoad = new Promise((resolve, reject) => {
    w.__skRideMapsReady = () => resolve(w.google);
    const s = document.createElement("script");
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&loading=async&region=CA&callback=__skRideMapsReady`;
    s.async = true;
    s.onerror = () => {
      mapsLoad = null;
      s.remove();
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(s);
  });
  return mapsLoad;
}

type Phase = "loading" | "flying" | "arriving" | "failed";

export default function VirtualRide({
  from,
  to,
  onArrival,
}: {
  from: RideDistrict;
  to: RideDistrict;
  onArrival: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  // The latest callback, so a re-render mid-flight doesn't restart the ride.
  const arrivedRef = useRef(onArrival);
  arrivedRef.current = onArrival;

  useEffect(() => {
    let gone = false;
    let landed = false;
    let map: any = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

    const fail = (message: string) => {
      if (gone) return;
      setError(message);
      setPhase("failed");
    };

    const land = (how: "event" | "timeout") => {
      if (gone || landed) return;
      landed = true;
      if (how === "timeout") console.warn("Virtual ride: no gmp-animationend, landing on the timer");
      console.log("ARRIVED", to.id);
      setPhase("arriving");
      later(() => !gone && arrivedRef.current(), FADE_MS);
    };

    (async () => {
      if (!MAPS_KEY) return fail("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set");
      let Map3DElement: any;
      try {
        const google = await loadMaps(MAPS_KEY);
        ({ Map3DElement } = await google.maps.importLibrary("maps3d"));
      } catch (e: any) {
        return fail(e?.message || "Google 3D Maps failed to load");
      }
      if (gone || !hostRef.current) return;

      const start = departureCamera(from.location, to.location, from.rideArrival);
      const end = arrivalCamera(from.location, to.location, to.rideArrival);
      const duration = rideDurationMillis(distanceMeters(from.location, to.location));

      // `mode` is required: without it Map3DElement renders nothing.
      map = new Map3DElement({ ...start, mode: "SATELLITE", defaultUIHidden: true });
      map.style.width = "100%";
      map.style.height = "100%";
      map.style.display = "block";
      map.addEventListener("gmp-error", () => fail("Google 3D Maps reported an error (key, billing or API not enabled?)"));
      hostRef.current.appendChild(map);

      // Take off once the departure city has drawn (the first steady frame),
      // or after READY_WAIT_MS if it is slow, after a short hold.
      let tookOff = false;
      const takeOff = () => {
        if (gone || tookOff) return;
        tookOff = true;
        later(() => {
          if (gone) return;
          map.addEventListener("gmp-animationend", () => land("event"), { once: true });
          map.flyCameraTo({ endCamera: end, durationMillis: duration });
          setPhase("flying");
          later(() => land("timeout"), duration + 8_000);
        }, DEPART_HOLD_MS);
      };
      map.addEventListener("gmp-steadychange", (e: any) => e?.isSteady && takeOff());
      later(takeOff, READY_WAIT_MS);
    })();

    return () => {
      gone = true;
      timers.forEach(clearTimeout);
      if (map) {
        try { map.stopCameraAnimation(); } catch { /* already stopped */ }
        map.remove();
      }
    };
  }, [from, to]);

  return (
    <div
      dir="ltr"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "#000",
        opacity: phase === "arriving" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-in`,
      }}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />

      {/* Swallows touches and drags: a grab mid-flight would stop the camera. */}
      <div style={{ position: "absolute", inset: 0 }} />

      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          color: "#fff",
          font: "500 14px/1.3 system-ui, sans-serif",
          textShadow: "0 1px 3px rgba(0,0,0,.8)",
        }}
      >
        <span>
          {from.name.en} → {to.name.en}
          {phase === "loading" && " · getting ready…"}
        </span>
        <button
          type="button"
          onClick={() => arrivedRef.current()}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,.5)",
            background: "rgba(0,0,0,.35)",
            color: "#fff",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Skip
        </button>
      </div>

      {phase === "failed" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 16,
            color: "#fff",
            font: "15px/1.5 system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          <div>
            <p style={{ margin: "0 0 12px" }}>The ride can&apos;t start: {error}</p>
            <button
              type="button"
              onClick={() => arrivedRef.current()}
              style={{ padding: "8px 16px", borderRadius: 8, border: 0, cursor: "pointer", font: "inherit" }}
            >
              Go straight to {to.name.en}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
