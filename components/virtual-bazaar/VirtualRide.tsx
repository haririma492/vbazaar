"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type LatLng, bearingDegrees, distanceMeters, flightFrame, groundProfile, makePath, planFlight,
  samplePath, straightPath,
} from "@/lib/virtualRide/flight";
import type { RideDistrict } from "@/lib/virtualRide/districts";
import { groundAlong, importLibrary, roadRoute, streetSpot } from "./rideGoogle";

/**
 * The Virtual Ride: from the rider's own address to a shopping district.
 * It begins in Street View on the street in front of their home, facing it,
 * cross-fades into the 3D city at the same spot and lifts off, low over the real roads in Google's photorealistic 3D city, down to eye
 * level on the pavement outside — then either straight into the district's
 * own scene at its start (`enterOnArrival`: World on Yonge → `/vca/splat`;
 * with `onEnter` the scene is already loaded underneath and the landing
 * cross-fades straight into it),
 * or Street View, to walk on from where they landed. Google is the TRANSPORT
 * only: this component knows nothing of splats or R2.
 *
 * The camera is driven frame by frame from `flightFrame` (lib/virtualRide),
 * not by Google's `flyCameraTo`, whose single parabolic arc climbs far too
 * high for a ride between neighbourhoods. The flight's end is therefore our
 * own clock, not an event to wait for.
 */

export type RideOrigin = { location: LatLng; label: string };

type Stage = "planning" | "loading" | "flying" | "entering" | "walking" | "landed" | "failed";

/** Longest wait for the home neighbourhood to draw before taking off anyway. */
const READY_WAIT_MS = 6_000;
/** A beat at home before taking off: longer when standing in front of it in Street View. */
const HOME_HOLD_MS = 1_500;
const STREET_HOLD_MS = 3_000;
/** Street View fades out over the first moments of the climb, and in (or black, before a scene) over the last of the descent. */
const CROSSFADE_MS = 1_500;
/** Landing into a scene preloaded underneath: the whole ride fades away over this. */
const REVEAL_MS = 1_200;

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
  zIndex: 4,
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
  onEnter,
  enterReady = false,
}: {
  origin: RideOrigin;
  to: RideDistrict;
  onExit: () => void;
  /**
   * The destination's scene is mounted (preloading) underneath the ride: on
   * landing, the ride fades away to show it and calls this — no page change,
   * no loading screen. Unset: the ride opens `entryScene` as a new page.
   */
  onEnter?: () => void;
  /** The preloading scene is ready to show; the ride holds at the landing spot until it is. */
  enterReady?: boolean;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const readyRef = useRef(enterReady);
  readyRef.current = enterReady;
  const outerRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const streetRef = useRef<HTMLDivElement>(null);
  const homeStreetRef = useRef<HTMLDivElement>(null);
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

    // Landing into our own scene: no Street View step, the scene opens instead.
    const enter = to.enterOnArrival && to.entryScene ? to.entryScene : null;

    (async () => {
      // 1. Plan: where to stand at home and land at the district (the
      // nearest Street View spots), which roads, how high the ground is.
      const [homeSpot, spot] = await Promise.all([streetSpot(origin.location, 100), streetSpot(to.location)]);
      const start = homeSpot?.location ?? origin.location;
      const landing = spot?.location ?? to.location;
      const road = await roadRoute(start, landing);
      if (gone) return;
      setByRoad(!!road);
      const path = road ? makePath([start, ...road, landing]) : straightPath(start, landing);
      const heights = await groundAlong(samplePath(path, 48), 128);
      if (gone) return;
      const plan = planFlight({
        path,
        ground: heights ? groundProfile(path, heights) : () => to.groundAltitude,
        followsRoad: !!road,
        finalHeading: distanceMeters(landing, to.location) > 8 ? bearingDegrees(landing, to.location) : undefined,
        // Standing on the street, facing the house.
        startHeading: homeSpot
          ? distanceMeters(start, origin.location) > 5
            ? bearingDegrees(start, origin.location)
            : bearingDegrees(start, landing)
          : undefined,
      });

      // 2. Street View in front of home on top; the 3D city at the same spot
      // underneath it; the destination's Street View waiting below both.
      setStage("loading");
      let StreetViewPanorama: any = null;
      if ((homeSpot || (spot && !enter))) {
        try {
          ({ StreetViewPanorama } = await importLibrary("streetView"));
        } catch { /* no Street View: the ride still flies */ }
      }
      const panorama = (el: HTMLDivElement, pano: string, heading: number) =>
        new StreetViewPanorama(el, {
          pano,
          pov: { heading, pitch: 0 },
          zoom: 0,
          addressControl: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          showRoadLabels: false,
        });
      if (gone) return;
      if (homeSpot && StreetViewPanorama && homeStreetRef.current) {
        panorama(homeStreetRef.current, homeSpot.pano, plan.startHeading!);
      }
      let Map3DElement: any;
      try {
        ({ Map3DElement } = await importLibrary("maps3d"));
      } catch (e: any) {
        return fail(e?.message || "Google 3D Maps failed to load");
      }
      if (gone || !mapHostRef.current) return;
      // `mode` is required: without it Map3DElement renders nothing.
      map = new Map3DElement({ ...flightFrame(plan, 0), mode: "SATELLITE", defaultUIHidden: true });
      map.style.cssText = "width:100%;height:100%;display:block";
      map.addEventListener("gmp-error", () => fail("Google 3D Maps reported an error (key, billing or API not enabled?)"));
      mapHostRef.current.appendChild(map);

      if (spot && !enter && StreetViewPanorama && streetRef.current) {
        panorama(streetRef.current, spot.pano, plan.finalHeading);
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
            if (homeStreetRef.current) {
              const away = Math.min(1, t / CROSSFADE_MS);
              homeStreetRef.current.style.opacity = String(1 - away);
              if (away >= 1) homeStreetRef.current.style.display = "none";
            }
            // To black before a scene that opens as a new page; a preloaded one cross-fades from the street instead.
            if ((spot || (enter && !onEnterRef.current)) && mapHostRef.current) {
              const fade = (t - (plan.durationMs - CROSSFADE_MS)) / CROSSFADE_MS;
              mapHostRef.current.style.opacity = String(1 - Math.min(1, Math.max(0, fade)));
            }
            if (t < plan.durationMs) {
              raf = requestAnimationFrame(step);
              return;
            }
            console.log("ARRIVED", to.id);
            if (enter && onEnterRef.current) {
              setStage("entering");
              const reveal = () => {
                if (gone) return;
                if (!readyRef.current) {
                  raf = requestAnimationFrame(reveal); // hold on the pavement until the scene is there
                  return;
                }
                if (outerRef.current) {
                  outerRef.current.style.transition = `opacity ${REVEAL_MS}ms ease`;
                  outerRef.current.style.opacity = "0";
                }
                later(() => !gone && onEnterRef.current?.(), REVEAL_MS);
              };
              reveal();
            } else if (enter) {
              setStage("entering");
              routerRef.current.push(enter);
            } else if (spot) {
              map.remove(); // Street View from here; stop drawing the city
              map = null;
              setStage("walking");
            } else setStage("landed");
          };
          raf = requestAnimationFrame(step);
        }, homeSpot ? STREET_HOLD_MS : HOME_HOLD_MS);
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
    <div ref={outerRef} dir="ltr" style={{ position: "fixed", inset: 0, zIndex: 50, background: "#000" }}>
      <div ref={streetRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      {!walking && <div ref={mapHostRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />}
      {!walking && <div ref={homeStreetRef} style={{ position: "absolute", inset: 0, zIndex: 2 }} />}
      {/* Swallows touches while flying: a grab would fight the camera. */}
      {!walking && <div style={{ position: "absolute", inset: 0, zIndex: 3 }} />}

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
            zIndex: 4,
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
