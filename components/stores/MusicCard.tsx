"use client";

/**
 * THE STORE'S MUSIC, UP TO 3 TRACKS (owner, 2026-11-06: "lets operator to add upto 3 .mp3 music to the store
 * walk that should be played uninterrupted one after another in the same order music 1, 2, 3"). One slot each:
 * upload (or replace) and take out. The walk plays 1 → 2 → 3, then from 1 again (`WalkSound`).
 *
 * OR TUNE IN TO NIKOO.TV (owner, 2026-11-06: "in addition to uploading 3 audio file lets have the choice of
 * tuning into a music channel from nikoo.tv"): channel 4 plays live instead (only 4: "only channel 4 nikoo") (`Walk.radio`, `lib/radio.ts`).
 * The uploaded tracks are kept, and play again when the store goes back to them.
 *
 * ANY CHANNEL, ANY CATEGORY (owner, 2026-11-13: "let the music for free store tour be chosen from any of nikoo.tv
 * live tv channels or from any category in World Music or in Iranian Music"). Four choices, one question each:
 * the store's own tracks · a Nikoo.tv channel (which one?) · Iranian Music · World Music (which group? → all of
 * it, or which singer?). A pick saves by itself and the card then says what shoppers will hear, read from
 * nikoo.tv that moment. The list is nikoo.tv's own (`/api/radio?catalogue=1`), so what it adds appears here.
 */

import { useEffect, useState } from "react";
import { postJson, uploadMusic } from "./upload";
import { Bi, FilePick, QUIET, Said } from "./ui";
import { sourceQuery, type MusicMember, type RadioCatalogue, type RadioNow, type RadioSource, type RadioTrack } from "@/lib/radio";

export type Track = { key: string; url: string | null };
const SLOTS = 3;
const FA_NUM = ["۱", "۲", "۳"];

/** When a track was uploaded, from its key (`sound-YYYYMMDD-HHMMSS`). */
function whenOf(key: string): string {
  const m = /sound-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(key);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : key.split("/").pop() ?? key;
}

const SELECT = "w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-[14px] text-white disabled:opacity-40";
type Mode = "own" | "channel" | MusicMember;
const modeOf = (r: RadioSource | null): Mode => (!r ? "own" : r.kind === "channel" ? "channel" : r.member);
const both = (x: { fa: string; en: string }) => (x.fa && x.fa !== x.en ? `${x.en} · ${x.fa}` : x.en || x.fa);

/** What shoppers will hear with this choice, asked of nikoo.tv now: so a choice that cannot play says so here. */
function Heard({ source }: { source: RadioSource }) {
  const [text, setText] = useState<{ ok: boolean; text: string } | null>(null);
  const q = sourceQuery(source);
  useEffect(() => {
    let gone = false;
    setText(null);
    void fetch(`/api/radio?${q}`, { cache: "no-store" }).then((r) => r.json()).then((j: { radio?: RadioNow; tracks?: RadioTrack[]; reason?: string }) => {
      if (gone) return;
      if (j.radio) {
        const r = j.radio;
        const title = r.now?.en || r.now?.fa;
        if (r.kind === "none") setText({ ok: false, text: `This channel cannot be played in a walk right now (${r.reason ?? "nothing on air"}): shoppers hear the store's own tracks instead, or nikoo.tv's channel 4 if there are none.` });
        else setText({ ok: true, text: `On air now${title ? `: ${title}` : ""}. ${r.kind === "file"
          ? "Plays on computers and phones."
          : "This programme is a YouTube video: it plays on computers; a phone plays the store's own tracks meanwhile, or nikoo.tv's channel 4 if there are none."}` });
      } else {
        const t = j.tracks ?? [];
        const files = t.filter((x) => x.kind === "file").length;
        if (!t.length) setText({ ok: false, text: `Nothing to play here (${j.reason ?? "no tracks"}): shoppers hear the store's own tracks instead, or nikoo.tv's channel 4 if there are none.` });
        else setText({ ok: true, text: `${t.length} tracks, one after another. ${files === t.length ? "They play on computers and phones."
          : files ? `All play on computers; ${files} of them play on phones.`
          : "They are YouTube videos: they play on computers; a phone plays the store's own tracks instead, or nikoo.tv's channel 4 if there are none."}` });
      }
    }).catch(() => { if (!gone) setText({ ok: false, text: "nikoo.tv could not be asked what this plays. The choice is saved." }); });
    return () => { gone = true; };
  }, [q]);
  return <p dir="ltr" className={`text-left text-[12px] ${text && !text.ok ? "text-rose-200" : "text-white/60"}`}>{text ? text.text : "Asking nikoo.tv what this plays… (a whole group can take half a minute the first time)"}</p>;
}

export default function MusicCard({ api, tracks, radio, reload }: {
  api: string; tracks: Track[]; radio: RadioSource | null; reload: () => Promise<void>;
}) {
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(modeOf(radio));
  const [cat, setCat] = useState<RadioCatalogue | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null); // the group being looked through, before a pick
  useEffect(() => { setMode(modeOf(radio)); setGroup(null); }, [radio]);
  // nikoo.tv's list, asked for when a nikoo.tv choice is opened (or already made).
  const wantCat = mode !== "own";
  useEffect(() => {
    if (!wantCat || cat) return;
    let gone = false;
    setCatErr(null);
    void fetch("/api/radio?catalogue=1").then((r) => r.json()).then((j: { ok?: boolean; catalogue?: RadioCatalogue; error?: string }) => {
      if (gone) return;
      if (j.ok && j.catalogue) setCat(j.catalogue);
      else setCatErr(j.error || "nikoo.tv's list could not be read.");
    }).catch(() => { if (!gone) setCatErr("nikoo.tv's list could not be read. Check the connection and choose again."); });
    return () => { gone = true; };
  }, [wantCat, cat]);

  async function save(source: { kind: "channel"; id: string } | { kind: "music"; member: MusicMember; id: string } | null, name: string) {
    setSaid(null);
    setBusy(true);
    try {
      await postJson(api, source ? { action: "musicRadio", source } : { action: "musicRadio", channel: null });
      await reload();
      setSaid({ ok: true, text: source ? `✓ Saved: the walk now plays ${name} · ذخیره شد` : "✓ Saved: the walk plays the store's own tracks · قطعه‌های خود فروشگاه پخش می‌شود" });
    } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }
  function pickMode(m: Mode) {
    setMode(m);
    setGroup(null);
    setSaid(null);
    if (m === "own" && radio) void save(null, "");
  }
  const section = mode === "iranmusic" || mode === "worldmusic" ? cat?.sections.find((x) => x.member === mode) ?? null : null;
  const music = radio?.kind === "music" && radio.member === mode ? radio : null;
  // The group shown: the one being looked through, else the saved choice's (itself a group, or its singer's).
  const groupId = group ?? (music && section ? (section.groups.find((g) => g.id === music.id || g.categories.some((c) => c.id === music.id))?.id ?? null) : null);
  const groupNow = section && groupId !== null ? section.groups.find((g) => g.id === groupId) ?? null : null;
  const choice = (on: boolean) => `rounded-lg border px-3 py-2 text-left text-[13px] disabled:opacity-40 ${on ? "border-amber-300 bg-amber-300/15 text-white" : "border-white/15 text-white/80"}`;
  // A slot can only be filled in order: music 2 once there is a music 1 (a gap would close up anyway).
  const open = Math.min(SLOTS, tracks.length + 1);
  async function clear(slot: number) {
    setSaid(null);
    try { await postJson(api, { action: "musicClear", slot }); await reload(); setSaid({ ok: true, text: `✓ Music ${slot + 1} taken out · برداشته شد` }); }
    catch (e) { setSaid({ ok: false, text: `Not taken out: ${(e as Error).message}` }); }
  }
  return (
    <div className="space-y-3">
      <Bi fa="موسیقی پس‌زمینه فروشگاه (تا ۳ قطعه، به ترتیب)" en="The store walk's music: up to 3 tracks (.mp3 / .m4a), played one after another, 1 → 2 → 3, then from 1"
        className="text-[15px] font-bold text-amber-100" />
      <div className="space-y-2">
        <Bi fa="چه چیزی پخش شود؟" en="What the walk plays" className="text-[13px] font-bold text-white/85" />
        <div dir="ltr" className="flex flex-wrap gap-2">
          {([["own", "The store's own tracks (below)", ""], ["channel", "A Nikoo.tv live channel", "کانال زنده نیکو"],
            ["iranmusic", "Iranian Music", "موسیقی ایرانی"], ["worldmusic", "World Music", "موسیقی جهان"]] as Array<[Mode, string, string]>).map(([m, en, fa]) => (
            <button key={m} type="button" disabled={busy} className={choice(mode === m)} onClick={() => pickMode(m)}>
              {mode === m ? "● " : "○ "}{en}{fa && <> · <span dir="rtl">{fa}</span></>}
            </button>
          ))}
        </div>
        {mode !== "own" && !cat && <p dir="ltr" className={`text-left text-[13px] ${catErr ? "text-rose-200" : "text-white/60"}`}>{catErr ?? "Reading nikoo.tv's list…"}</p>}
        {mode === "channel" && cat && (
          <label className="block space-y-1">
            <Bi fa="کدام کانال؟" en="Which channel? (saved as soon as you choose)" className="text-[13px] text-white/75" />
            <select dir="ltr" className={SELECT} disabled={busy} value={radio?.kind === "channel" ? radio.id : ""}
              onChange={(e) => { const c = cat.channels.find((x) => x.id === e.target.value); if (c) void save({ kind: "channel", id: c.id }, `Nikoo.tv ${c.en} live`); }}>
              <option value="" disabled>Choose a channel…</option>
              {cat.channels.map((c) => <option key={c.id} value={c.id}>{c.n ? `${c.n} · ` : ""}{both(c)}</option>)}
            </select>
          </label>
        )}
        {section && (
          <>
            <label className="block space-y-1">
              <Bi fa="کدام دسته؟" en={`Which kind of ${section.en.trim() || "music"}?`} className="text-[13px] text-white/75" />
              <select dir="ltr" className={SELECT} disabled={busy} value={groupId ?? "-"} onChange={(e) => setGroup(e.target.value)}>
                <option value="-" disabled>Choose…</option>
                {section.groups.map((g) => <option key={g.id} value={g.id}>{both(g)} ({g.categories.length})</option>)}
              </select>
            </label>
            {groupNow && (
              <label className="block space-y-1">
                <Bi fa="همه یا یک خواننده؟" en="All of it, or one of its singers? (saved as soon as you choose)" className="text-[13px] text-white/75" />
                <select dir="ltr" className={SELECT} disabled={busy} value={music && (music.id === groupNow.id || groupNow.categories.some((c) => c.id === music.id)) ? music.id : "-"}
                  onChange={(e) => {
                    const id = e.target.value;
                    const c = groupNow.categories.find((x) => x.id === id);
                    void save({ kind: "music", member: section.member, id }, c ? c.en : `all of ${groupNow.en}`);
                  }}>
                  <option value="-" disabled>Choose…</option>
                  {groupNow.id && <option value={groupNow.id}>★ All of {both(groupNow)}</option>}
                  {groupNow.categories.map((c) => <option key={c.id} value={c.id}>{both(c)}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {radio && modeOf(radio) === mode && (
          <div className="space-y-1 rounded-lg border border-white/10 p-3">
            <p dir="ltr" className="text-left text-[13px] font-bold text-white/85">Now chosen: {radio.kind === "channel" ? "Nikoo.tv channel, live" : radio.member === "iranmusic" ? "Iranian Music" : "World Music"} · {both(radio)}</p>
            <Heard source={radio} />
          </div>
        )}
      </div>
      <p dir="ltr" className="text-left text-[12px] text-white/45">Only music you have the right to use. «stop the music» in the message box turns it all off.</p>
      {Array.from({ length: open }, (_, slot) => {
        const t = tracks[slot];
        return (
          <div key={slot} className="rounded-lg border border-white/10 p-3">
            {t && (
              <div dir="ltr" className="mb-2 flex flex-wrap items-center gap-3 text-left text-[13px]">
                <span>✓ Music {slot + 1}: uploaded {whenOf(t.key)}</span>
                {t.url && <audio controls preload="none" src={t.url} className="h-8" />}
                <button type="button" className={QUIET} onClick={() => void clear(slot)}>✕ Take out</button>
              </div>
            )}
            <FilePick
              fa={`موسیقی ${FA_NUM[slot]}`} en={t ? `Replace music ${slot + 1}` : `Music ${slot + 1}`}
              accept=".mp3,.m4a,audio/mpeg,audio/mp4"
              send={async (file) => { await uploadMusic(api, { slot }, file); await reload(); }}
            />
          </div>
        );
      })}
      {said && <Said ok={said.ok} text={said.text} />}
    </div>
  );
}
