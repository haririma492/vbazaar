"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import VirtualRide, { RIDE_EXTRAS_MS, type RideOrigin } from "./VirtualRide";
import {
  type PaceId, type Vehicle, PACES, distanceMeters, formatDuration, makePath, paceFactor, rideEstimateMillis,
} from "@/lib/virtualRide/flight";
import { roadRoute } from "./rideGoogle";
import { DISTRICTS, districtById } from "@/lib/virtualRide/districts";
import { importLibrary } from "./rideGoogle";

/**
 * `/vca/ride`: where are you starting from → where to → the ride. The
 * address goes to Google (to find it and route from it) and is remembered in
 * this browser only, for next time; it is never sent to our server.
 */

const REMEMBER = "sk-ride-origin";
const REMEMBER_VEHICLE = "sk-ride-vehicle";
const REMEMBER_PACE = "sk-ride-pace";
/** Roads are longer than the crow flies; until the route is back, this much. */
const ROAD_FACTOR = 1.3;

/**
 * ⚠️ BY TAXI IS OFF (operator, 2026-10-05: the cab wandered across the road
 * and drove on the wrong side). The route is the road's centreline and the
 * chase camera puts the car on it, so it is never in a lane. Its code stays
 * (rideTaxi.ts, lib/virtualRide/taxi.ts, `vehicle: "taxi"` in the flight
 * plan); listing it here again brings the «How?» choice back.
 */
const VEHICLES: { id: Vehicle; en: string; fa: string; icon: string; note: string }[] = [
  { id: "drone", en: "By drone", fa: "با پهپاد", icon: "🚁", note: "Low over the roads, landing on the pavement" },
];

type Preloadable = ComponentType<{ preload?: boolean; onReady?: () => void }>;

/**
 * Our scenes the ride can load in the background during the flight, by the
 * `entryScene` address a district names. The visitor lands straight into it:
 * no page change, no «Getting ready». Any other address opens as a new page.
 */
const PRELOADABLE: Record<string, Preloadable> = {
  "/vca/splat": dynamic(() => import("./splat/SplatTour"), { ssr: false }),
};

function remembered(): RideOrigin | null {
  try {
    const o = JSON.parse(localStorage.getItem(REMEMBER) || "null");
    return Number.isFinite(o?.location?.lat) && Number.isFinite(o?.location?.lng) && o.label ? o : null;
  } catch {
    return null;
  }
}

function remember(o: RideOrigin) {
  try { localStorage.setItem(REMEMBER, JSON.stringify(o)); } catch { /* fine without */ }
}

export default function VirtualRideDemo({ toId }: { toId: string | null }) {
  const [origin, setOrigin] = useState<RideOrigin | null>(null);
  const [toIdState, setToId] = useState<string>(districtById(toId)?.id ?? DISTRICTS[0].id);
  const [riding, setRiding] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle>("drone");
  useEffect(() => {
    try {
      const v = localStorage.getItem(REMEMBER_VEHICLE);
      if (VEHICLES.some((x) => x.id === v)) setVehicle(v as Vehicle);
    } catch { /* the default */ }
  }, []);
  const [pace, setPace] = useState<PaceId>("normal");
  useEffect(() => {
    try {
      const v = localStorage.getItem(REMEMBER_PACE);
      if (PACES.some((p) => p.id === v)) setPace(v as PaceId);
    } catch { /* the default */ }
  }, []);
  const choosePace = (v: PaceId) => {
    setPace(v);
    try { localStorage.setItem(REMEMBER_PACE, v); } catch { /* fine without */ }
  };
  const chooseVehicle = (v: Vehicle) => {
    setVehicle(v);
    try { localStorage.setItem(REMEMBER_VEHICLE, v); } catch { /* fine without */ }
  };
  const [sceneReady, setSceneReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const to = districtById(toIdState)!;
  // How far the ride goes: by the road route once Google answers, as the crow flies × ROAD_FACTOR until then.
  const [route, setRoute] = useState<{ key: string; meters: number; byRoad: boolean } | null>(null);
  const landingAt = to.street ? { lat: to.street.lat, lng: to.street.lng } : to.location;
  const routeKey = origin ? `${origin.location.lat},${origin.location.lng}→${to.id}` : "";
  useEffect(() => {
    if (!origin) return;
    let gone = false;
    setRoute({ key: routeKey, meters: distanceMeters(origin.location, landingAt) * ROAD_FACTOR, byRoad: false });
    void roadRoute(origin.location, landingAt).then((pts) => {
      if (!gone && pts) setRoute({ key: routeKey, meters: makePath(pts).length, byRoad: true });
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  const meters = route?.key === routeKey ? route.meters : null;
  const estimate = (id: PaceId) =>
    meters == null ? null : rideEstimateMillis(meters, paceFactor(id), vehicle) + RIDE_EXTRAS_MS;
  const estimateMs = estimate(pace);

  const Scene = to.enterOnArrival && to.entryScene ? PRELOADABLE[to.entryScene] ?? null : null;

  useEffect(() => setOrigin(remembered()), []);

  const pick = (o: RideOrigin) => {
    setOrigin(o);
    remember(o);
  };

  const exit = () => {
    setRiding(false);
    setSceneReady(false);
  };
  const enter = () => {
    setEntered(true);
    // The scene's own address from here: a reload or a shared link opens it.
    try { window.history.replaceState({ splatDepth: 0 }, "", to.entryScene!); } catch { /* stays /vca/ride */ }
  };

  if (riding && origin && Scene) {
    return (
      <>
        <Scene preload={!entered} onReady={() => setSceneReady(true)} />
        {!entered && (
          <VirtualRide
            origin={origin}
            to={to}
            vehicle={vehicle}
            pace={paceFactor(pace)}
            estimateMs={estimateMs ?? undefined}
            onExit={exit}
            onEnter={enter}
            enterReady={sceneReady}
          />
        )}
      </>
    );
  }
  if (riding && origin) {
    return (
      <VirtualRide
        origin={origin}
        to={to}
        vehicle={vehicle}
        pace={paceFactor(pace)}
        estimateMs={estimateMs ?? undefined}
        onExit={exit}
      />
    );
  }

  return (
    <main dir="ltr" className="min-h-screen grid place-items-center p-4 bg-neutral-950 text-white">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-3xl font-bold">Virtual Ride</h1>
          <p className="text-neutral-300" dir="rtl">سفر مجازی</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-sm text-neutral-400">Where are you starting from?</h2>
          <AddressPicker onPick={pick} />
          {origin && (
            <p className="text-sm">
              Starting from <span className="font-semibold">{origin.label}</span>
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm text-neutral-400">Where to?</h2>
          <div className="flex flex-wrap gap-2">
            {DISTRICTS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setToId(d.id)}
                className={`px-4 py-2 rounded-full border ${
                  d.id === to.id ? "bg-white text-black border-white" : "border-neutral-600"
                }`}
              >
                {d.name.en} · <span dir="rtl">{d.name.fa}</span>
              </button>
            ))}
          </div>
        </section>

        {VEHICLES.length > 1 && <section className="space-y-2">
          <h2 className="text-sm text-neutral-400">How?</h2>
          <div className="grid grid-cols-2 gap-2">
            {VEHICLES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => chooseVehicle(v.id)}
                aria-pressed={v.id === vehicle}
                className={`rounded-xl border p-3 text-left ${
                  v.id === vehicle ? "bg-white text-black border-white" : "border-neutral-600"
                }`}
              >
                <div className="text-lg font-semibold">
                  {v.icon} {v.en}
                </div>
                <div className="text-sm" dir="rtl">{v.fa}</div>
                <div className={`text-xs ${v.id === vehicle ? "text-neutral-600" : "text-neutral-400"}`}>{v.note}</div>
              </button>
            ))}
          </div>
        </section>}

        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm text-neutral-400">Ride time</h2>
            <div className="text-lg font-semibold">
              {estimateMs == null ? "—" : `≈ ${formatDuration(estimateMs)}`}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PACES.map((p) => {
              const ms = estimate(p.id);
              const on = p.id === pace;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choosePace(p.id)}
                  aria-pressed={on}
                  className={`rounded-xl border px-2 py-2 text-center ${
                    on ? "bg-white text-black border-white" : "border-neutral-600"
                  }`}
                >
                  <div className="font-semibold">{p.en}</div>
                  <div className="text-xs" dir="rtl">{p.fa}</div>
                  <div className={`text-xs ${on ? "text-neutral-600" : "text-neutral-400"}`}>
                    {ms == null ? "—" : `≈ ${formatDuration(ms)}`}
                  </div>
                </button>
              );
            })}
          </div>
          {meters != null && (
            <p className="text-xs text-neutral-500">
              {(meters / 1000).toFixed(1)} km {route?.byRoad ? "by road" : "(estimated, finding the route…)"}
            </p>
          )}
        </section>

        <button
          type="button"
          disabled={!origin}
          onClick={() => setRiding(true)}
          className="w-full px-6 py-3 rounded-full bg-white text-black font-semibold disabled:opacity-40"
        >
          Take Virtual Ride {vehicle === "taxi" ? "🚕" : "🚁"} → {to.name.en}
        </button>
      </div>
    </main>
  );
}

/** Google's address box (Places API (New)), plus "use my location". */
function AddressPicker({ onPick }: { onPick: (o: RideOrigin) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [searchError, setSearchError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let gone = false;
    let box: any = null;
    (async () => {
      try {
        const { PlaceAutocompleteElement } = await importLibrary("places");
        if (gone || !hostRef.current) return;
        box = new PlaceAutocompleteElement({ includedRegionCodes: ["ca"] });
        box.style.cssText = "width:100%;color-scheme:light";
        box.setAttribute("placeholder", "Your address");
        const choose = async (place: any) => {
          await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });
          const loc = place.location;
          if (!loc) return;
          pickRef.current({
            location: { lat: loc.lat(), lng: loc.lng() },
            label: place.formattedAddress || place.displayName || "your address",
          });
        };
        box.addEventListener("gmp-select", (e: any) => {
          if (e.placePrediction) choose(e.placePrediction.toPlace()).catch(() => setSearchError("That address couldn't be found."));
        });
        // Older builds of the element fire this instead, with the place itself.
        box.addEventListener("gmp-placeselect", (e: any) => {
          if (e.place) choose(e.place).catch(() => setSearchError("That address couldn't be found."));
        });
        hostRef.current.appendChild(box);
      } catch (e: any) {
        if (!gone) setSearchError("Address search is unavailable (Places API (New) not enabled?).");
        console.warn("Virtual ride: address search", e);
      }
    })();
    return () => {
      gone = true;
      box?.remove();
    };
  }, []);

  const here = () => {
    if (!navigator.geolocation) return setSearchError("This browser can't share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        pickRef.current({ location: { lat: p.coords.latitude, lng: p.coords.longitude }, label: "my location" });
      },
      () => {
        setLocating(false);
        setSearchError("Location wasn't shared.");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  return (
    <div className="space-y-2">
      <div ref={hostRef} className="rounded-lg bg-white" />
      {searchError && <p className="text-sm text-amber-300">{searchError}</p>}
      <button type="button" onClick={here} className="text-sm underline text-neutral-300">
        {locating ? "Finding you…" : "Use my current location"}
      </button>
    </div>
  );
}
