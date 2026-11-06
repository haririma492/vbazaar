"use client";

/**
 * THE STORE'S MUSIC, UP TO 3 TRACKS (owner, 2026-11-06: "lets operator to add upto 3 .mp3 music to the store
 * walk that should be played uninterrupted one after another in the same order music 1, 2, 3"). One slot each:
 * upload (or replace) and take out. The walk plays 1 → 2 → 3, then from 1 again (`WalkSound`).
 *
 * OR TUNE IN TO NIKOO.TV (owner, 2026-11-06: "in addition to uploading 3 audio file lets have the choice of
 * tuning into a music channel from nikoo.tv"): channel 4 plays live instead (only 4: "only channel 4 nikoo") (`Walk.radio`, `lib/radio.ts`).
 * The uploaded tracks are kept, and play again when the store goes back to them.
 */

import { useState } from "react";
import { postJson, uploadMusic } from "./upload";
import { Bi, FilePick, QUIET, Said } from "./ui";
import { RADIO, RADIO_CHANNELS, type RadioChannel } from "@/lib/radio";

export type Track = { key: string; url: string | null };
const SLOTS = 3;
const FA_NUM = ["۱", "۲", "۳"];

/** When a track was uploaded, from its key (`sound-YYYYMMDD-HHMMSS`). */
function whenOf(key: string): string {
  const m = /sound-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(key);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : key.split("/").pop() ?? key;
}

const FA_CH: Record<RadioChannel, string> = { 4: "۴" };

export default function MusicCard({ api, tracks, radio, reload }: {
  api: string; tracks: Track[]; radio: RadioChannel | null; reload: () => Promise<void>;
}) {
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function tune(channel: RadioChannel | null) {
    setSaid(null);
    setBusy(true);
    try {
      await postJson(api, { action: "musicRadio", channel });
      await reload();
      setSaid({ ok: true, text: channel
        ? `✓ The walk now plays Nikoo.tv channel ${channel} live · کانال ${FA_CH[channel]} نیکو پخش می‌شود`
        : "✓ The walk plays the store's own tracks · قطعه‌های خود فروشگاه پخش می‌شود" });
    } catch (e) { setSaid({ ok: false, text: `Not changed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }
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
          <button type="button" disabled={busy} className={choice(!radio)} onClick={() => void tune(null)}>
            {!radio ? "● " : "○ "}The store&apos;s own tracks (below)
          </button>
          {RADIO_CHANNELS.map((ch) => (
            <button key={ch} type="button" disabled={busy} className={choice(radio === ch)} onClick={() => void tune(ch)}>
              {radio === ch ? "● " : "○ "}Nikoo.tv channel {ch} live · <span dir="rtl">کانال {FA_CH[ch]} · {RADIO[ch].fa}</span>
            </button>
          ))}
        </div>
        {radio && (
          <p dir="ltr" className="text-left text-[12px] text-white/55">
            Shoppers join whatever channel {radio} is airing at that moment, as on nikoo.tv. While it airs a YouTube programme the
            walk plays the tracks below instead (or nothing, if there are none). The tracks are kept either way.
          </p>
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
