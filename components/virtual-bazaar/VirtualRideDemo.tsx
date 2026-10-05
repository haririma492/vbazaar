"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import VirtualRide, { type RideOrigin } from "./VirtualRide";
import { DISTRICTS, districtById } from "@/lib/virtualRide/districts";
import { importLibrary } from "./rideGoogle";

/**
 * `/vca/ride`: where are you starting from → where to → the ride. The
 * address goes to Google (to find it and route from it) and is remembered in
 * this browser only, for next time; it is never sent to our server.
 */

const REMEMBER = "sk-ride-origin";

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
  const [sceneReady, setSceneReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const to = districtById(toIdState)!;
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
          <VirtualRide origin={origin} to={to} onExit={exit} onEnter={enter} enterReady={sceneReady} />
        )}
      </>
    );
  }
  if (riding && origin) return <VirtualRide origin={origin} to={to} onExit={exit} />;

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

        <button
          type="button"
          disabled={!origin}
          onClick={() => setRiding(true)}
          className="w-full px-6 py-3 rounded-full bg-white text-black font-semibold disabled:opacity-40"
        >
          Take Virtual Ride → {to.name.en}
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
