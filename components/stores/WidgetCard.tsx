"use client";

/**
 * THE STORE'S WIDGET, ON ITS PAGE (owner, 2026-11-06). The two lines of code the store places on its own website, a
 * live preview of what its visitors will see, the counts (seen, clicked, on which sites), and for the operator the
 * switch that lets the store's owner see this card too. Every store has one, existing and new.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetPlan, WidgetStats } from "@/lib/stores/widgetRules";
import { postJson } from "./upload";
import { Bi, Card, QUIET, Said } from "./ui";

type Preview = { made: string; error?: string; aim?: { yawDeg: number; hfovDeg: number; seconds: number; zones: number } } | null;
type Got = { snippet: string; stats: WidgetStats; plan: WidgetPlan | null; forOwner: boolean; preview?: Preview };

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
        A short silent preview of the store in the Virtual Bazaar, with one key that opens the visit on vbazaar.app. The tours and the basket stay on vbazaar.app.
      </p>
      {got?.plan?.soon && <p className="mt-2 text-[13px] text-amber-200">Until the store is published, the widget says «Coming soon» and its key opens the bazaar&apos;s home page.</p>}
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="relative aspect-[4/3] w-full max-w-[320px] overflow-hidden rounded-xl border border-white/10">
          <iframe src={`/w/${slug}?preview=1`} title="Widget preview" className="absolute inset-0 h-full w-full border-0" />
        </div>
        {/* At least 240 px, or it drops under the preview: with no least width it was squeezed to a sliver beside the
            320 px preview on a screen 400–520 px wide, and there was no code to copy (owner, 2026-11-11). */}
        <div className="min-w-[240px] flex-1 space-y-2">
          <textarea ref={box} readOnly dir="ltr" value={got?.snippet ?? "Loading the code…"} rows={5} className="w-full rounded-lg bg-black/40 p-2 text-left font-mono text-[11px] text-white/85" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={QUIET} disabled={!got} onClick={copy}>
            {copied === "yes" ? "✓ Copied · کپی شد" : copied === "no" ? "Not copied: the code is selected, press Ctrl+C / ⌘C" : "Copy the code · کپی کد"}
          </button>
          <p dir="ltr" className="text-left text-[12px] text-white/45">
            Where: the widget appears where the &lt;div&gt; is pasted in the page. Size: data-width=&quot;360&quot; on the &lt;div&gt; is its widest, in pixels (480 if left out; always 4:3, narrower on a small screen).
            To centre it or pin it to a corner, style the &lt;div&gt;, e.g. style=&quot;max-width:360px;margin:0 auto&quot;. English: data-lang=&quot;en&quot;.
          </p>
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
        <label className="mt-3 flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={got.forOwner} disabled={busy} onChange={(e) => owner(e.target.checked)} />
          <span>The store&apos;s owner sees this card · صاحب فروشگاه این را ببیند</span>
        </label>
      )}
      <Said ok={said?.ok} text={said?.text ?? null} />
    </Card>
  );
}
