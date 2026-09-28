"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADDRESS_LABEL, BAZAAR_NAME, SHOPS, STREETS, addressPath, addressText, nameIn, parseSpot, poseForSpot, shopById,
  spotParam, streetById, type Lang, type Zone,
} from "@/lib/virtualBazaar/layout";
import VirtualAddressIcon from "./VirtualAddressIcon";
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
const LANG_KEY = "sk-vca-lang";

/** The visitor's language: `?lang=en` (the home page's own switch), else the last choice on this device. */
function readLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "en" || q === "fa") return q;
    return window.localStorage.getItem(LANG_KEY) === "en" ? "en" : "fa";
  } catch {
    return "fa";
  }
}

function writeLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* a refused storage write must never stop the switch */
  }
  try {
    const url = new URL(window.location.href);
    if (lang === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  } catch {
    /* as above */
  }
}

/** A link into the site in the visitor's language (the site reads `?lang=en`). */
function inLang(href: string, lang: Lang): string {
  if (lang !== "en") return href;
  return href + (href.includes("?") ? "&" : "?") + "lang=en";
}

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

/**
 * `initialSpot`: where a virtual address (`/vb/…`) puts the visitor — a
 * `spotParam` string. A `?spot=` in the url wins over it: that is where the
 * visitor was when they left for a shop, and Back should return them there.
 */
export default function VirtualBazaar({ initialSpot }: { initialSpot?: string } = {}) {
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
  const [copied, setCopied] = useState(false);
  /**
   * ⚠️ PERSIAN FIRST, ENGLISH ON THE KEY (operator, 2026-09-28: "add a key to
   * switch to English labels"). Every label in the page and every sign in the
   * 3D follows it; the choice rides in `?lang=en`, like the home page's.
   */
  const [lang, setLangState] = useState<Lang>("fa");
  const langRef = useRef<Lang>("fa");
  const L = (fa: string, en: string) => (lang === "en" ? en : fa);
  const setLang = (next: Lang) => {
    langRef.current = next;
    setLangState(next);
    writeLang(next);
    engineRef.current?.setLanguage(next);
  };

  const openShop = useCallback(
    (id: string) => {
      const shop = shopById(id);
      if (!shop?.href) return;
      writeSpot(spotParam({ kind: "shop", shop }));
      router.push(inLang(shop.href, langRef.current));
    },
    [router],
  );
  const openShopRef = useRef(openShop);
  openShopRef.current = openShop;

  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const startLang = readLang();
    langRef.current = startLang;
    setLangState(startLang);
    setTouch(coarse);
    setCanGyro(coarse && hasDeviceOrientation());

    const container = containerRef.current;
    if (!container) return;
    if (!webglAvailable()) {
      setWebgl(false);
      return;
    }

    const spot = readSpot() ?? parseSpot(initialSpot);
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
                //
                // ⚠️ NEVER OVER A VIRTUAL ADDRESS. `/vb/khoraki/5-sarekooche`
                // already says where the visitor stands; a `?spot=street:food`
                // added on arrival would win on reload, and the copied link
                // would land at the gate instead of the shop.
                if (z === "food") {
                  if (!(readSpot() ?? parseSpot(initialSpot))) writeSpot("street:food");
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
        engine.setLanguage(langRef.current);
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

  /**
   * Share a shop's virtual address with the phone's own share sheet (every
   * app on it, no per-app code); where there is none, copy the link.
   */
  const share = async (id: string) => {
    const s = shopById(id);
    if (!s) return;
    const url = `${window.location.origin}${addressPath(s)}`;
    const lg = langRef.current;
    const text = `${ADDRESS_LABEL[lg]}: ${addressText(s, lg)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: nameIn(s, lg), text, url });
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return; // the visitor closed the sheet
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(ADDRESS_LABEL[lg], url);
    }
  };

  const close = () => (engineRef.current ? engineRef.current.clearSelection() : setSelected(null));

  const street = selected?.kind === "street" ? streetById(selected.id) : undefined;
  const shop = selected?.kind === "shop" ? shopById(selected.id) : undefined;
  const in3d = webgl === true;

  const chip = "rounded-full px-3 py-2 text-sm whitespace-nowrap shadow";
  const dark = "bg-[var(--sk-ground)]/85 text-[var(--sk-ink)]";
  const lit = "bg-[var(--sk)] text-[var(--sk-ground)]";

  let status = "";
  if (street) {
    status = street.open
      ? zone === "food"
        ? L("به راسته خوش آمدید", "Welcome to the street")
        : L("ورود به راسته…", "Entering the street…")
      : L("این راسته به‌زودی باز می‌شود", "This street opens soon");
  }
  if (shop) {
    status = shop.href
      ? shop.id === "sarekooche"
        ? L("فروشگاه سرکوچه", "The Sarekooche shop")
        : L("در سرکوچه", "At Sarekooche")
      : L("این مغازه به‌زودی باز می‌شود", "This shop opens soon");
  }

  return (
    <main
      dir={lang === "en" ? "ltr" : "rtl"}
      lang={lang}
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
          <div className="font-bold">{BAZAAR_NAME[lang]}</div>
          <div className="text-xs opacity-80">
            {zone === "food" ? nameIn(STREETS[0], lang) : L("میدان", "The square")}
          </div>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === "en" ? "fa" : "en")}
              aria-label={lang === "en" ? "فارسی" : "English"}
              className={`${chip} ${dark} font-bold`}
            >
              {lang === "en" ? "فا" : "EN"}
            </button>
            <a href={inLang("/", lang)} className={`${chip} ${dark}`}>
              {L("سرکوچه ←", "Sarekooche →")}
            </a>
          </div>
          {in3d && canGyro && (
            <button
              type="button"
              onClick={toggleGyro}
              aria-pressed={gyro === "on"}
              className={`${chip} ${gyro === "on" ? lit : dark}`}
            >
              {gyro === "on" ? L("نگاه با گوشی ✓", "Look with phone ✓") : L("نگاه با گوشی", "Look with phone")}
            </button>
          )}
        </div>
      </div>

      {in3d && (gyro === "unavailable" || gyro === "denied") && (
        <p role="status" className={`absolute inset-x-4 top-36 mx-auto max-w-sm rounded-xl p-3 text-center text-sm ${dark}`}>
          {gyro === "denied"
            ? L("اجازهٔ حسگر حرکت داده نشد.", "Motion access was not given.")
            : L("حسگر حرکت این گوشی در دسترس نیست.", "This phone has no motion sensor.")}{" "}
          {L("با انگشت بکشید تا اطراف را ببینید.", "Drag with a finger to look around.")}
        </p>
      )}

      {in3d && askMotion && (
        <div
          role="dialog"
          aria-label={L("نگاه با گوشی", "Look with phone")}
          className={`absolute inset-x-4 top-1/3 mx-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl p-5 text-center shadow-lg ${dark}`}
        >
          <div className="text-base font-bold">{L("گوشی را بچرخانید", "Turn your phone")}</div>
          <div className="text-sm leading-7 opacity-90">
            {L(
              "گوشی را به چپ یا راست بچرخانید تا به همان سو بچرخید؛ صاف نگه دارید تا بایستید. روی زمین یا روی فلش‌ها بزنید تا بروید.",
              "Turn the phone left or right to turn that way; hold it straight to stop. Tap the floor or an arrow to walk.",
            )}
          </div>
          <button type="button" onClick={startGyro} className={`${chip} ${lit} px-6 font-bold`}>
            {L("شروع", "Start")}
          </button>
          <button type="button" onClick={() => setAskMotion(false)} className="text-xs underline opacity-80">
            {L("با دست به صفحه می‌زنم", "I'll use touch")}
          </button>
        </div>
      )}

      {in3d && hint && !askMotion && (
        <p className={`pointer-events-none absolute inset-x-4 top-36 md:top-4 mx-auto max-w-sm rounded-2xl p-4 text-center text-sm leading-7 ${dark}`}>
          {touch && gyro === "on" ? (
            <>
              {L(
                "گوشی را به چپ یا راست بچرخانید تا به همان سو بچرخید؛ صاف نگه دارید تا بایستید",
                "Turn the phone left or right to turn that way; hold it straight to stop",
              )}
              <br />
              {L("یا با انگشت بکشید", "or drag with a finger")}
              <br />
              {L("روی زمین یا فلش‌ها بزنید تا بروید، روی سردر راسته بزنید تا وارد شوید", "Tap the floor or an arrow to walk, a gate to go in")}
              <br />
              {L("با دو انگشت بزرگ‌نمایی کنید", "Pinch to zoom")}
            </>
          ) : touch ? (
            <>
              {L("انگشت را بکشید تا اطراف را ببینید", "Drag with a finger to look around")}
              <br />
              {L("روی زمین یا فلش‌ها بزنید تا بروید، روی سردر راسته بزنید تا وارد شوید", "Tap the floor or an arrow to walk, a gate to go in")}
              <br />
              {L("با دو انگشت بزرگ‌نمایی کنید", "Pinch to zoom")}
            </>
          ) : (
            <>
              {L("با موس بکشید تا اطراف را ببینید", "Drag with the mouse to look around")}
              <br />
              {L("روی زمین یا فلش‌ها کلیک کنید تا بروید، روی سردر راسته تا وارد شوید", "Click the floor or an arrow to walk, a gate to go in")}
              <br />
              {L(
                "↑ یا W یک بار: تا مغازه‌های بعدی · نگه دارید: قدم زدن · با Shift: تندتر",
                "↑ or W once: to the next shops · hold: stroll · with Shift: faster",
              )}
              <br />
              {L("چرخ موس برای بزرگ‌نمایی", "Mouse wheel to zoom")}
            </>
          )}
        </p>
      )}

      {webgl === false && (
        <p role="status" className={`absolute inset-x-4 top-28 mx-auto max-w-md rounded-xl p-3 text-center text-sm ${dark}`}>
          {L(
            "نمای سه‌بعدی روی این دستگاه در دسترس نیست. از فهرست پایین انتخاب کنید.",
            "3D is not available on this device. Choose from the list below.",
          )}
        </p>
      )}

      {/* Bottom: what is selected, then the places to go. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {(street || shop) && (
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-auto mx-auto flex w-full max-w-md flex-col gap-2 rounded-2xl px-4 py-3 shadow-lg ${dark}`}
          >
            <div className="min-w-0">
              <div className="font-semibold">{street ? nameIn(street, lang) : shop ? nameIn(shop, lang) : ""}</div>
              <div className="text-xs opacity-80">{status}</div>
              {shop && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--sk)]" title={ADDRESS_LABEL[lang]}>
                  <VirtualAddressIcon size={14} className="shrink-0" />
                  <span>{addressText(shop, lang)}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {shop?.href && (
                <button type="button" onClick={() => openShop(shop.id)} className={`${chip} ${lit} font-bold`}>
                  {L("ورود به فروشگاه", "Enter the shop")}
                </button>
              )}
              {shop && (
                <button
                  type="button"
                  onClick={() => share(shop.id)}
                  aria-label={L(`اشتراک‌گذاری ${ADDRESS_LABEL.fa}`, `Share the ${ADDRESS_LABEL.en}`)}
                  className="flex items-center gap-1 rounded-full px-3 py-1 text-sm ring-1 ring-[var(--sk)]"
                >
                  <VirtualAddressIcon size={16} />
                  {copied ? L("کپی شد", "Copied") : L("اشتراک", "Share")}
                </button>
              )}
              <button type="button" onClick={close} className="rounded-full px-3 py-1 text-sm ring-1 ring-[var(--sk)]">
                {L("بستن", "Close")}
              </button>
            </div>
          </div>
        )}

        <nav
          aria-label={zone === "food" && in3d ? L("مغازه‌های راسته خوراکی", "Shops of the Food Street") : L("راسته‌های بازار", "Streets of the bazaar")}
          className="pointer-events-auto"
        >
          <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:justify-center">
            {!in3d ? (
              // Without the 3D the bazaar is a list, and a Sarekooche shop is a plain link.
              <>
                {FOOD_SHOPS.filter((s) => s.href).map((s) => (
                  <li key={s.id} className="shrink-0">
                    <a href={inLang(s.href!, lang)} className={`${chip} ${lit} inline-block`}>
                      {nameIn(s, lang)}
                    </a>
                  </li>
                ))}
                {STREETS.map((s) => (
                  <li key={s.id} className="shrink-0">
                    <span className={`${chip} ${dark} inline-block opacity-70`}>
                      {nameIn(s, lang)}
                      {s.open ? "" : L(" · به‌زودی", " · soon")}
                    </span>
                  </li>
                ))}
              </>
            ) : zone === "food" ? (
              <>
                <li className="shrink-0">
                  <button type="button" onClick={() => engineRef.current?.goToSquare()} className={`${chip} ${dark}`}>
                    {L("→ بازگشت به میدان", "← Back to the square")}
                  </button>
                </li>
                {/* Window shopping, shop by shop: the phone's version of a quick press of ↑ / ↓. */}
                <li className="shrink-0">
                  <button type="button" onClick={() => engineRef.current?.stepAlongStreet(-1)} className={`${chip} ${dark}`}>
                    {L("→ مغازه‌های قبلی", "← Previous shops")}
                  </button>
                </li>
                <li className="shrink-0">
                  <button type="button" onClick={() => engineRef.current?.stepAlongStreet(1)} className={`${chip} ${dark}`}>
                    {L("مغازه‌های بعدی ←", "Next shops →")}
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
                      {nameIn(s, lang)}
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
                    {nameIn(s, lang)}
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
