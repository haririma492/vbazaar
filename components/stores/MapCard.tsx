"use client";

/**
 * THE STORE MAP, ON THE STORE'S PAGE (owner, 2026-11-05: the Spatial Mapping
 * Engine; the rules are `lib/stores/storeMap.ts`). Free: no AI. The operator
 * builds it; owner and operator see it: the camera's path (grey), the entrance
 * (green), each shelf as a line with its id and its place in the tour's order,
 * each product (filled: placed by triangulation; hollow: estimated), and what
 * needs a person to look at it. Drawn with the entrance facing up.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, QUIET, Said } from "./ui";
import type { StoreMap } from "@/lib/stores/storeMap";

const W = 560, PAD = 24;

export default function MapCard({ api, operator }: { api: string; operator: boolean }) {
  const [map, setMap] = useState<StoreMap | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [showReview, setShowReview] = useState(false);
  const load = useCallback(async () => {
    try {
      const j = await postJson<{ map: StoreMap | null; working: boolean; note: string }>(api, { action: "map" });
      setMap(j.map); setWorking(j.working ? j.note || "working…" : null);
    } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const view = useMemo(() => {
    if (!map) return null;
    // The entrance's heading drawn upward: world (x, y) turned by α (SVG y points down, so a right turn is clockwise).
    const a = -Math.PI / 2 - map.entrance.th, ca = Math.cos(a), sa = Math.sin(a);
    const rot = (p: { x: number; y: number }) => ({ x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca });
    const pts = [...map.path.map(rot), ...map.products.map(rot), ...map.shelves.flatMap((s) => [-1, 1].map((k) => rot({ x: s.center.x + (k * Math.cos(s.dir) * s.length) / 2, y: s.center.y + (k * Math.sin(s.dir) * s.length) / 2 })))];
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const scale = (W - 2 * PAD) / Math.max(1, maxX - minX, maxY - minY);
    const H = Math.round(Math.max(200, (maxY - minY) * scale + 2 * PAD));
    const at = (p: { x: number; y: number }) => { const q = rot(p); return { x: PAD + (q.x - minX) * scale, y: PAD + (q.y - minY) * scale }; };
    return { at, scale, H };
  }, [map]);

  async function build() {
    try { await postJson(api, { action: "mapBuild" }); setSaid({ ok: true, text: "Building the store map… a few minutes the first time (it reads how the camera moved); this card updates by itself. · در حال ساخت نقشه…" }); void load(); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  }

  const q = map?.quality;
  return (
    <Card>
      <Bi fa="نقشهٔ فروشگاه" en="Store map — where each shelf stands, and the tour's order by the store's layout, not by the filming" className="text-[15px] font-bold text-amber-100" />
      <div dir="ltr" className="mt-2 space-y-2 text-left text-[13px]">
        {working && <p><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />{working}</p>}
        {!map && !working && <p className="text-white/60">No map yet. It needs the finder&apos;s sightings (and, better, the Shelf finder&apos;s pictures). Free: no AI.</p>}
        {map && q && view && (
          <>
            <p className="text-white/70">
              {q.shelves} shelves{q.merged ? ` (${q.merged} merged from partial views)` : ""} · {q.triangulated} of {q.products} products placed by triangulation
              {q.onShelf ? `, ${q.onShelf} placed on their shelf from one view` : ""}{q.estimated ? `, ${q.estimated} estimated` : ""} · {q.loopsClosed} repeated visit{q.loopsClosed === 1 ? "" : "s"} corrected · made {new Date(map.made).toLocaleString()}
            </p>
            <svg viewBox={`0 0 ${W} ${view.H}`} className="w-full rounded-lg bg-black/40" role="img" aria-label="Store map">
              <polyline fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} points={map.path.map((p) => { const a = view.at(p); return `${a.x.toFixed(1)},${a.y.toFixed(1)}`; }).join(" ")} />
              {map.order.slice(1).map((id, i) => {
                const a = map.shelves.find((s) => s.id === map.order[i]), b = map.shelves.find((s) => s.id === id);
                if (!a || !b) return null;
                const p = view.at(a.face), r = view.at(b.face);
                return <line key={`o${id}`} x1={p.x} y1={p.y} x2={r.x} y2={r.y} stroke="rgba(110,231,183,0.45)" strokeWidth={1} strokeDasharray="4 3" />;
              })}
              {map.shelves.map((s) => {
                const p = view.at({ x: s.center.x - (Math.cos(s.dir) * s.length) / 2, y: s.center.y - (Math.sin(s.dir) * s.length) / 2 });
                const r = view.at({ x: s.center.x + (Math.cos(s.dir) * s.length) / 2, y: s.center.y + (Math.sin(s.dir) * s.length) / 2 });
                const f = view.at(s.face), rank = map.order.indexOf(s.id) + 1;
                return (
                  <g key={s.id}>
                    <line x1={p.x} y1={p.y} x2={r.x} y2={r.y} stroke={s.conf >= 0.5 ? "rgb(252,211,77)" : "rgba(252,211,77,0.45)"} strokeWidth={5} strokeLinecap="round" />
                    <circle cx={f.x} cy={f.y} r={9} fill="rgba(16,185,129,0.85)" />
                    <text x={f.x} y={f.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#06131c">{rank}</text>
                    <text x={(p.x + r.x) / 2} y={(p.y + r.y) / 2 - 7} textAnchor="middle" fontSize={10} fill="rgb(253,230,138)">{s.id} · {s.products.length}</text>
                  </g>
                );
              })}
              {map.products.map((p) => { const a = view.at(p); return p.method !== "estimated"
                ? <circle key={`p${p.n}`} cx={a.x} cy={a.y} r={2} fill={p.method === "triangulated" ? "rgba(255,255,255,0.8)" : "rgba(147,197,253,0.85)"} />
                : <circle key={`p${p.n}`} cx={a.x} cy={a.y} r={2.2} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.8} />; })}
              {(() => { const e = view.at(map.entrance); return <g><circle cx={e.x} cy={e.y} r={6} fill="rgb(34,197,94)" /><text x={e.x + 9} y={e.y + 4} fontSize={11} fill="rgb(134,239,172)">entrance</text></g>; })()}
              <text x={W - PAD} y={view.H - 8} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.45)">1 m ≈ {Math.round(view.scale)} px (estimated)</text>
            </svg>
            <p className="text-white/55">Green numbers: the Shelf Tour&apos;s order (the Shelf Tour follows it the next time it is built). Yellow: shelves (faint: few products placed). Dots: products (white: triangulated; blue: one view, put on its shelf; hollow: estimated).</p>
            {map.notes.map((n, i) => <p key={i} className="text-white/45">{n}</p>)}
            {map.review.length > 0 && (() => {
              // Grouped by reason: one line each, with the ids under it (473 single lines told nobody anything).
              const groups = new Map<string, string[]>();
              for (const r of map.review) groups.set(`${r.kind}|${r.why}`, [...(groups.get(`${r.kind}|${r.why}`) ?? []), r.id]);
              return (
                <div>
                  <button type="button" className="text-[12px] text-amber-200/80 underline" onClick={() => setShowReview((v) => !v)}>
                    {showReview ? "Hide" : "Show"} what needs a person: {[...groups.entries()].map(([k, ids]) => `${ids.length} ${k.startsWith("shelf") ? "shelves" : "products"}`).join(" · ")} · بررسی
                  </button>
                  {showReview && (
                    <ul className="mt-1 max-h-64 space-y-1.5 overflow-auto text-[12px] text-white/65">
                      {[...groups.entries()].map(([k, ids]) => (
                        <li key={k}><span className="text-white/85">{ids.length} {k.startsWith("shelf") ? "shelves" : "products"}: {k.split("|")[1]}</span>
                          <br /><span className="text-white/45">{k.startsWith("shelf") ? ids.join(", ") : ids.map((i) => `#${i}`).join(", ")}</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
            {q.walkedM !== undefined && <p className="text-white/45">The path is {q.walkedM.toFixed(1)} m long (estimated). If that is far longer than you walked, the distances are off and the map is not to be trusted yet.</p>}
          </>
        )}
      </div>
      {operator && !working && (
        <button type="button" className={`${QUIET} mt-2`} onClick={() => void build()}>{map ? "Build the map again · دوباره" : "Build the store map · ساخت نقشه"}</button>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
