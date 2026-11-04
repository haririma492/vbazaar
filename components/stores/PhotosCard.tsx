"use client";

/**
 * THE PHOTO IMPROVER, ON THE STORE'S PAGE (owner, 2026-11-04: "let me see these
 * two new agents in /stores/saraye-bamdad"). It runs by itself for every store
 * (`queuePhotos` in crew.ts); this card says what it is doing here and how far
 * it is, and lets the operator run it again. Free: frames of the walk, no AI.
 */

import { useCallback, useEffect, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, QUIET, Said } from "./ui";

type State = { state: "working" | "waiting" | "idle"; done: number; total: number; at: string | null };

export default function PhotosCard({ api, operator }: { api: string; operator: boolean }) {
  const [p, setP] = useState<State | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setP((await postJson<{ photos: State }>(api, { action: "photos" })).photos); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <Card>
      <Bi fa="بهبود عکس محصولات" en="Photo improver — each product's photo at the moment the finder saw it, at its sharpest" className="text-[15px] font-bold text-amber-100" />
      {p && (
        <div dir="ltr" className="mt-2 space-y-1.5 text-left text-[13px]">
          <p>
            <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${p.state === "working" ? "animate-pulse bg-amber-300" : p.state === "waiting" ? "bg-white/40" : p.done >= p.total && p.total ? "bg-emerald-400" : "bg-white/25"}`} />
            {p.state === "working" ? "Working on this store now." : p.state === "waiting" ? "Waiting its turn (another store first)." : p.done >= p.total && p.total ? "Done: every product's photo is improved." : p.done ? "Stopped part-way: run it again to finish." : "Not run on this store's walk yet."}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-400/80" style={{ width: `${pct}%` }} /></div>
          <p className="text-white/60">{p.done} of {p.total} photos made ({pct}%){p.at ? ` · last saved ${new Date(p.at).toLocaleTimeString()}` : ""}. About 40 s a product; it carries on by itself after a restart.</p>
          <p className="text-white/45">How: the moment the finder saw the product closest (its yellow box fits there), the sharpest frame within 0.2 s of it, cut from the original upload and enlarged once. Real detail only — nothing is invented.</p>
        </div>
      )}
      {operator && p && p.state === "idle" && (
        <button type="button" className={`${QUIET} mt-2`} onClick={async () => {
          try { await postJson(api, { action: "photosRecut" }); setSaid({ ok: true, text: "Queued: it starts in a moment. · در صف" }); await load(); }
          catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
        }}>{p.done >= p.total && p.total ? "Make them again · دوباره" : "Run it now · اجرا"}</button>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
