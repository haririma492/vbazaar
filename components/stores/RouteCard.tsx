"use client";

/**
 * THE ROUTE OPTIMIZER, ON THE STORE'S PAGE (owner, 2026-11-04: "edit the ride -
 * the route so there is not so much back and forth"). Shows the proposal: the
 * preview to watch, what is kept and dropped, every join and how alike its two
 * moments are. The operator plans it (free) and, on the owner's yes, cuts the
 * walk to it — one question first; the original is kept («Put the original
 * back» in the walk editor). One question at a time, never silent.
 */

import { useCallback, useEffect, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";

type Join = { at: number; from: number; to: number; likeness: number; smooth: boolean };
type Route = {
  walk: string; made: string; seconds: number; kept: number; parts: Array<{ from: number; to: number; soft?: { in?: boolean; out?: boolean } }>;
  joins: Join[]; dropped: { back: number; still: number; again: number }; products: number; lost: number[];
  preview?: string; previewUrl?: string | null; notes: string[]; applied?: boolean; cutting?: boolean;
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default function RouteCard({ api, operator }: { api: string; operator: boolean }) {
  const [route, setRoute] = useState<Route | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [sure, setSure] = useState(false);
  const load = useCallback(async () => {
    try { setRoute((await postJson<{ route: Route | null }>(api, { action: "route" })).route); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  async function plan() {
    try { await postJson(api, { action: "routePlan" }); setSaid({ ok: true, text: "Planning the route… a few minutes; this card updates by itself. · در حال برنامه‌ریزی مسیر…" }); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  }
  async function apply() {
    setSure(false);
    try { await postJson(api, { action: "routeApply" }); setSaid({ ok: true, text: "Cutting the walk to this route… it takes a few minutes; the lights and doors move with it. · در حال برش…" }); }
    catch (e) { setSaid({ ok: false, text: `Not cut: ${(e as Error).message}` }); }
  }

  return (
    <Card>
      <Bi fa="مسیر بهینه" en="Route optimizer — a smooth forward walk, no back and forth" className="text-[15px] font-bold text-amber-100" />
      {!route && <p dir="ltr" className="mt-1 text-left text-[13px] text-white/55">No route planned for this store&apos;s walk yet.</p>}
      {route && (
        <div dir="ltr" className="mt-2 space-y-2 text-left text-[13px]">
          {route.previewUrl && (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- a silent walk
            <video src={route.previewUrl} controls playsInline className="w-full rounded-xl bg-black" />
          )}
          <p>
            Keeps <b>{mmss(route.kept)}</b> of {mmss(route.seconds)} in {route.parts.length} parts. Drops {Math.round(route.dropped.back)} s walking back, {Math.round(route.dropped.again)} s passing again, {Math.round(route.dropped.still)} s standing.
          </p>
          <p className={route.lost.length ? "text-rose-200" : "text-emerald-200"}>
            {route.lost.length ? `${route.lost.length} of ${route.products} products would not be shown.` : `All ${route.products} products are still shown.`}
          </p>
          <p>
            Joins: {route.joins.filter((j) => j.smooth).length} seamless, {route.joins.filter((j) => !j.smooth).length} with a short dip (the camera was elsewhere).
          </p>
          <details>
            <summary className="cursor-pointer text-white/60">Every part and join</summary>
            <ol className="mt-1 space-y-0.5 text-[12px] text-white/70">
              {route.parts.map((p, i) => (
                <li key={i}>
                  {i + 1}. {mmss(p.from)}–{mmss(p.to)}
                  {route.joins[i] && <span className={route.joins[i].smooth ? "text-emerald-300/80" : "text-amber-300/80"}> → join at {mmss(route.joins[i].at)} in the new walk, {Math.round(route.joins[i].likeness * 100)}% alike{route.joins[i].smooth ? "" : ", dip"}</span>}
                </li>
              ))}
            </ol>
          </details>
          {route.notes.map((n, i) => <p key={i} className="text-amber-200/80">{n}</p>)}
          <p className="text-white/40">Planned {new Date(route.made).toLocaleString()}.</p>
          {route.applied && <p className="text-emerald-300">✓ Applied: the walk is cut to this route; the original is kept. · اعمال شد</p>}
          {route.cutting && <p className="text-amber-200">Cutting the walk to this route now… · در حال برش</p>}
        </div>
      )}
      {operator && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={QUIET} onClick={() => void plan()}>{route ? "Plan again · دوباره" : "Plan the route · برنامه‌ریزی مسیر"}</button>
          {route && !route.lost.length && !route.applied && !route.cutting && !sure && <button type="button" className={KEY} onClick={() => setSure(true)}>Cut the walk to this route…</button>}
          {sure && (
            <span className="flex flex-wrap items-center gap-2 text-[13px]">
              <b>Sure? The walk becomes this route; the original is kept.</b>
              <button type="button" className={KEY} onClick={() => void apply()}>Yes, cut · بله</button>
              <button type="button" className={QUIET} onClick={() => setSure(false)}>← Back</button>
            </span>
          )}
        </div>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
