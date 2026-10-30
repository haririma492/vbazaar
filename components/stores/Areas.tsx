"use client";

/**
 * `/stores/areas` — THE BAZAAR'S OWN WALKS (owner, 2026-10-30: "another
 * screen for the hallway and outside area of shopping center and probably the
 * lobby … connect the area's nicely and seamlessly").
 *
 * Each area is one Insta360 walk, uploaded here and made walkable by the
 * Video agent; their order is the walking order, and the end of each walk
 * carries on into the next (outside → lobby → hallway). One area is the
 * hallway: its door spots are marked on its walk («Mark door spots»), and the
 * stores fill them in order; a store can be moved to another spot here. Each
 * area has its own message box to the crew and its own music.
 */

import { useCallback, useEffect, useState } from "react";
import type { Bazaar } from "@/lib/stores/bazaar";
import { getJson, postJson, uploadInParts, uploadMusic } from "./upload";
import { Bi, Card, FIELD, FilePick, KEY, QUIET, Said, Steps, Thread } from "./ui";

type Page = { bazaar: Bazaar; stores: Array<{ slug: string; name: { en: string; fa: string } }>; walks: Record<string, string> };
const API = "/api/stores/areas";

export default function Areas() {
  const [page, setPage] = useState<Page | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [add, setAdd] = useState({ id: "", en: "", fa: "" });
  const load = useCallback(() => getJson<Page>(API).then((p) => { setPage(p); setErr(null); }).catch((e) => setErr((e as Error).message)), []);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [load]);
  const act = async (body: object) => {
    try { await postJson(API, body); await load(); }
    catch (e) { setErr((e as Error).message); }
  };
  if (!page) return err ? <Said text={err} /> : <p className="p-6 text-center text-white/50">…</p>;
  const { bazaar } = page;
  const hallway = bazaar.areas.find((a) => a.id === bazaar.hallway);
  const nameOf = (slug?: string) => page.stores.find((s) => s.slug === slug)?.name;

  return (
    <div className="space-y-4">
      <header>
        <a href="/stores" className="text-[13px] text-amber-200/80 underline">← فروشگاه‌ها · Stores</a>
        <h1 className="sk-font mt-2 text-2xl font-bold text-amber-200">بیرون، لابی و راهرو</h1>
        <p dir="ltr" className="text-left text-[13px] text-white/50">The bazaar's areas, in walking order. Each walk carries on into the next one by itself.</p>
      </header>
      <Said text={err} />

      {bazaar.areas.map((a, i) => (
        <Card key={a.id} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Bi fa={`${i + 1}. ${a.name.fa || a.name.en}`} en={`${a.name.en}${a.id === bazaar.hallway ? " — the hallway, where the stores' doors are" : ""}`} className="text-[17px] font-bold text-amber-100" />
            <div className="flex gap-2">
              <button type="button" disabled={i === 0} className={QUIET} onClick={() => void act({ action: "move", id: a.id, by: -1 })}>↑</button>
              <button type="button" disabled={i === bazaar.areas.length - 1} className={QUIET} onClick={() => void act({ action: "move", id: a.id, by: 1 })}>↓</button>
              {a.id !== bazaar.hallway && <button type="button" className={QUIET} onClick={() => void act({ action: "hallway", id: a.id })}>This is the hallway</button>}
            </div>
          </div>
          {page.walks[a.id] && <a href={page.walks[a.id]} target="_blank" rel="noreferrer" className={`${KEY} inline-flex items-center`}>قدم زدن · Walk it ↗</a>}
          <FilePick
            fa="ویدیوی ۳۶۰ درجه (Insta360)" en="Its 360° walk (Insta360 Studio export, .mp4)" accept=".mp4,.insv,video/mp4"
            hint="Walk slowly, camera above your head, the way a shopper would. Export: 360 Video, 8K, maximum bitrate, H.265, Anti-Flicker on."
            current={a.files.video?.name ?? null}
            send={async (file, onProgress) => { await uploadInParts(API, { action: "upload", id: a.id }, file, onProgress); await load(); }}
          />
          {a.files.video && <Steps steps={[["video", a.video]]} say={{ video: { en: "Video agent — web and phone copies", fa: "ویدیو — نسخه وب و موبایل" } }} />}
          {a.walk && (
            <FilePick fa="موسیقی پس‌زمینه" en="Background music (.mp3 / .m4a)" accept=".mp3,.m4a,audio/mpeg,audio/mp4" hint="Only music you have the right to use."
              send={async (file) => { await uploadMusic(API, { id: a.id }, file); await load(); }} />
          )}
          <Thread entries={a.thread} hint="e.g. «remove 0:40 to 1:05» · «stop the music»" send={async (text) => { await postJson(API, { action: "message", id: a.id, text }); await load(); }} />
        </Card>
      ))}

      <Card>
        <Bi fa="افزودن بخش" en="Add an area (e.g. a second hallway, the food court)" className="text-[15px] font-bold" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input dir="ltr" placeholder="id: food-court" value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value.toLowerCase() })} className={FIELD} />
          <input dir="ltr" placeholder="Food court" value={add.en} onChange={(e) => setAdd({ ...add, en: e.target.value })} className={FIELD} />
          <input dir="rtl" placeholder="فودکورت" value={add.fa} onChange={(e) => setAdd({ ...add, fa: e.target.value })} className={FIELD} />
        </div>
        <button type="button" disabled={!add.id || !add.en} className={`${QUIET} mt-2`} onClick={() => void act({ action: "put", ...add }).then(() => setAdd({ id: "", en: "", fa: "" }))}>افزودن · Add</button>
      </Card>

      <Card>
        <Bi fa="جای درها در راهرو" en="Door spots on the hallway — stores fill them in order" className="text-[15px] font-bold text-amber-100" />
        {!hallway?.walk ? (
          <p className="mt-2 text-[13px] text-white/55">Upload the hallway's walk first; then its spots are marked on it. · ابتدا ویدیوی راهرو را بارگذاری کنید.</p>
        ) : (
          <>
            <a href={`${page.walks[hallway.id]}&spots=1`} target="_blank" rel="noreferrer" className={`${KEY} mt-3 inline-flex items-center`}>علامت‌گذاری جای درها · Mark door spots ↗</a>
            <p dir="ltr" className="mt-2 text-left text-[12px] text-white/45">On the walk: go to where a door should be, turn to face the wall, press «Door spot here». Back here, the list updates by itself.</p>
          </>
        )}
        <ol className="mt-4 space-y-2">
          {bazaar.spots.map((sp, i) => (
            <li key={sp.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2">
              <span dir="ltr" className="w-40 text-left text-[13px]">{i + 1}. {sp.id} · {sp.t.toFixed(1)} s · {Math.round((sp.yaw * 180) / Math.PI)}°</span>
              <select
                value={sp.store ?? ""}
                onChange={(e) => e.target.value && void act({ action: "moveStore", store: e.target.value, to: sp.id })}
                className={`${FIELD} w-auto min-w-[12rem] flex-1`}
              >
                <option value="">{sp.store ? "" : "— free · خالی —"}</option>
                {page.stores.map((s) => <option key={s.slug} value={s.slug}>{s.name.fa || s.name.en} · {s.name.en}</option>)}
              </select>
              {sp.store && <span className="text-[12px] text-white/50">{nameOf(sp.store)?.en}</span>}
              <button type="button" className="text-[12px] text-rose-200/80 underline" onClick={() => void act({ action: "spotRemove", id: sp.id })}>remove</button>
            </li>
          ))}
          {!bazaar.spots.length && <li className="text-[13px] text-white/45">No spots marked yet.</li>}
        </ol>
      </Card>
    </div>
  );
}
