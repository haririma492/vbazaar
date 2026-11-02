"use client";
// THE STORE'S WALK, IN A FRAME ON ITS PAGE (owner, 2026-11-02: "on owner's
// view (on top) also add a frame that has the walk and owner can press one key
// and start the walk in the same frame with option to maximize the frame").
// The walk page itself in an iframe, loaded only when the key is pressed (an
// 8K walk is not downloaded by everyone who opens the page). «Full screen»
// uses the browser's full screen, or fills the window where a phone has none.
import { useEffect, useRef, useState } from "react";
import { KEY, QUIET } from "./ui";

export default function WalkFrame({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const [big, setBig] = useState(false);

  useEffect(() => {
    const off = () => { if (!document.fullscreenElement) setBig(false); };
    document.addEventListener("fullscreenchange", off);
    return () => document.removeEventListener("fullscreenchange", off);
  }, []);
  useEffect(() => {
    if (!big) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [big]);

  const grow = async () => {
    const el = box.current;
    if (!el) return;
    if (big) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setBig(false);
      return;
    }
    setBig(true);
    if (el.requestFullscreen) await el.requestFullscreen().catch(() => {});
  };

  return (
    <div
      ref={box}
      className={big ? "fixed inset-0 z-50 bg-black" : "relative aspect-video w-full overflow-hidden rounded-2xl border border-white/15 bg-black"}
    >
      {on ? (
        <iframe src={url} title="The store's walk" className="absolute inset-0 h-full w-full border-0" allow="fullscreen; autoplay; gyroscope; accelerometer" />
      ) : (
        <button type="button" className="absolute inset-0 flex items-center justify-center" onClick={() => setOn(true)}>
          <span className={`${KEY} px-6 py-3 text-[16px]`}>▶ قدم زدن در فروشگاه · Walk the store</span>
        </button>
      )}
      {on && (
        <button type="button" className={`${QUIET} absolute right-3 top-3 z-10 bg-black/60`} onClick={() => void grow()}>
          {big ? "✕ کوچک کردن · Exit full screen" : "⛶ تمام صفحه · Full screen"}
        </button>
      )}
    </div>
  );
}
