"use client";

/**
 * «SHELF ZOOM PHOTOS» ON THE STORE'S PAGE (owner, 2026-11-11: "add a new shelf-gigapan-photo upload key in the
 * store pages"; "take 3 Gigapan style photo of a shelf and you need to stitch them together so user … zoom in and
 * out and read labels"). One shelf at a time: «Add a shelf's photos» takes its three photos together (top,
 * middle, bottom, any order), uploads them, and the stitcher starts by itself (`lib/stores/gigapan.ts`; free, no
 * AI; «Refresh all agents» runs it too). Each shelf then says where it stands in a sentence: stitched and how
 * big, or why its photos did not join and what to do. The last step is the operator's one tap on the walk
 * («Pin its 🔍 on the shelf»): the editor's «Zoom» tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DeepZoom from "@/components/zoom/DeepZoom";
import { postJson, uploadInParts, type Progress } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";
import type { ZoomForPage } from "@/lib/stores/gigapan";

type State = { sets: ZoomForPage[]; working: boolean; note: string };
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
/** A new shelf's id: made here, so the photos chosen together stay together. */
const newSet = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 16);

export default function ZoomCard({ api, operator, editUrl }: { api: string; operator: boolean; editUrl: string | null }) {
  const [st, setSt] = useState<State | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<{ name: string; p: Progress; i: number; of: number } | null>(null);
  const [open, setOpen] = useState<ZoomForPage | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** The shelf the next chosen photos go to: null for a new shelf. */
  const into = useRef<string | null>(null);

  const load = useCallback(async () => {
    try { setSt(await postJson<State>(api, { action: "zooms" })); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  // While the stitcher works, the card follows it.
  useEffect(() => {
    if (!st?.working) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [st?.working, load]);

  async function send(files: File[]) {
    const set = into.current ?? newSet();
    setSaid(null);
    let sent = 0;
    for (const [i, f] of files.entries()) {
      setBusy({ name: f.name, p: { sent: 0, total: f.size }, i, of: files.length });
      try {
        await uploadInParts(api, { action: "upload", kind: "gigapan", set }, f, (p) => setBusy({ name: f.name, p, i, of: files.length }));
        sent++;
      } catch (e) {
        setSaid({ ok: false, text: `«${f.name}» was not uploaded: ${(e as Error).message}` });
        break;
      }
    }
    setBusy(null);
    if (!sent) return;
    // It finishes on its own: the stitcher starts now.
    try {
      await postJson(api, { action: "zoomStitch" });
      setSaid({ ok: true, text: `✓ ${sent} photo${sent > 1 ? "s" : ""} uploaded. Stitching now: about a minute a shelf; this card follows it. · بارگذاری شد؛ در حال دوختن عکس‌ها` });
      // The card follows the job from here (it asks every 5 s while the job works).
      setSt((x) => (x ? { ...x, working: true, note: "starting…" } : { sets: [], working: true, note: "starting…" }));
    } catch (e) {
      setSaid({ ok: false, text: `Uploaded, but the stitcher did not start: ${(e as Error).message}. Press «Stitch now».` });
      await load();
    }
  }

  const act = async (body: Record<string, unknown>, okText: string) => {
    try { await postJson(api, body); setSaid({ ok: true, text: okText }); if (body.action === "zoomStitch") setSt((x) => (x ? { ...x, working: true, note: "starting…" } : x)); else await load(); }
    catch (e) { setSaid({ ok: false, text: `Not done: ${(e as Error).message}` }); }
  };
  const sets = st?.sets ?? [];
  const waiting = sets.filter((s) => s.state === "waiting" || s.state === "changed").length;
  const unpinned = sets.filter((s) => s.state === "done" && !s.pinned).length;
  if (!operator && !sets.some((s) => s.manifest)) return null; // the owner sees the shelves that are ready

  return (
    <Card>
      <Bi fa="عکس بزرگ‌نمایی قفسه‌ها" en="Shelf zoom photos — three phone photos of a shelf, joined into one that shoppers zoom into until they can read every label; the shelf is then found in the walk and bordered in green" className="text-[15px] font-bold text-amber-100" />
      {operator && (
        <p dir="ltr" className="mt-1 text-left text-[12px] text-white/50">
          How to take them: stand about 1.5 m from the shelf, square on, and do not step. Take three photos turning the camera only, each sharing about a third with the next:
          top, middle, bottom of a tall shelf, or left, middle, right of a wide one (which it is, is recognised). Focus on the products. Send the photos at full size
          (not a messaging app&apos;s copy). Choose all three together, in any order.
        </p>
      )}
      {st?.working && <p dir="ltr" className="mt-2 rounded-md bg-white/10 p-2 text-left text-[13px]"><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />Stitching: {st.note || "…"}</p>}

      {sets.length > 0 && (
        <ul dir="ltr" className="mt-3 grid gap-3 text-left sm:grid-cols-2">
          {sets.map((s) => (
            <li key={s.id} className="flex gap-3 rounded-lg border border-white/10 bg-black/25 p-2">
              {s.thumb
                ? <button type="button" onClick={() => setOpen(s)} aria-label={`Open ${s.label.en}`} className="shrink-0"><img src={s.thumb} alt="" className="h-28 w-20 rounded object-cover" loading="lazy" /></button>
                : <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded bg-white/5 text-[22px]">{s.state === "failed" ? "⚠️" : "⏳"}</div>}
              <div className="min-w-0 flex-1 space-y-1 text-[13px]">
                <p className="font-bold">{s.label.fa} · {s.label.en}</p>
                <p className={s.state === "failed" ? "text-rose-200" : s.state === "done" ? "text-emerald-200" : "text-amber-200"}>
                  {s.state === "done" ? `✓ ${s.note}` : s.state === "failed" ? `Not joined: ${s.note}` : s.state === "changed" ? "Its photos changed: waiting to be stitched again." : "Waiting to be stitched."}
                </p>
                <p className="truncate text-white/45">{s.photos.length} photo{s.photos.length > 1 ? "s" : ""}: {s.photos.map((p) => `${p.name} (${mb(p.size)})`).join(", ")}</p>
                {s.state === "done" && (
                  <p className={s.pinned ? "text-white/60" : "text-amber-200"}>
                    {s.bordered ? `🟩 Found in the walk by itself and bordered in green: a tap inside opens this photo. ${s.placeNote ?? ""}`
                      : s.pinned ? "🔍 On the walk (pinned by hand): shoppers open it from its shelf."
                      : s.placeNote ? `Not on the walk: ${s.placeNote} If the shelf is in the walk, pin its 🔍 by hand (below).`
                      : "Not looked for in the walk yet: «Find it in the walk»."}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {s.manifest && <button type="button" className={QUIET} onClick={() => setOpen(s)}>🔍 Open · باز کردن</button>}
                  {operator && <button type="button" className={QUIET} disabled={Boolean(busy)} onClick={() => { into.current = s.id; input.current?.click(); }}>Add or retake a photo</button>}
                  {operator && s.state === "done" && <button type="button" className={QUIET} disabled={st?.working} onClick={() => void act({ action: "zoomStitch", relocate: true }, "Looking for the shelves in the walk… about a minute. · در حال جست‌وجو")}>Find it in the walk{s.placeNote ? " again" : ""}</button>}
                  {operator && s.state === "failed" && <button type="button" className={QUIET} disabled={st?.working} onClick={() => void act({ action: "zoomStitch", force: true }, "Trying again… · دوباره")}>Try again</button>}
                  {operator && <button type="button" className={QUIET} onClick={() => { if (confirm(`Take «${s.label.en}» away? Its photos leave this page and its 🔍 leaves the walk.`)) void act({ action: "zoomRemove", set: s.id }, "✓ Taken away · حذف شد"); }}>Remove</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {operator && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple className="hidden"
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) void send(fs); }} />
          <button type="button" className={KEY} disabled={Boolean(busy)} onClick={() => { into.current = null; input.current?.click(); }}>
            {busy ? "…" : "＋ عکس‌های یک قفسه · Add a shelf's photos (3)"}
          </button>
          {waiting > 0 && !st?.working && <button type="button" className={QUIET} onClick={() => void act({ action: "zoomStitch" }, "Stitching… · در حال دوختن")}>Stitch now ({waiting}) · دوختن</button>}
          {unpinned > 0 && editUrl && <a className={`${QUIET} inline-flex items-center`} href={editUrl} target="_blank" rel="noreferrer">Pin {unpinned === 1 ? "its" : `the ${unpinned}`} 🔍 on the shelf: walk editor → «Zoom» ↗</a>}
        </div>
      )}
      {busy && (
        <div className="mt-3" dir="ltr">
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-300/80 transition-all" style={{ width: `${busy.p.total ? (busy.p.sent / busy.p.total) * 100 : 0}%` }} /></div>
          <p className="mt-1 text-left text-[12px] text-white/55">{busy.of > 1 ? `${busy.i + 1} / ${busy.of} · ` : ""}{busy.name} — {mb(busy.p.sent)} of {mb(busy.p.total)}</p>
        </div>
      )}
      {said && <Said ok={said.ok} text={said.text} />}
      {open?.manifest && <DeepZoom manifest={open.manifest} title={open.label} onClose={() => setOpen(null)} />}
    </Card>
  );
}
