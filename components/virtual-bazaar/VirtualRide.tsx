"use client";

import { useEffect, useRef, useState } from "react";
import {
  type LatLng, bearingDegrees, distanceMeters, flightFrame, groundProfile, homeCamera, makePath, planFlight,
  samplePath, straightPath,
} from "@/lib/virtualRide/flight";
import type { RideDistrict } from "@/lib/virtualRide/districts";
import { groundAlong, importLibrary, roadRoute, streetSpot } from "./rideGoogle";

/**
 * The Virtual Ride: from the rider's own address to a shopping district,
 * low over the real roads in Google's photorealistic 3D city, down to eye
 * level on the pavement outside — then Street View, so they walk on from
 * where they landed. Google is the TRANSPORT only: this component knows
 * nothing of splats or R2; a district with its own scene links to it.
 *
 * The camera is driven frame by frame from `flightFrame` (lib/virtualRide),
 * not by Google's `flyCameraTo`, whose single parabolic arc climbs far too
 * high for a ride between neighbourhoods. The flight's end is therefore our
 * own clock, not an event to wait for.
 */

export type RideOrigin = { location: LatLng; label: string };

type Stage = "planning" | "loading" | "flying" | "walking" | "landed" | "failed";

/** Longest wait for the home neighbourhood to draw before taking off anyway. */
const READY_WAIT_MS = 6_000;
/** A beat over home before taking off. */
const HOME_HOLD_MS = 1_500;
/** Street View fades in over the last moments of the descent. */
const CROSSFADE_MS = 1_500;

const bar: React.CSSProperties = {
  position: "absolute",
  left: 16,
  right: 16,
  top: 16,
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  color: "#fff",
  font: "500 14px/1.3 system-ui, sans-serif",
  textShadow: "0 1px 3px rgba(0,0,0,.8)",
  zIndex: 3,
};

const pill: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.5)",
  background: "rgba(0,0,0,.45)",
  color: "#fff",
  font: "inherit",
  cursor: "pointer",
  textDecoration: "none",
};

export default function VirtualRide({
  origin,
  to,
  onExit,
}: {
  origin: RideOrigin;
  to: RideDistrict;
  onExit: () => void;
}) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const streetRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("planning");
  const [error, setError] = useState<string | null>(null);
  const [byRoad, setByRoad] = useState(true);

  useEffect(() => {
    let gone = false;
    let map: any = null;
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    const fail = (m: string) => {
      if (gone) return;
      setError(m);
      setStage("failed");
    };

    (async () => {
      // 1. Plan: where to land, which roads, how high the ground is.
      const spot = await streetSpot(to.location);
      const landing = spot?.location ?? to.location;
      const road = await roadRoute(origin.location, landing);
      if (gone) return;
      setByRoad(!!road);
      const path = road ? makePath([origin.location, ...road, landing]) : straightPath(origin.location, landing);
      const heights = await groundAlong(samplePath(path, 48), 128);
      if (gone) return;
      const plan = planFlight({
        path,
        ground: heights ? groundProfile(path, heights) : () => to.groundAltitude,
        followsRoad: !!road,
        finalHeading: distanceMeters(landing, to.location) > 8 ? bearingDegrees(landing, to.location) : undefined,
      });

      // 2. The 3D city over home, and Street View waiting underneath it.
      setStage("loading");
      let Map3DElement: any;
      try {
        ({ Map3DElement } = await importLibrary("maps3d"));
      } catch (e: any) {
        return fail(e?.message || "Google 3D Maps failed to load");
      }
      if (gone || !mapHostRef.current) return;
      // `mode` is required: without it Map3DElement renders nothing.
      map = new Map3DElement({ ...homeCamera(plan), mode: "SATELLITE", defaultUIHidden: true });
      map.style.cssText = "width:100%;height:100%;display:block";
      map.addEventListener("gmp-error", () => fail("Google 3D Maps reported an error (key, billing or API not enabled?)"));
      mapHostRef.current.appendChild(map);

      if (spot && streetRef.current) {
        try {
          const { StreetViewPanorama } = await importLibrary("streetView");
          new StreetViewPanorama(streetRef.current, {
            pano: spot.pano,
            pov: { heading: plan.finalHeading, pitch: 0 },
            zoom: 0,
            addressControl: false,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
            showRoadLabels: false,
          });
        } catch { /* no walk; the ride still lands */ }
      }

      // 3. Fly once home has drawn, after a beat.
      let started = false;
      const fly = () => {
        if (gone || started) return;
        started = true;
        later(() => {
          if (gone) return;
          setStage("flying");
          const t0 = performance.now();
          const step = (now: number) => {
            if (gone) return;
            const t = now - t0;
            const c = flightFrame(plan, t);
            map.center = c.center;
            map.range = c.range;
            map.tilt = c.tilt;
            map.heading = c.heading;
            if (spot && mapHostRef.current) {
              const fade = (t - (plan.durationMs - CROSSFADE_MS)) / CROSSFADE_MS;
              mapHostRef.current.style.opacity = String(1 - Math.min(1, Math.max(0, fade)));
            }
            if (t < plan.durationMs) {
              raf = requestAnimationFrame(step);
              return;
            }
            console.log("ARRIVED", to.id);
            if (spot) {
              map.remove(); // Street View from here; stop drawing the city
              map = null;
              setStage("walking");
            } else setStage("landed");
          };
          raf = requestAnimationFrame(step);
        }, HOME_HOLD_MS);
      };
      map.addEventListener("gmp-steadychange", (e: any) => e?.isSteady && fly());
      later(fly, READY_WAIT_MS);
    })().catch((e) => fail(e?.message || String(e)));

    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      map?.remove();
    };
  }, [origin, to]);

  const walking = stage === "walking";

  return (
    <div dir="ltr" style={{ position: "fixed", inset: 0, zIndex: 50, background: "#000" }}>
      <div ref={streetRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      {!walking && <div ref={mapHostRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />}
      {/* Swallows touches while flying: a grab would fight the camera. */}
      {!walking && <div style={{ position: "absolute", inset: 0, zIndex: 2 }} />}

      <div style={bar}>
        <span>
          {walking
            ? `${to.name.en} — walk with the arrows on the street`
            : `${origin.label} → ${to.name.en}`}
          {stage === "planning" && " · planning the route…"}
          {stage === "loading" && " · getting ready…"}
          {stage === "flying" && !byRoad && " · (straight line: Routes API unavailable)"}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          {walking && to.entryScene && (
            <a href={to.entryScene} style={pill}>Enter {to.name.en}</a>
          )}
          <button type="button" onClick={onExit} style={pill}>
            {walking ? "Leave" : "Cancel"}
          </button>
        </span>
      </div>

      {(stage === "failed" || stage === "landed") && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            display: "grid",
            placeItems: "center",
            padding: 16,
            color: "#fff",
            font: "15px/1.5 system-ui, sans-serif",
            textAlign: "center",
            background: stage === "landed" ? "rgba(0,0,0,.55)" : undefined,
          }}
        >
          <div>
            <p style={{ margin: "0 0 12px" }}>
              {stage === "failed"
                ? `The ride can't start: ${error}`
                : `You have arrived at ${to.name.en}. Google has no street-level view here to walk in.`}
            </p>
            {to.entryScene && (
              <a href={to.entryScene} style={{ ...pill, marginRight: 8 }}>Enter {to.name.en}</a>
            )}
            <button type="button" onClick={onExit} style={pill}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
