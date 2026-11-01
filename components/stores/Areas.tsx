"use client";

/**
 * `/stores/areas` — THE BAZAAR'S OWN WALKS (owner, 2026-10-30: "another
 * screen for the hallway and outside area of shopping center and probably the
 * lobby … connect the area's nicely and seamlessly").
 *
 * PLACES (owner, 2026-11-01: four stores, O1-L1-H1-S1, O1-S2, O2-S3,
 * O1-L1-H2-S4): the bazaar is a set of places (World on Yonge, a plaza…),
 * each with its own areas. Each area is one Insta360 walk, uploaded here and
 * made walkable by the Video agent. An area's walk carries on into the next
 * area of its place at its end, unless set otherwise («At its end»). Door
 * spots are marked on ANY area's walk («Mark door spots on this walk»): a
 * spot holds a store's door (stores fill free spots in order, and can be
 * moved here) or a door into another area (a lobby's doors into two
 * hallways). Each area has its own message box to the crew and its own music.
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
  const [add, setAdd] = useState({ id: "", en: "", fa: "", place: "" });
  const [addPlace, setAddPlace] = useState({ id: "", en: "", fa: "" });
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
  const areaName = (id?: string) => { const a = bazaar.areas.find((x) => x.id === id); return a ? a.name.fa || a.name.en : id ?? ""; };
  const nameOf = (slug?: string) => page.stores.find((s) => s.slug === slug)?.name;
  const byDoor = new Set(bazaar.spots.map((s) => s.toArea).filter(Boolean) as string[]);
  /** Where an area's walk carries on by default: the next area of its place, unless that one is entered by a door. */
  const defaultNext = (i: number) => {
    const a = bazaar.areas[i];
    const n = bazaar.areas.slice(i + 1).find((x) => x.place === a.place);
    return n && !byDoor.has(n.id) ? n : null;
  };

  return (
    <div className="space-y-4">
      <header>
        <a href="/stores" className="text-[13px] text-amber-200/80 underline">← فروشگاه‌ها · Stores</a>
        <h1 className="sk-font mt-2 text-2xl font-bold text-amber-200">مکان‌ها و بخش‌ها</h1>
        <p dir="ltr" className="text-left text-[13px] text-white/50">Places (a shopping centre, a plaza), each with its areas: outside, lobby, hallways. Leave out any area a place does not have. Doors — to a store or into another area — go on any area&apos;s walk.</p>
      </header>
      <Said text={err} />

      {bazaar.places.map((pl) => {
        const areas = bazaar.areas.map((a, i) => ({ a, i })).filter(({ a }) => a.place === pl.id);
        return (
          <section key={pl.id} className="space-y-3 rounded-2xl border border-amber-300/25 p-3">
            <Bi fa={pl.name.fa || pl.name.en} en={`${pl.name.en} — a place · ${areas.length} areas`} className="text-[19px] font-bold text-amber-200" />
            {areas.map(({ a, i }) => {
              const dn = defaultNext(i);
              return (
                <Card key={a.id} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Bi fa={a.name.fa || a.name.en} en={`${a.name.en} · ${a.id}`} className="text-[17px] font-bold text-amber-100" />
                    <div className="flex gap-2">
                      <button type="button" disabled={i === 0} className={QUIET} onClick={() => void act({ action: "move", id: a.id, by: -1 })}>↑</button>
                      <button type="button" disabled={i === bazaar.areas.length - 1} className={QUIET} onClick={() => void act({ action: "move", id: a.id, by: 1 })}>↓</button>
                    </div>
                  </div>
                  <div dir="ltr" className="grid gap-2 text-left text-[13px] sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-white/60">Place</span>
                      <select value={a.place} onChange={(e) => void act({ action: "areaSet", id: a.id, place: e.target.value })} className={FIELD}>
                        {bazaar.places.map((p) => <option key={p.id} value={p.id}>{p.name.en}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-white/60">At the end of its walk, carry on into</span>
                      <select value={a.next === undefined ? "__default" : a.next}
                        onChange={(e) => void act({ action: "areaSet", id: a.id, next: e.target.value === "__default" ? null : e.target.value })} className={FIELD}>
                        <option value="__default">{dn ? `${dn.name.en} (next in the list)` : "nowhere (nothing next in the list)"}</option>
                        <option value="">nowhere — it ends there</option>
                        {bazaar.areas.filter((x) => x.id !== a.id).map((x) => <option key={x.id} value={x.id}>{x.name.en}</option>)}
                      </select>
                    </label>
                  </div>
                  {page.walks[a.id] && (
                    <div className="flex flex-wrap gap-2">
                      <a href={page.walks[a.id]} target="_blank" rel="noreferrer" className={`${KEY} inline-flex items-center`}>قدم زدن · Walk it ↗</a>
                      <a href={`${page.walks[a.id]}&spots=1&area=${encodeURIComponent(a.id)}`} target="_blank" rel="noreferrer" className={`${QUIET} inline-flex items-center`}>علامت‌گذاری جای درها · Mark door spots on this walk ↗</a>
                    </div>
                  )}
                  <FilePick
                    fa="ویدیوی ۳۶۰ درجه (Insta360)" en="Its 360° walk (Insta360 Studio export, .mp4)" accept=".mp4,.insv,video/mp4"
                    hint="Walk slowly, camera above your head, the way a shopper would; stop 2–3 s facing each door. Start where the area before it ends. Export: 360 Video, 8K, maximum bitrate, H.265, Anti-Flicker on."
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
              );
            })}
            {!areas.length && <p className="text-[13px] text-white/45">No areas in this place yet: add one below.</p>}
          </section>
        );
      })}

      <Card>
        <Bi fa="افزودن بخش" en="Add an area (e.g. a second hallway, outside a plaza)" className="text-[15px] font-bold" />
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <input dir="ltr" placeholder="id: hallway-2" value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value.toLowerCase() })} className={FIELD} />
          <input dir="ltr" placeholder="Hallway 2" value={add.en} onChange={(e) => setAdd({ ...add, en: e.target.value })} className={FIELD} />
          <input dir="rtl" placeholder="راهرو ۲" value={add.fa} onChange={(e) => setAdd({ ...add, fa: e.target.value })} className={FIELD} />
          <select dir="ltr" value={add.place || bazaar.places[0]?.id} onChange={(e) => setAdd({ ...add, place: e.target.value })} className={FIELD}>
            {bazaar.places.map((p) => <option key={p.id} value={p.id}>{p.name.en}</option>)}
          </select>
        </div>
        <button type="button" disabled={!add.id || !add.en} className={`${QUIET} mt-2`}
          onClick={() => void act({ action: "put", ...add, place: add.place || bazaar.places[0]?.id }).then(() => setAdd({ id: "", en: "", fa: "", place: "" }))}>افزودن · Add</button>
      </Card>

      <Card>
        <Bi fa="افزودن مکان" en="Add a place (another shopping centre or plaza)" className="text-[15px] font-bold" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input dir="ltr" placeholder="id: plaza-2" value={addPlace.id} onChange={(e) => setAddPlace({ ...addPlace, id: e.target.value.toLowerCase() })} className={FIELD} />
          <input dir="ltr" placeholder="Name (English)" value={addPlace.en} onChange={(e) => setAddPlace({ ...addPlace, en: e.target.value })} className={FIELD} />
          <input dir="rtl" placeholder="نام (فارسی)" value={addPlace.fa} onChange={(e) => setAddPlace({ ...addPlace, fa: e.target.value })} className={FIELD} />
        </div>
        <button type="button" disabled={!addPlace.id || !addPlace.en} className={`${QUIET} mt-2`}
          onClick={() => void act({ action: "place", ...addPlace }).then(() => setAddPlace({ id: "", en: "", fa: "" }))}>افزودن · Add</button>
        <p dir="ltr" className="mt-2 text-left text-[12px] text-white/45">To rename a place, add it again with the same id.</p>
      </Card>

      <Card>
        <Bi fa="جای درها" en="Door spots — each holds a store's door, or a door into another area" className="text-[15px] font-bold text-amber-100" />
        <p dir="ltr" className="mt-1 text-left text-[12px] text-white/45">Mark spots with «Mark door spots on this walk» on an area above: go to where a door is, face it, press «Door spot here». Stores take free spots in order; choose here to move one, or to make a spot the door into another area.</p>
        {bazaar.areas.filter((a) => bazaar.spots.some((s) => s.area === a.id)).map((a) => (
          <div key={a.id} className="mt-4">
            <div className="text-[14px] font-bold text-amber-100">{areaName(a.id)} <span dir="ltr" className="text-[12px] font-normal text-white/50">· {a.name.en}</span></div>
            <ol className="mt-2 space-y-2">
              {bazaar.spots.filter((s) => s.area === a.id).map((sp) => (
                <li key={sp.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2">
                  <span dir="ltr" className="w-36 text-left text-[13px]">{sp.id} · {sp.t.toFixed(1)} s · {Math.round((sp.yaw * 180) / Math.PI)}°</span>
                  <select
                    value={sp.toArea ? `area:${sp.toArea}` : sp.store ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("area:")) void act({ action: "spotLink", id: sp.id, toArea: v.slice(5) });
                      else if (v) void act({ action: "moveStore", store: v, to: sp.id });
                      else void act({ action: "spotLink", id: sp.id, toArea: "" });
                    }}
                    className={`${FIELD} w-auto min-w-[12rem] flex-1`}
                  >
                    <option value="">— free · خالی —</option>
                    <optgroup label="A store's door">
                      {page.stores.map((s) => <option key={s.slug} value={s.slug}>{s.name.fa || s.name.en} · {s.name.en}</option>)}
                    </optgroup>
                    <optgroup label="A door into another area">
                      {bazaar.areas.filter((x) => x.id !== a.id).map((x) => <option key={x.id} value={`area:${x.id}`}>→ {x.name.en}</option>)}
                    </optgroup>
                  </select>
                  {sp.store && <span className="text-[12px] text-white/50">{nameOf(sp.store)?.en}</span>}
                  <button type="button" className="text-[12px] text-rose-200/80 underline" onClick={() => void act({ action: "spotRemove", id: sp.id })}>remove</button>
                </li>
              ))}
            </ol>
          </div>
        ))}
        {!bazaar.spots.length && <p className="mt-3 text-[13px] text-white/45">No spots marked yet.</p>}
      </Card>
    </div>
  );
}
