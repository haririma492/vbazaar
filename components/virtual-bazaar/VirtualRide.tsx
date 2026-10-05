"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type LatLng, type Vehicle, RIDE, bearingDegrees, distanceMeters, flightFrame, formatDuration, groundProfile,
  makePath, planFlight, rideDistance, samplePath, straightPath,
} from "@/lib/virtualRide/flight";
import type { RideDistrict } from "@/lib/virtualRide/districts";
import { BOARDING, BOARDING_MS, alightingFrame, boardingFrame, type BoardingFrame } from "@/lib/virtualRide/boarding";
import { groundAlong, importLibrary, roadRoute, streetSpot } from "./rideGoogle";
import { createDrone, type DronePlayer } from "./rideDrone";
import { TAXI_ALIGHTING_MS, TAXI_BOARDING_MS, taxiAlightingFrame, taxiBoardingFrame } from "@/lib/virtualRide/taxi";
import { createTaxi, type TaxiPlayer } from "./rideTaxi";

/**
 * The Virtual Ride: from the rider's own address to a shopping district.
 * It begins in Street View on the street in front of their home, facing it:
 * a drone waits on the street, spins up and glides in under them, carries
 * them a couple of metres and fades as the view cross-fades into the 3D
 * city at the same spot and lifts off, low over the real roads in Google's photorealistic 3D city, down to eye
 * level on the pavement outside, into Street View there with the drone
 * still under them, which carries them on and sets down ahead — then either
 * straight into the district's
 * own scene at its start (`enterOnArrival`: World on Yonge → `/vca/splat`;
 * with `onEnter` the scene is already loaded underneath and the landing
 * cross-fades straight into it),
 * or Street View, to walk on from where they landed. Google is the TRANSPORT
 * only: this component knows nothing of splats or R2.
 *
 * By taxi instead (`vehicle`): a yellow cab pulls up in Street View, the
 * rider gets in, and the 3D city follows it along the roads from a few
 * metres up and behind; at the district it pulls up, they get out, it
 * drives off.
 *
 * The camera is driven frame by frame from `flightFrame` (lib/virtualRide),
 * not by Google's `flyCameraTo`, whose single parabolic arc climbs far too
 * high for a ride between neighbourhoods. The flight's end is therefore our
 * own clock, not an event to wait for.
 */

export type RideOrigin = { location: LatLng; label: string };

type Stage = "planning" | "loading" | "boarding" | "flying" | "alighting" | "entering" | "walking" | "landed" | "failed";

/** Longest wait for the home neighbourhood to draw before taking off anyway. */
const READY_WAIT_MS = 6_000;
/** A beat at home before taking off: longer when standing in front of it in Street View. */
const HOME_HOLD_MS = 1_500;
const STREET_HOLD_MS = 3_000;
/** Street View fades out over the first moments of the climb, and in (or black, before a scene) over the last of the descent. */
const CROSSFADE_MS = 1_500;
/** Landing into a scene preloaded underneath: the whole ride fades away over this. */
const REVEAL_MS = 1_200;
/** The parked drone stays a moment before the scene fades in. */
const PARKED_MS = 600;

/**
 * Everything but the flight, when there is Street View at both ends and the
 * ride lands into a scene: the beat at home, boarding, getting off, the beat
 * by the parked drone, the fade into the scene. For the start screen's
 * estimate.
 */
export const RIDE_EXTRAS_MS = STREET_HOLD_MS + BOARDING_MS + BOARDING_MS + PARKED_MS + REVEAL_MS;
/** Street View zoom 1 is 90° across, as the drone's camera; carrying dollies in to this. */
const CARRY_ZOOM = 1.35;
const dolly = (pano: any) => (f: BoardingFrame) => {
  try { pano?.setZoom(1 + (CARRY_ZOOM - 1) * (f.carried / BOARDING.carryMeters)); } catch { /* still flies */ }
};

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
  vehicle = "drone",
  pace = 1,
  estimateMs,
}: {
  origin: RideOrigin;
  to: RideDistrict;
  onExit: () => void;
  /** By drone (the default) or by taxi; a taxi needs a road route, else it goes by drone. */
  vehicle?: Vehicle;
  /** A multiplier on the flight's duration (`PACES`: slower 1.6, faster 0.6). */
  pace?: number;
  /** The start screen's estimate of the whole ride, shown until the ride's own clock starts. */
  estimateMs?: number;
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
  const droneRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("planning");
  const [error, setError] = useState<string | null>(null);
  const [byRoad, setByRoad] = useState(true);
  // The countdown: when the ride (boarding to scene) will be over, by performance.now().
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (endsAt == null) return;
    setNow(performance.now());
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  useEffect(() => {
    let gone = false;
    let map: any = null;
    let drone: DronePlayer | null = null;
    let taxi: TaxiPlayer | null = null;
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
      const [homeSpot, spot] = await Promise.all([
        streetSpot(origin.location, 100),
        // A district's own street spot is exact; snap only to its panorama.
        to.street ? streetSpot(to.street, 25) : streetSpot(to.location),
      ]);
      const start = homeSpot?.location ?? origin.location;
      const landing = spot?.location ?? (to.street ? { lat: to.street.lat, lng: to.street.lng } : to.location);
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
        finalHeading:
          to.street?.heading ??
          (distanceMeters(landing, to.location) > 8 ? bearingDegrees(landing, to.location) : undefined),
        // Standing on the street, facing the house.
        startHeading: homeSpot
          ? distanceMeters(start, origin.location) > 5
            ? bearingDegrees(start, origin.location)
            : bearingDegrees(start, landing)
          : undefined,
        vehicle,
        pace,
      });
      const byTaxi = plan.vehicle === "taxi";

      // 2. Street View in front of home on top; the 3D city at the same spot
      // underneath it; the destination's Street View waiting below both.
      setStage("loading");
      let StreetViewPanorama: any = null;
      if (homeSpot || spot) {
        try {
          ({ StreetViewPanorama } = await importLibrary("streetView"));
        } catch { /* no Street View: the ride still flies */ }
      }
      const panorama = (el: HTMLDivElement, pano: string, heading: number) =>
        new StreetViewPanorama(el, {
          pano,
          pov: { heading, pitch: 0 },
          zoom: 1,
          addressControl: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          showRoadLabels: false,
        });
      if (gone) return;
      const homePano =
        homeSpot && StreetViewPanorama && homeStreetRef.current
          ? panorama(homeStreetRef.current, homeSpot.pano, plan.startHeading!)
          : null;
      let Map3DElement: any;
      try {
        ({ Map3DElement } = await importLibrary("maps3d"));
      } catch (e: any) {
        return fail(e?.message || "Google 3D Maps failed to load");
      }
      if (gone || !mapHostRef.current) return;
      // `mode` is required: without it Map3DElement renders nothing.
      map = new Map3DElement({
        ...flightFrame(plan, 0),
        mode: "SATELLITE",
        defaultUIHidden: true,
        // The taxi is drawn with this same field of view, so it sits on the road.
        ...(byTaxi ? { fov: RIDE.taxi.fov } : {}),
      });
      map.style.cssText = "width:100%;height:100%;display:block";
      map.addEventListener("gmp-error", () => fail("Google 3D Maps reported an error (key, billing or API not enabled?)"));
      mapHostRef.current.appendChild(map);

      const destPano =
        spot && StreetViewPanorama && streetRef.current ? panorama(streetRef.current, spot.pano, plan.finalHeading) : null;

      /** The drone over Street View, playing one of its timelines; null if it can't be drawn. */
      const playDrone = async (frameAt: (t: number) => BoardingFrame, pano: any) => {
        if (!droneRef.current) return;
        try {
          drone?.dispose();
          drone = await createDrone(droneRef.current);
          if (gone) return;
          await drone.play(frameAt, BOARDING_MS, dolly(pano));
        } catch (e) {
          console.warn("Virtual ride: no drone", e);
        }
      };

      /** The taxi over Street View, playing one of its timelines (kept for the drive). */
      const playTaxi = async (frameAt: typeof taxiBoardingFrame, durationMs: number) => {
        if (!droneRef.current) return;
        try {
          taxi ??= await createTaxi(droneRef.current);
          if (gone) return;
          taxi.street();
          await taxi.play(frameAt, durationMs);
        } catch (e) {
          console.warn("Virtual ride: no taxi", e);
        }
      };

      // 3. Fly once home has drawn, after a beat.
      let started = false;
      const fly = () => {
        if (gone || started) return;
        started = true;
        later(async () => {
          if (gone) return;
          // The clock the rider sees: boarding, the flight, getting off and into the scene.
          setEndsAt(
            performance.now() +
              (homePano ? (byTaxi ? TAXI_BOARDING_MS : BOARDING_MS) : 0) +
              plan.durationMs +
              (enter && onEnterRef.current
                ? (destPano ? (byTaxi ? TAXI_ALIGHTING_MS : BOARDING_MS) + PARKED_MS : 0) + REVEAL_MS
                : 0),
          );
          // Board the drone, or get into the taxi, in front of home.
          if (homePano) {
            setStage("boarding");
            if (byTaxi) await playTaxi(taxiBoardingFrame, TAXI_BOARDING_MS);
            else {
              await playDrone(boardingFrame, homePano);
              drone?.dispose();
              drone = null;
            }
            if (gone) return;
          }
          if (byTaxi && droneRef.current) {
            try {
              taxi ??= await createTaxi(droneRef.current);
              taxi.chase();
            } catch (e) {
              console.warn("Virtual ride: no taxi", e);
            }
            if (gone) return;
          }
          setStage("flying");
          const t0 = performance.now();
          let lastT = 0;
          let lastS = 0;
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
            if (byTaxi && taxi) {
              // The cab on the road at the view's centre, fading in from Street View and out to it.
              const s = rideDistance(plan, t);
              const dt = Math.max(1e-3, (t - lastT) / 1000);
              const fadeIn = homePano ? Math.min(1, t / CROSSFADE_MS) : 1;
              const fadeOut = spot ? 1 - Math.min(1, Math.max(0, (t - (plan.durationMs - CROSSFADE_MS)) / CROSSFADE_MS)) : 1;
              taxi.pose({ car: { x: 0, y: 0, z: -RIDE.taxi.behind }, yaw: 0, speed: (s - lastS) / dt, opacity: Math.min(fadeIn, fadeOut) }, dt);
              lastT = t;
              lastS = s;
            }
            if (t < plan.durationMs) {
              raf = requestAnimationFrame(step);
              return;
            }
            console.log("ARRIVED", to.id);
            if (enter && onEnterRef.current) {
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
              if (destPano) {
                // Off the drone (or out of the taxi) on the pavement outside, then into the scene.
                map.remove();
                map = null;
                setStage("alighting");
                const off = byTaxi ? playTaxi(taxiAlightingFrame, TAXI_ALIGHTING_MS) : playDrone(alightingFrame, destPano);
                void off.then(() => {
                  if (gone) return;
                  setStage("entering");
                  later(reveal, PARKED_MS);
                });
              } else {
                setStage("entering");
                reveal();
              }
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
      drone?.dispose();
      taxi?.dispose();
    };
  }, [origin, to, vehicle, pace]);

  const walking = stage === "walking";

  return (
    <div ref={outerRef} dir="ltr" style={{ position: "fixed", inset: 0, zIndex: 50, background: "#000" }}>
      <div ref={streetRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />
      {!walking && <div ref={mapHostRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />}
      {!walking && <div ref={homeStreetRef} style={{ position: "absolute", inset: 0, zIndex: 2 }} />}
      <div ref={droneRef} style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }} />
      {/* Swallows touches while flying: a grab would fight the camera. */}
      {!walking && <div style={{ position: "absolute", inset: 0, zIndex: 3 }} />}

      <div style={bar}>
        <span>
          {walking
            ? `${to.name.en} — walk with the arrows on the street`
            : `${origin.label} → ${to.name.en}`}
          {endsAt != null
            ? !walking && stage !== "failed" && stage !== "landed" && ` · ≈ ${formatDuration(endsAt - now)} left`
            : estimateMs != null && stage !== "failed" && ` · ≈ ${formatDuration(estimateMs)}`}
          {stage === "planning" && " · planning the route…"}
          {stage === "loading" && " · getting ready…"}
          {stage === "flying" && !byRoad && " · (straight line: Routes API unavailable)"}
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            title="Virtual Shopping Ride"
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              background: "rgba(0,0,0,.45)",
              border: "1px solid rgba(242,163,58,.7)",
              font: "600 11px/1.2 system-ui, sans-serif",
              letterSpacing: ".04em",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "#f2a33a" }}>VCR</span>
            <span style={{ fontWeight: 400, opacity: 0.85 }}> · Virtual Shopping Ride</span>
          </span>
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
