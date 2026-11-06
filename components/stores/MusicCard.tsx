"use client";

/**
 * THE STORE'S MUSIC, UP TO 3 TRACKS (owner, 2026-11-06: "lets operator to add upto 3 .mp3 music to the store
 * walk that should be played uninterrupted one after another in the same order music 1, 2, 3"). One slot each:
 * upload (or replace) and take out. The walk plays 1 → 2 → 3, then from 1 again (`WalkSound`).
 */

import { useState } from "react";
import { postJson, uploadMusic } from "./upload";
import { Bi, FilePick, QUIET, Said } from "./ui";

export type Track = { key: string; url: string | null };
const SLOTS = 3;
const FA_NUM = ["۱", "۲", "۳"];

/** When a track was uploaded, from its key (`sound-YYYYMMDD-HHMMSS`). */
function whenOf(key: string): string {
  const m = /sound-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(key);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : key.split("/").pop() ?? key;
}

export default function MusicCard({ api, tracks, reload }: { api: string; tracks: Track[]; reload: () => Promise<void> }) {
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
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
