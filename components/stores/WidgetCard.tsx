"use client";

/**
 * THE STORE'S WIDGET, ON ITS PAGE (owner, 2026-11-06). The two lines of code the store places on its own website, a
 * live preview of what its visitors will see, the counts (seen, clicked, on which sites), and for the operator the
 * switch that lets the store's owner see this card too. Every store has one, existing and new.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetPlan, WidgetSettings, WidgetStats } from "@/lib/stores/widgetRules";
import { postJson } from "./upload";
import { Bi, Card, QUIET, Said } from "./ui";

type Preview = { made: string; error?: string; aim?: { yawDeg: number; hfovDeg: number; seconds: number; zones: number } } | null;
type Got = { snippet: string; stats: WidgetStats; plan: WidgetPlan | null; forOwner: boolean; settings: WidgetSettings; preview?: Preview };

export default function WidgetCard({ api, slug, operator }: { api: string; slug: string; operator: boolean }) {
  const [got, setGot] = useState<Got | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => {
    try { setGot(await postJson<Got>(api, { action: "widget" })); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  // The browser's clipboard first; where it is missing or refused (an older browser, a page not in focus), the code
  // in the box is selected and copied the old way. The answer is said ON the key: the line at the card's end was out
  // of sight, so the key "did nothing" (owner, 2026-11-11).
  const copy = async () => {
    if (!got) return;
    let done = false;
    try { await navigator.clipboard.writeText(got.snippet); done = true; } catch { /* the old way, below */ }
    if (!done && box.current) {
      box.current.focus(); box.current.select();
      try { done = document.execCommand("copy"); } catch { done = false; }
    }
    setCopied(done ? "yes" : "no");
    setTimeout(() => setCopied(null), 4000);
  };
  // The widget on the store's site is changed HERE, never in the store's code: each change saves itself and says so.
  const [setSaid2, setSetSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const set = async (change: Partial<WidgetSettings>) => {
    setBusy(true); setSetSaid(null);
    try {
      const r = await postJson<{ settings: WidgetSettings }>(api, { action: "widgetSet", settings: change });
      setGot((g) => (g ? { ...g, settings: r.settings } : g));
      setSetSaid({ ok: true, text: "✓ Saved. The store's site shows it within a minute; nothing to change in its code. · ذخیره شد" });
    } catch (e) { setSetSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const owner = async (on: boolean) => {
    setBusy(true); setSaid(null);
    try { const r = await postJson<{ forOwner: boolean }>(api, { action: "widgetOwner", on }); setGot((g) => (g ? { ...g, forOwner: r.forOwner } : g)); setSaid({ ok: true, text: r.forOwner ? "✓ The store's owner now sees this card." : "✓ Hidden from the store's owner." }); }
    catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const days = got ? Object.entries(got.stats.days).slice(0, 7) : [];
  const sites = got ? Object.entries(got.stats.sites).slice(0, 5) : [];
  return (
    <Card>
      <Bi fa="ابزارک فروشگاه برای وبسایت خودش" en="The store's widget, for its own website" className="text-[16px] font-bold" />
      <p className="mt-1 text-[13px] text-white/60">
        The store&apos;s Free Tour on its own website: the wheel, the speed bar, looking around and the music. The arch at the top left is the only link; it opens the store on vbazaar.app. The product cards, the Shelf Tour and the basket stay on vbazaar.app.
      </p>
      {got?.plan?.soon && <p className="mt-2 text-[13px] text-amber-200">Until the store is published (or shown on the stores&apos; list), the arch opens the bazaar&apos;s home page.</p>}
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="relative aspect-[4/3] w-full max-w-[320px] overflow-hidden rounded-xl border border-white/10">
          <iframe src={`/w/${slug}?preview=1`} title="Widget preview" className="absolute inset-0 h-full w-full border-0" />
        </div>
        {/* At least 240 px, or it drops under the preview: with no least width it was squeezed to a sliver beside the
            320 px preview on a screen 400–520 px wide, and there was no code to copy (owner, 2026-11-11). */}
        <div className="min-w-[240px] flex-1 space-y-2">
          <textarea ref={box} readOnly dir="ltr" value={got?.snippet ?? "Loading the code…"} rows={3} className="w-full rounded-lg bg-black/40 p-2 text-left font-mono text-[11px] text-white/85" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={QUIET} disabled={!got} onClick={copy}>
            {copied === "yes" ? "✓ Copied · کپی شد" : copied === "no" ? "Not copied: the code is selected, press Ctrl+C / ⌘C" : "Copy the code · کپی کد"}
          </button>
          <p dir="ltr" className="text-left text-[12px] text-white/45">One line. The store pastes it once, anywhere in its page, and never changes it: everything about the widget is set below, on our side. The longer code given before works the same.</p>
        </div>
      </div>
      {got && (
        <div dir="ltr" className="mt-3 text-left text-[13px] text-white/70">
          <p><b className="text-white">{got.stats.views}</b> seen · <b className="text-white">{got.stats.clicks}</b> walked in{got.stats.views ? ` (${Math.round((100 * got.stats.clicks) / got.stats.views)}%)` : ""}{got.stats.firstAt ? ` · counting since ${new Date(got.stats.firstAt).toLocaleDateString()}` : " · not seen anywhere yet"}</p>
          {days.length > 0 && <p className="text-[12px] text-white/50">{days.map(([d, v]) => `${d.slice(5)}: ${v.views}/${v.clicks}`).join(" · ")}</p>}
          {sites.length > 0 && <p className="text-[12px] text-white/50">On: {sites.map(([h, n]) => `${h} (${n})`).join(" · ")}</p>}
        </div>
      )}
      {operator && got && (
        <div dir="ltr" className="mt-3 text-left text-[12px] text-white/55">
          {got.preview?.aim
            ? `Free Tour preview: aimed at ${got.preview.aim.yawDeg}°, ${got.preview.aim.hfovDeg}° wide, ${got.preview.aim.seconds} s, kept clear of the camera operator (${got.preview.aim.zones} lock points) · made ${new Date(got.preview.made).toLocaleString()}`
            : got.preview?.error ? `Free Tour preview not made: ${got.preview.error}` : "Free Tour preview: not made yet (it is made the first time the widget is shown)."}
          <button type="button" className={`${QUIET} ms-2`} disabled={busy} onClick={async () => {
            setBusy(true); setSaid(null);
            try { await postJson(api, { action: "widgetRemake" }); setSaid({ ok: true, text: "✓ The preview was made again." }); await load(); }
            catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
            finally { setBusy(false); }
          }}>Make the preview again</button>
        </div>
      )}
      {operator && got && (
        <div dir="ltr" className="mt-3 space-y-2 rounded-xl border border-white/10 p-3 text-left text-[13px] text-white/80">
          <p className="font-bold text-white">On the store&apos;s website · روی وبسایت فروشگاه</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={got.settings.on} disabled={busy} onChange={(e) => set({ on: e.target.checked })} />
            <span>Show the widget</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={got.settings.movable} disabled={busy} onChange={(e) => set({ movable: e.target.checked })} />
            <span>Visitors can move and resize the window (kept on their own device)</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/60">Where:</span>
            {([["top", "In the page, under its header"], ["here", "In the page, where the code was pasted"], ["float", "Hovering over a corner (with a × to close)"]] as const).map(([v, say]) => (
              <button key={v} type="button" disabled={busy} aria-pressed={got.settings.place === v} onClick={() => set({ place: v })}
                className={`rounded-full border px-3 py-1 ${got.settings.place === v ? "border-emerald-300 bg-emerald-400 font-bold text-black" : "border-white/25 text-white/80"}`}>{say}</button>
            ))}
          </div>
          {got.settings.place !== "float" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/60">Side:</span>
              {([["right", "Right, the page's content beside it"], ["left", "Left, the page's content beside it"], ["center", "Middle, alone on its row"]] as const).map(([v, say]) => (
                <button key={v} type="button" disabled={busy} aria-pressed={got.settings.side === v} onClick={() => set({ side: v })}
                  className={`rounded-full border px-3 py-1 ${got.settings.side === v ? "border-emerald-300 bg-emerald-400 font-bold text-black" : "border-white/25 text-white/80"}`}>{say}</button>
              ))}
            </div>
          )}
          {got.settings.place === "float" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white/60">Corner:</span>
              {([["br", "Bottom right"], ["bl", "Bottom left"], ["tr", "Top right"], ["tl", "Top left"]] as const).map(([v, say]) => (
                <button key={v} type="button" disabled={busy} aria-pressed={got.settings.corner === v} onClick={() => set({ corner: v })}
                  className={`rounded-full border px-3 py-1 ${got.settings.corner === v ? "border-emerald-300 bg-emerald-400 font-bold text-black" : "border-white/25 text-white/80"}`}>{say}</button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/60">Widest (4:3):</span>
            {[280, 320, 400, 480, 640, 800].map((w) => (
              <button key={w} type="button" disabled={busy} aria-pressed={got.settings.width === w} onClick={() => set({ width: w })}
                className={`rounded-full border px-3 py-1 ${got.settings.width === w ? "border-emerald-300 bg-emerald-400 font-bold text-black" : "border-white/25 text-white/80"}`}>{w} px</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/60">Language:</span>
            {([["fa", "فارسی"], ["en", "English"]] as const).map(([v, say]) => (
              <button key={v} type="button" disabled={busy} aria-pressed={got.settings.lang === v} onClick={() => set({ lang: v })}
                className={`rounded-full border px-3 py-1 ${got.settings.lang === v ? "border-emerald-300 bg-emerald-400 font-bold text-black" : "border-white/25 text-white/80"}`}>{say}</button>
            ))}
          </div>
          <Said ok={setSaid2?.ok} text={setSaid2?.text ?? null} />
        </div>
      )}
      {operator && got && (
        <label className="mt-3 flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={got.forOwner} disabled={busy} onChange={(e) => owner(e.target.checked)} />
          <span>The store&apos;s owner sees this card · صاحب فروشگاه این را ببیند</span>
        </label>
      )}
      <Said ok={said?.ok} text={said?.text ?? null} />
    </Card>
  );
}
