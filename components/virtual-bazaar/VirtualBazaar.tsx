"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SHOPS, STREETS, parseSpot, poseForSpot, shopById, spotParam, streetById, type Zone,
} from "@/lib/virtualBazaar/layout";
import type { BazaarEngine, GyroState } from "./scene/BazaarEngine";
import type { Pick } from "./scene/buildBazaar";
import { hasDeviceOrientation, needsPermission, requestDeviceOrientation } from "./scene/deviceOrientation";

/**
 * THE VIRTUAL BAZAAR — the page around the 3D.
 *
 * Three.js draws and moves (`scene/BazaarEngine`); this page is everything a
 * visitor reads and presses, and the one door out to Sarekooche's 2D pages.
 * Walking in: the square → the food راسته's gate → down the street → a shop.
 * Walking out: «ورود» on the Sarekooche shop is a Next.js navigation, and the
 * spot is written into this page's url first, so the browser's back button
 * lands the visitor in front of the same shop.
 *
 * ⚠️ ON A PHONE, THE PHONE LOOKS (operator, 2026-09-27). Turning it left and
 * right turns the view; a finger only taps and pinches. Android starts that
 * by itself; iOS will not share the sensor until a tap asks, so the page opens
 * with a «شروع» card whose tap is that request. No sensor, or no permission,
 * and the finger drag takes over, with a line saying why.
 *
 * ⚠️ THE BUTTONS ARE NOT A DUPLICATE OF THE SCENE. They are the same places as
 * the gates and shops, for a keyboard, a screen reader, and a phone without
 * WebGL; every road ends in the same engine call or the same link.
 */

const SPOT = "spot";

function writeSpot(value: string | null) {
  try {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(SPOT, value);
    else url.searchParams.delete(SPOT);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  } catch {
    /* a refused history write must never stop the bazaar */
  }
}

function readSpot() {
  try {
    return parseSpot(new URLSearchParams(window.location.search).get(SPOT));
  } catch {
    return null;
  }
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The food street's shops, Sarekooche's own first. */
const FOOD_SHOPS = SHOPS.filter((s) => s.street === "food").sort(
  (a, b) => Number(!!b.href) - Number(!!a.href),
);

export default function VirtualBazaar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<BazaarEngine | null>(null);
  const router = useRouter();

  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Pick | null>(null);
  const [zone, setZone] = useState<Zone>("square");
  const [gyro, setGyro] = useState<GyroState | "denied">("off");
  /** iOS: the «شروع» card that asks for the sensor, shown until answered. */
  const [askMotion, setAskMotion] = useState(false);
  const [canGyro, setCanGyro] = useState(false);
  const [touch, setTouch] = useState(false);
  const [hint, setHint] = useState(true);

  const openShop = useCallback(
    (id: string) => {
      const shop = shopById(id);
      if (!shop?.href) return;
      writeSpot(spotParam({ kind: "shop", shop }));
      router.push(shop.href);
    },
    [router],
  );
  const openShopRef = useRef(openShop);
  openShopRef.current = openShop;

  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    setTouch(coarse);
    setCanGyro(coarse && hasDeviceOrientation());

    const container = containerRef.current;
    if (!container) return;
    if (!webglAvailable()) {
      setWebgl(false);
      return;
    }

    const spot = readSpot();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let engine: BazaarEngine | null = null;
    let cancelled = false;
    // ⚠️ THREE.JS IS LOADED HERE, NOT AT THE TOP. The page's text and buttons
    // arrive and work first; the 3D follows them, and never loads at all on a
    // device without WebGL.
    import("./scene/BazaarEngine")
      .then(({ BazaarEngine }) => {
        if (cancelled) return;
        try {
          engine = new BazaarEngine(
            container,
            {
              onSelect: setSelected,
              onZone: (z) => {
                setZone(z);
                // Keep the place across a reload — the street, or the shop the
                // visitor left from — but not the square, which is the default.
                if (z === "food") {
                  if (readSpot()?.kind !== "shop") writeSpot("street:food");
                } else writeSpot(null);
              },
              onOpenShop: (id) => openShopRef.current(id),
              onGyro: setGyro,
              onWebgl: setWebgl,
            },
            poseForSpot(spot),
            { reducedMotion },
          );
        } catch {
          setWebgl(false);
          return;
        }
        engineRef.current = engine;
        setWebgl(true);
        // On a phone the phone looks: straight away where the browser allows
        // it, after the «شروع» tap where it does not (iOS).
        if (coarse && hasDeviceOrientation()) {
          if (needsPermission()) setAskMotion(true);
          else engine.setGyro(true);
        }
        // Back from a shop: standing in front of it, with its panel up again.
        if (spot?.kind === "shop") setSelected({ kind: "shop", id: spot.shop.id });
      })
      .catch(() => setWebgl(false));

    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  const startGyro = async () => {
    setAskMotion(false);
    // ⚠️ THE FIRST AWAIT INSIDE THE TAP, or iOS refuses the request.
    const granted = await requestDeviceOrientation();
    if (!granted) {
      setGyro("denied");
      return;
    }
    engineRef.current?.setGyro(true);
  };

  const toggleGyro = () => {
    if (gyro === "on") engineRef.current?.setGyro(false);
    else startGyro();
  };

  // The "why the finger took over" line goes after a moment; the hint too, for
  // someone who only turns the phone and never touches the screen.
  useEffect(() => {
    if (gyro !== "unavailable" && gyro !== "denied") return;
    const t = setTimeout(() => setGyro("off"), 6000);
    return () => clearTimeout(t);
  }, [gyro]);
  useEffect(() => {
    if (!hint || webgl !== true || askMotion) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint, webgl, askMotion]);

  const close = () => (engineRef.current ? engineRef.current.clearSelection() : setSelected(null));

  const street = selected?.kind === "street" ? streetById(selected.id) : undefined;
  const shop = selected?.kind === "shop" ? shopById(selected.id) : undefined;
  const in3d = webgl === true;

  const chip = "rounded-full px-3 py-2 text-sm whitespace-nowrap shadow";
  const dark = "bg-[var(--sk-ground)]/85 text-[var(--sk-ink)]";
  const lit = "bg-[var(--sk)] text-[var(--sk-ground)]";

  let status = "";
  if (street) status = street.open ? (zone === "food" ? "به راسته خوش آمدید" : "ورود به راسته…") : "این راسته به‌زودی باز می‌شود";
  if (shop) status = shop.href ? (shop.id === "sarekooche" ? "فروشگاه سرکوچه" : "در سرکوچه") : "این مغازه به‌زودی باز می‌شود";

  return (
    <main
      onPointerDown={() => setHint(false)}
      onKeyDown={() => setHint(false)}
      style={{
        width: "100%",
        // `dvh` follows a phone's address bar; `vh` is the fallback for older browsers.
        height: "100vh",
        minHeight: "100dvh",
        maxHeight: "100dvh",
        overflow: "hidden",
        position: "relative",
        background: "#cfe2ee",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Top: where you are, the way out, and the phone's sensor. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className={`pointer-events-auto rounded-2xl px-3 py-2 text-sm ${dark}`}>
          <div className="font-bold">بازار سرکوچه</div>
          <div className="text-xs opacity-80">{zone === "food" ? "راسته خوراکی" : "میدان"}</div>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <a href="/" className={`${chip} ${dark}`}>
            سرکوچه ←
          </a>
          {in3d && canGyro && (
            <button
              type="button"
              onClick={toggleGyro}
              aria-pressed={gyro === "on"}
              className={`${chip} ${gyro === "on" ? lit : dark}`}
            >
              {gyro === "on" ? "نگاه با گوشی ✓" : "نگاه با گوشی"}
            </button>
          )}
        </div>
      </div>

      {in3d && (gyro === "unavailable" || gyro === "denied") && (
        <p role="status" className={`absolute inset-x-4 top-36 mx-auto max-w-sm rounded-xl p-3 text-center text-sm ${dark}`}>
          {gyro === "denied" ? "اجازهٔ حسگر حرکت داده نشد." : "حسگر حرکت این گوشی در دسترس نیست."} با انگشت بکشید تا اطراف
          را ببینید.
        </p>
      )}

      {in3d && askMotion && (
        <div
          role="dialog"
          aria-label="نگاه با گوشی"
          className={`absolute inset-x-4 top-1/3 mx-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl p-5 text-center shadow-lg ${dark}`}
        >
          <div className="text-base font-bold">گوشی را بچرخانید</div>
          <div className="text-sm leading-7 opacity-90">
            گوشی را به چپ و راست بچرخانید تا اطراف بازار را ببینید؛ روی زمین بزنید تا بروید.
          </div>
          <button type="button" onClick={startGyro} className={`${chip} ${lit} px-6 font-bold`}>
            شروع
          </button>
          <button type="button" onClick={() => setAskMotion(false)} className="text-xs underline opacity-80">
            با انگشت می‌گردم
          </button>
        </div>
      )}

      {in3d && hint && !askMotion && (
        <p className={`pointer-events-none absolute inset-x-4 top-36 md:top-4 mx-auto max-w-sm rounded-2xl p-4 text-center text-sm leading-7 ${dark}`}>
          {touch && gyro === "on" ? (
            <>
              گوشی را به چپ و راست بچرخانید تا اطراف را ببینید
              <br />
              چیزی را دیدید؟ لحظه‌ای نگاه کنید و گوشی را برگردانید؛ به همان سو چرخیده‌اید
              <br />
              روی زمین بزنید تا بروید، روی سردر راسته بزنید تا وارد شوید
              <br />
              با دو انگشت بزرگ‌نمایی کنید
            </>
          ) : touch ? (
            <>
              انگشت را بکشید تا اطراف را ببینید
              <br />
              روی زمین بزنید تا بروید، روی سردر راسته بزنید تا وارد شوید
              <br />
              با دو انگشت بزرگ‌نمایی کنید
            </>
          ) : (
            <>
              با موس بکشید تا اطراف را ببینید
              <br />
              روی زمین کلیک کنید تا بروید، روی سردر راسته تا وارد شوید
              <br />
              W A S D یا کلیدهای جهت برای راه رفتن، چرخ موس برای بزرگ‌نمایی
            </>
          )}
        </p>
      )}

      {webgl === false && (
        <p role="status" className={`absolute inset-x-4 top-28 mx-auto max-w-md rounded-xl p-3 text-center text-sm ${dark}`}>
          نمای سه‌بعدی روی این دستگاه در دسترس نیست. از فهرست پایین انتخاب کنید.
        </p>
      )}

      {/* Bottom: what is selected, then the places to go. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {(street || shop) && (
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-lg ${dark}`}
          >
            <div>
              <div className="font-semibold">{street?.name ?? shop?.name}</div>
              <div className="text-xs opacity-80">{status}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              {shop?.href && (
                <button type="button" onClick={() => openShop(shop.id)} className={`${chip} ${lit} font-bold`}>
                  ورود به فروشگاه
                </button>
              )}
              <button type="button" onClick={close} className="rounded-full px-3 py-1 text-sm ring-1 ring-[var(--sk)]">
                بستن
              </button>
            </div>
          </div>
        )}

        <nav
          aria-label={zone === "food" && in3d ? "مغازه‌های راسته خوراکی" : "راسته‌های بازار"}
          className="pointer-events-auto"
        >
          <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:justify-center">
            {!in3d ? (
              // Without the 3D the bazaar is a list, and a Sarekooche shop is a plain link.
              <>
                {FOOD_SHOPS.filter((s) => s.href).map((s) => (
                  <li key={s.id} className="shrink-0">
                    <a href={s.href} className={`${chip} ${lit} inline-block`}>
                      {s.name}
                    </a>
                  </li>
                ))}
                {STREETS.map((s) => (
                  <li key={s.id} className="shrink-0">
                    <span className={`${chip} ${dark} inline-block opacity-70`}>
                      {s.name}
                      {s.open ? "" : " · به‌زودی"}
                    </span>
                  </li>
                ))}
              </>
            ) : zone === "food" ? (
              <>
                <li className="shrink-0">
                  <button type="button" onClick={() => engineRef.current?.goToSquare()} className={`${chip} ${dark}`}>
                    → بازگشت به میدان
                  </button>
                </li>
                {FOOD_SHOPS.map((s) => (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => engineRef.current?.goToShop(s.id)}
                      aria-pressed={shop?.id === s.id}
                      className={`${chip} ${shop?.id === s.id || s.href ? lit : dark}`}
                    >
                      {s.name}
                    </button>
                  </li>
                ))}
              </>
            ) : (
              STREETS.map((s) => (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => engineRef.current?.goToStreet(s.id)}
                    aria-pressed={street?.id === s.id}
                    className={`${chip} ${street?.id === s.id || s.open ? lit : dark} ${s.open ? "font-bold" : "opacity-80"}`}
                  >
                    {s.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </nav>
      </div>
    </main>
  );
}
