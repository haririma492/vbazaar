"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HoldState } from "./commerce/CommerceLayer";
import type { ChinaStoreEngine } from "./ChinaStoreEngine";
import { formatPrice, priceNow, type Product } from "@/lib/chinastore/products";
import { AdVoice } from "./adVoice";

/**
 * `/chinastore` — the VCA investor preview: a short walk into a china
 * boutique where the products' details appear as you near them, and the
 * teapot is picked up and added to a basket.
 *
 * The page owns everything read as text (title, captions, the product card,
 * the basket); the engine owns the 3D and the labels that live in it.
 *
 *   ?autoplay=1   start the demo at once (kiosk / screen share)
 *   ?captions=0   the walk without its captions
 *   ?dev=1        anchor markers and a live distance/opacity readout
 *   ?quality=low  no ambient occlusion, lower resolution
 */

type Phase = "loading" | "title" | "demo" | "ended" | "explore";

const CAPTIONS: { from: number; to: number; text: string }[] = [
  { from: 0.4, to: 3.2, text: "Walk in." },
  { from: 3.6, to: 7.6, text: "Offers speak up as you pass." },
  { from: 8.2, to: 12.6, text: "Details appear when they matter — and only then." },
  { from: 14.8, to: 17.8, text: "Pick it up. Turn it in your hand." },
  { from: 18.4, to: 21, text: "Buy it." },
];

export default function ChinaStore({ serifClass }: { serifClass?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ChinaStoreEngine | null>(null);
  const params = useRef<URLSearchParams | null>(null);
  const voiceRef = useRef<AdVoice | null>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [webgl, setWebgl] = useState(true);
  const [basket, setBasket] = useState<{ count: number; total: number; last: Product | null }>({ count: 0, total: 0, last: null });
  const [hold, setHold] = useState<HoldState | null>(null);
  const [pressed, setPressed] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null);
  const [demoT, setDemoT] = useState(0);
  const [captions, setCaptions] = useState(true);
  const [dev, setDev] = useState(false);
  const [debug, setDebug] = useState<{ id: string; distance: number; opacity: number }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    params.current = q;
    setCaptions(q.get("captions") !== "0");
    setDev(q.get("dev") === "1");
    let cancelled = false;
    let engine: ChinaStoreEngine | null = null;
    voiceRef.current = new AdVoice();
    (async () => {
      const { ChinaStoreEngine } = await import("./ChinaStoreEngine");
      if (cancelled || !stageRef.current || !overlayRef.current) return;
      const coarse = window.matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 600;
      const quality = q.get("quality") === "low" || (coarse && q.get("quality") !== "high") ? "low" : "high";
      engine = new ChinaStoreEngine(stageRef.current, overlayRef.current, {
        onProgress: setProgress,
        onWebgl: setWebgl,
        onBasket: (count, product) => {
          setBasket((b) => ({ count, total: b.total + priceNow(product), last: product }));
          setToast(`${product.name} · ${formatPrice(priceNow(product))} — in your basket`);
        },
        onAd: (product, pan) => {
          if (product.ad) voiceRef.current?.play(product.ad, pan);
        },
        onHold: setHold,
        onCue: (cue, at) => {
          if (cue === "tap" && at) setRipple({ x: at.x, y: at.y, key: Date.now() });
          if (cue === "press-add") {
            setPressed(true);
            window.setTimeout(() => {
              engineRef.current?.addToBasket();
              setPressed(false);
            }, 420);
          }
          if (cue === "end") setPhase("ended");
        },
        onDemoTime: setDemoT,
      }, { dev: q.get("dev") === "1", quality });
      engineRef.current = engine;
      await engine.init();
      if (cancelled) return;
      // Hooks for screenshots and automated checks.
      (window as unknown as { __chinastore?: ChinaStoreEngine }).__chinastore = engine;
      if (q.get("autoplay") === "1") {
        engine.startDemo();
        setPhase("demo");
      } else {
        engine.showOpening();
        setPhase("title");
      }
    })();
    return () => {
      cancelled = true;
      voiceRef.current?.stop();
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!dev) return;
    const id = window.setInterval(() => setDebug(engineRef.current?.debug() ?? []), 200);
    return () => window.clearInterval(id);
  }, [dev]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const play = useCallback(() => {
    voiceRef.current?.unlock();
    voiceRef.current?.stop();
    setBasket({ count: 0, total: 0, last: null });
    setHold(null);
    setToast(null);
    setDemoT(0);
    engineRef.current?.startDemo();
    setPhase("demo");
  }, []);

  const explore = useCallback(() => {
    voiceRef.current?.unlock();
    engineRef.current?.explore();
    setPhase("explore");
    setHint(true);
    window.setTimeout(() => setHint(false), 7000);
  }, []);

  const add = useCallback(() => {
    setPressed(true);
    window.setTimeout(() => {
      engineRef.current?.addToBasket();
      setPressed(false);
    }, 180);
  }, []);

  const holding = hold?.phase === "holding" ? hold.product : null;
  const caption = phase === "demo" && captions ? CAPTIONS.find((c) => demoT >= c.from && demoT <= c.to) : undefined;

  return (
    <div className={`cs-root ${serifClass ?? ""}`} dir="ltr" lang="en">
      <div ref={stageRef} className="cs-stage">
        <div ref={overlayRef} className="cs-overlay" aria-hidden />
      </div>

      {/* Brand mark */}
      <div className="cs-brand">
        <span className="cs-brand-mark">VCA</span>
        <span className="cs-brand-sub">Virtual China Store · preview</span>
      </div>

      {/* Sound */}
      <button
        type="button"
        className="cs-sound"
        aria-label={muted ? "Turn sound on" : "Turn sound off"}
        onClick={() => {
          const v = voiceRef.current;
          if (!v) return;
          v.unlock();
          v.muted = !v.muted;
          if (v.muted) v.stop();
          setMuted(v.muted);
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          {muted ? (
            <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          ) : (
            <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {/* Basket */}
      <div className={`cs-basket ${basket.count ? "cs-basket-full" : ""}`} aria-live="polite">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M6 8h12l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H8.7a1.5 1.5 0 0 1-1.5-1.3L6 8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M9 10V7a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="cs-basket-label">Basket</span>
        <span className="cs-basket-count" key={basket.count}>{basket.count}</span>
      </div>

      {/* The demo's tap */}
      {ripple && <span key={ripple.key} className="cs-ripple" style={{ left: ripple.x, top: ripple.y }} />}

      {/* Product in hand */}
      <div className={`cs-panel ${holding ? "cs-panel-on" : ""}`} role="dialog" aria-label={holding?.name ?? "Product"}>
        {holding && (
          <>
            <span className="cs-panel-kicker">In your hand</span>
            <span className="cs-panel-name">{holding.name}</span>
            <span className="cs-panel-meta">{holding.sku}{holding.blurb ? ` · ${holding.blurb}` : ""}</span>
            <span className="cs-panel-price">
              {priceNow(holding) < holding.price && <s className="cs-panel-was">{formatPrice(holding.price)}</s>}
              {formatPrice(priceNow(holding))} <small>{holding.currency}</small>
              {priceNow(holding) < holding.price && <span className="cs-panel-sale">Sale</span>}
            </span>
            <button type="button" className={`cs-btn cs-btn-primary ${pressed ? "cs-pressed" : ""}`} onClick={add} disabled={phase === "demo"}>
              Add to Basket
            </button>
            {phase === "explore" && (
              <>
                <button type="button" className="cs-btn cs-btn-quiet" onClick={() => engineRef.current?.putBack()}>
                  Put it back
                </button>
                <span className="cs-panel-hint">Drag to turn it</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Captions */}
      <div className={`cs-caption ${caption ? "cs-caption-on" : ""}`}>{caption?.text ?? ""}</div>

      {toast && <div className="cs-toast">{toast}</div>}

      {/* Title card */}
      {(phase === "loading" || phase === "title") && (
        <div className="cs-title">
          <div className="cs-title-inner">
            <span className="cs-kicker">VCA · investor preview</span>
            <h1 className="cs-h1">The Virtual China Store</h1>
            <p className="cs-lede">Walk in. Products tell you what they are as you near them. Pick one up — and buy it.</p>
            {!webgl ? (
              <p className="cs-lede">This preview needs WebGL, which this browser has turned off.</p>
            ) : phase === "loading" ? (
              <div className="cs-load">
                <div className="cs-load-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                <span className="cs-load-text">Setting the shelves… {Math.round(progress * 100)}%</span>
              </div>
            ) : (
              <div className="cs-actions">
                <button type="button" className="cs-btn cs-btn-primary cs-btn-lg" onClick={play}>
                  ▶ Play the 20-second walk
                </button>
                <button type="button" className="cs-btn cs-btn-ghost cs-btn-lg" onClick={explore}>
                  Explore freely
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* End card */}
      {phase === "ended" && (
        <div className="cs-end">
          <p className="cs-end-line">
            The place is the capture. The commerce is the data. <em>The hotspot connects them.</em>
          </p>
          <div className="cs-actions">
            <button type="button" className="cs-btn cs-btn-primary" onClick={play}>↺ Replay</button>
            <button type="button" className="cs-btn cs-btn-ghost" onClick={explore}>Explore the store</button>
          </div>
        </div>
      )}

      {/* Mode switch */}
      {(phase === "demo" || phase === "explore") && (
        <div className="cs-modes">
          <button type="button" className={`cs-mode ${phase === "demo" ? "cs-mode-on" : ""}`} onClick={play}>Demo ↺</button>
          <button type="button" className={`cs-mode ${phase === "explore" ? "cs-mode-on" : ""}`} onClick={explore}>Explore</button>
        </div>
      )}

      {phase === "explore" && hint && (
        <div className="cs-hintbar">Drag to look · tap the floor to walk · tap a piece to take it · W A S D</div>
      )}

      {dev && (
        <div className="cs-dev">
          <strong>anchors</strong> t={demoT.toFixed(2)}s
          {debug.map((d) => (
            <div key={d.id}>
              {d.id.padEnd(11, " ")} {d.distance.toFixed(2)} m · {(d.opacity * 100).toFixed(0)}%
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
