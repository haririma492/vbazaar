"use client";

/**
 * A WALK'S BACKGROUND SOUND (founder, 2026-10-18: "how to add my own audio"
 * → a background loop). The walk video stays muted — walked back and at 2–3×
 * its own sound would garble — so a walk may carry a sound of its own
 * (`Walk.audio`): music or the store's hum, looped whatever the shopper does.
 *
 * - `WalkSound`: the player and its 🔊 / 🔇 key. A browser plays sound only
 *   after a tap, so it starts on the shopper's first tap (the pedal, the
 *   wheel, a drag). The key's choice is remembered on this device.
 * - `SoundEditor`: the walk's edit page, «Sound» — one question: choose the
 *   file. It uploads, saves by itself (the editor's autosave) and says so.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_WALK_AUDIO_BYTES, audioTypeOf } from "@/lib/splats/keys";
import { setAudio, walkOf, type Walks } from "@/lib/splats/walks";
import { readAdminToken } from "@/lib/admin/useAdminMode";
import { MAIN_CHANNEL, positionAt, radioSourceOf, sourceQuery, type RadioFile, type RadioNow, type RadioSource, type RadioTrack } from "@/lib/radio";

const MUTE_KEY = "walk-sound";

function readOn(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Whether the shopper has sound on (the 🔊 / 🔇 key): the walk's loop and the specials' voice. */
/** The walk's background music, by default. Was 0.6; owner asked for 25% less. */
const WALK_MUSIC_VOLUME = 0.45;

export const soundOn = () => typeof window !== "undefined" && readOn();

/** An English woman's voice where the device has one (founder: "Robotic lady in english"). */
function ladyVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  const lady = /female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|aria|jenny|susan|hazel|libby|google us english|google uk english female/i;
  return all.find((v) => lady.test(v.name)) ?? all.find((v) => /en-us/i.test(v.lang)) ?? all[0] ?? null;
}

/**
 * Say a special aloud, in English, once (`specialSay`) — only with sound on,
 * and never over another one still being said.
 */
export function sayAloud(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !readOn()) return;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = ladyVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-US";
  u.rate = 1;
  u.pitch = 1.1;
  synth.speak(u);
}

function writeOn(on: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, on ? "on" : "off");
  } catch {
    // private window: the choice lasts this visit only
  }
}

export function WalkSound({ audioKeys, srcOf, specials = false, radio = null, place = "bottom-14 left-3", label = true }: {
  /** What the walk plays, in order (`musicOf`): one looped, or up to 3 one after another, then from the first. */
  audioKeys: string[];
  srcOf: (key: string) => Promise<string | null>;
  /** The walk has items on special, which speak: the key is shown for them too. */
  specials?: boolean;
  /** Tuned in to nikoo.tv (`Walk.radio`): a channel, live, or a category of its music, instead of `audioKeys`. */
  radio?: 4 | RadioSource | null;
  /** Where the key sits. */
  place?: string;
  /** The label beside the key. */
  label?: boolean;
}) {
  const source = radioSourceOf(radio);
  // `key`: another choice is another player, never the last one's state carried over.
  if (source?.kind === "music") return <ListSound key={sourceQuery(source)} source={source} audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} label={label} />;
  if (source) return <RadioSound key={source.id} ch={source.id} audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} label={label} />;
  return <TrackSound audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} />;
}

function TrackSound({ audioKeys, srcOf, specials, place }: { audioKeys: string[]; srcOf: (key: string) => Promise<string | null>; specials: boolean; place: string }) {
  const [on, setOn] = useState(true);
  const [waiting, setWaiting] = useState(false); // the browser wants a tap first
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => setOn(readOn()), []);

  const listKey = audioKeys.join("|");
  const audioKey = audioKeys[0] ?? null;
  // The walk's sound: a new walk (a door, the next aisle) swaps it. Several tracks (owner, 2026-11-06: "played
  // uninterrupted one after another in the same order music 1, 2, 3"): ONE audio element; when a track ends it
  // takes the next one's address and plays on, after the last the first again. (A first version kept an element
  // per track, all loading at once; the owner's Chrome and Edge ran out of memory with two tracks. One element
  // holds one track at a time.) One track simply loops.
  useEffect(() => {
    const keys = listKey ? listKey.split("|") : [];
    if (!keys.length) return;
    let gone = false;
    const el = new Audio();
    el.preload = "auto";
    // 25% quieter than the 0.6 it was (owner, 2026-11-03: "25% less load").
    el.volume = WALK_MUSIC_VOLUME;
    el.loop = keys.length === 1;
    audio.current = el;
    let i = 0;
    const load = async (k: number, play: boolean) => {
      const src = await srcOf(keys[k]);
      if (gone || !src) return;
      el.src = src;
      if (play && readOn()) start(el);
    };
    let failed = 0; // tracks in a row that would not play: when all have failed, the music stops (no loop of errors)
    const onEnded = () => { if (gone) return; failed = 0; i = (i + 1) % keys.length; void load(i, true); };
    // A track that will not play is passed over (never stuck on it), unless it is the only one.
    const onError = () => { if (gone || keys.length === 1 || ++failed >= keys.length) return; i = (i + 1) % keys.length; void load(i, true); };
    const onPlaying = () => { failed = 0; };
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.addEventListener("playing", onPlaying);
    void load(0, true);
    return () => {
      gone = true;
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.removeEventListener("playing", onPlaying);
      el.pause();
      el.removeAttribute("src");
      el.load();
      if (audio.current === el) audio.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, srcOf]);

  function start(el: HTMLAudioElement) {
    el.play().then(() => setWaiting(false), () => {
      // Not allowed yet: the shopper's first tap anywhere starts it.
      setWaiting(true);
      const go = () => {
        window.removeEventListener("pointerdown", go, true);
        window.removeEventListener("keydown", go, true);
        if (audio.current === el && readOn()) el.play().then(() => setWaiting(false), () => {});
      };
      window.addEventListener("pointerdown", go, true);
      window.addEventListener("keydown", go, true);
    });
  }

  if (!audioKey && !specials) return null;
  const toggle = () => {
    const next = !on;
    setOn(next);
    writeOn(next);
    if (!next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const el = audio.current;
    if (!el) return;
    if (next) start(el);
    else el.pause();
  };
  return (
    <button
      type="button"
      dir="ltr"
      onClick={toggle}
      aria-label={on ? "Sound off" : "Sound on"}
      // Bottom left, above the time bar, 20% larger (owner, 2026-11-06: "move the audio sign to bottom left make it 20% larger").
      className={`absolute ${place} z-20 ${SOUND_KEY_CLASS}`}
    >
      {on ? (waiting && audioKey ? "🔊 tap to hear" : "🔊") : "🔇"}
    </button>
  );
}

const SOUND_KEY_CLASS = "rounded-full border border-white/30 bg-black/60 px-[14px] py-[7px] text-[18px] text-white";
/**
 * NIKOO.TV CHANNEL 4 LIVE IN THE WALK (owner, 2026-11-06): the walk tuned in joins what the channel is airing THIS
 * minute, at the second it has reached, like a radio, and asks again when the programme ends. The 🔊 key and one
 * label, «nikoo.tv live music» (owner, 2026-11-06: "put this label back"); no window (owner: "just remove the
 * youtube window").
 * - A file on our bucket (625 of channel 4's 1,060 programmes, measured 2026-11-06) plays in an <audio>.
 * - A YouTube programme plays in YouTube's player kept OUT OF SIGHT (1×1, transparent) on a computer. ⚠️ YouTube's
 *   terms do not allow a hidden player; the owner chose this knowing it. It starts on the shopper's first tap and 🔇
 *   takes it away. A PHONE will not start it at all, so there the channel's own file programmes play in its place.
 * - Nothing playable on air (a live HLS stream, nikoo.tv unreachable): the store's own tracks, or nothing.
 */
function RadioSound({ ch, audioKeys, srcOf, specials, place, label }: {
  ch: string; audioKeys: string[]; srcOf: (key: string) => Promise<string | null>; specials: boolean; place: string; label: boolean;
}) {
  const [on, setOn] = useState(true);
  const [now, setNow] = useState<RadioNow | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [tick, setTick] = useState(0); // bumped to ask nikoo.tv again (a programme ended, a file failed)
  const audio = useRef<HTMLAudioElement | null>(null);
  const failures = useRef(0);

  useEffect(() => setOn(readOn()), []);

  // What is on air. Asked again when the programme ends (`endsAt`), and every 5 minutes in case the channel moved.
  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const j = (await fetch(`/api/radio?ch=${encodeURIComponent(ch)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as
        { ok?: boolean; radio?: RadioNow; serverTime?: number } | null;
      if (gone) return;
      const r = j?.radio ?? null;
      // The reading's clock is the server's: shift it onto this device's, so the join point is right here.
      const skew = j?.serverTime ? Date.now() - j.serverTime : 0;
      const fixed = r ? { ...r, at: r.at + skew, endsAt: r.endsAt ? r.endsAt + skew : null } : null;
      setNow(fixed);
      const wait = fixed?.endsAt ? Math.min(Math.max(fixed.endsAt - Date.now() + 1500, 3000), 300_000) : fixed?.kind === "file" ? 300_000 : 60_000;
      timer = setTimeout(() => setTick((t) => t + 1), wait);
    })();
    return () => { gone = true; if (timer) clearTimeout(timer); };
  }, [ch, tick]);

  // A PHONE (owner, 2026-11-07: "live channel Nikoo music does not play on mobile"): a phone will not start sound in a
  // hidden YouTube player, so while the channel airs a YouTube programme a phone plays the channel's own FILE
  // programmes, in the channel's order (`nextFileProgramme`, `/api/radio?file=1`), one after another.
  const [phone, setPhone] = useState(false);
  useEffect(() => { setPhone(window.matchMedia?.("(pointer: coarse)").matches ?? false); }, []);
  const [fb, setFb] = useState<RadioFile | null>(null);
  const liveYoutube = now?.kind === "youtube";
  // Only the main broadcast carries its playlist: another channel on a phone has no file programmes to stand in
  // (below: the store's own tracks, else the main broadcast, play in its place).
  const main = ch === MAIN_CHANNEL;
  useEffect(() => {
    if (!main || !phone || !liveYoutube) { setFb(null); return; }
    if (fb) return;
    let gone = false;
    void fetch(`/api/radio?ch=${ch}&file=1`, { cache: "no-store" }).then((r) => r.json()).then((j: { file?: RadioFile | null }) => { if (!gone) setFb(j.file ?? null); }).catch(() => undefined);
    return () => { gone = true; };
  }, [main, phone, liveYoutube, fb, ch]);
  const nextFb = useCallback(() => {
    const after = fb?.itemIndex;
    void fetch(`/api/radio?ch=${ch}&file=1${after !== undefined ? `&after=${after}` : ""}`, { cache: "no-store" })
      .then((r) => r.json()).then((j: { file?: RadioFile | null }) => setFb(j.file ?? null)).catch(() => undefined);
  }, [fb, ch]);

  // What plays in the <audio>: the live file programme (joined at the channel's second), or on a phone the
  // channel's file programme standing in for a YouTube one (from its start).
  const play = now?.kind === "file" && now.url ? { key: now.url, url: now.url, live: true }
    : phone && liveYoutube && fb ? { key: `fb:${fb.itemIndex}:${fb.url}`, url: fb.url, live: false } : null;
  const playRef = useRef(play);
  playRef.current = play;
  const nowRef = useRef(now);
  nowRef.current = now;
  const nextFbRef = useRef(nextFb);
  nextFbRef.current = nextFb;

  // ONE audio element for the whole visit, its address changed per programme: an iPhone lets an element the shopper
  // has unlocked with a tap play on, a new element would need another tap. And it is told to PLAY at once, not after
  // it has loaded: an iPhone does not load media until asked to play (it waited for a load that never came).
  const audioEl = (): HTMLAudioElement => {
    if (!audio.current) {
      const el = new Audio();
      el.preload = "auto";
      el.volume = WALK_MUSIC_VOLUME;
      el.addEventListener("loadedmetadata", () => {
        const p = playRef.current, r = nowRef.current;
        if (p?.live && r) { try { el.currentTime = positionAt(r, Date.now()); } catch { /* not seekable yet */ } }
      });
      el.addEventListener("ended", () => { if (playRef.current?.live) setTick((t) => t + 1); else nextFbRef.current(); });
      el.addEventListener("error", () => {
        if (!el.getAttribute("src")) return;
        if (++failures.current > 3) return;
        setTimeout(() => { if (playRef.current?.live) setTick((t) => t + 1); else nextFbRef.current(); }, 3000);
      });
      el.addEventListener("playing", () => { failures.current = 0; setWaiting(false); });
      audio.current = el;
    }
    return audio.current;
  };
  const playKey = play?.key ?? null;
  useEffect(() => {
    const el = audioEl();
    if (!playKey || !playRef.current) { el.pause(); return; }
    el.src = playRef.current.url;
    if (readOn()) start(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);
  useEffect(() => () => { const el = audio.current; if (el) { el.pause(); el.removeAttribute("src"); el.load(); } }, []);

  function start(el: HTMLAudioElement) {
    el.play().then(() => setWaiting(false), () => {
      setWaiting(true);
      const go = () => {
        window.removeEventListener("pointerdown", go, true);
        window.removeEventListener("keydown", go, true);
        if (audio.current !== el || !readOn() || !el.getAttribute("src")) return;
        const p = playRef.current, r = nowRef.current;
        if (p?.live && r) { try { el.currentTime = positionAt(r, Date.now()); } catch { /* keep where it is */ } }
        el.play().then(() => setWaiting(false), () => {});
      };
      window.addEventListener("pointerdown", go, true);
      window.addEventListener("keydown", go, true);
    });
  }

  // The shopper's first tap anywhere: a YouTube player made after it may play with sound.
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (tapped) return;
    const go = () => setTapped(true);
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
    return () => { window.removeEventListener("pointerdown", go, true); window.removeEventListener("keydown", go, true); };
  }, [tapped]);

  // ⚠️ The start second is fixed ONCE per programme (and when the sound comes back on). It was worked out from the
  // clock in the render, and the walk re-renders all the time: the address changed every second, so the player
  // reloaded every second (owner, 2026-11-06: "broken and intermittent every 1 sec").
  const ytId = now?.kind === "youtube" ? now.youtubeId : null;
  const ytStart = useRef<{ key: string; sec: number } | null>(null);
  const startKey = ytId && on && tapped ? ytId : null;
  if (!startKey) ytStart.current = null;
  else if (ytStart.current?.key !== startKey && now) ytStart.current = { key: startKey, sec: Math.floor(positionAt(now, Date.now())) };

  // Nothing playable this minute (a live stream, nikoo.tv unreachable): the store's own tracks.
  if (now && now.kind === "none") return <TrackSound audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} />;
  // A phone, another channel than the main one, a YouTube programme on air: a phone cannot play it.
  if (phone && liveYoutube && !main) return <Standby audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} label={label} />;
  const yt = !phone && now?.kind === "youtube" && now.youtubeId ? now : null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    writeOn(next);
    if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const el = audio.current;
    if (!el) return;
    if (next) { if (play?.live && now) { try { el.currentTime = positionAt(now, Date.now()); } catch { /* */ } } if (play) start(el); }
    else el.pause();
  };
  return (
    <>
      {yt && on && tapped && (
        <iframe
          key={yt.youtubeId}
          title="nikoo.tv live music"
          aria-hidden="true"
          tabIndex={-1}
          width={1}
          height={1}
          className="pointer-events-none absolute bottom-0 left-0 opacity-0"
          src={`https://www.youtube.com/embed/${yt.youtubeId}?autoplay=1&playsinline=1&controls=0&rel=0&enablejsapi=1&start=${ytStart.current?.sec ?? 0}`}
          allow="autoplay; encrypted-media"
          onLoad={(e) => {
            e.currentTarget.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(WALK_MUSIC_VOLUME * 100)] }), "*");
          }}
        />
      )}
      <div dir="ltr" className={`absolute ${place} z-20 flex items-center gap-2`}>
        <button type="button" onClick={toggle} aria-label={on ? "Sound off" : "Sound on"} className={SOUND_KEY_CLASS}>
          {on ? ((waiting && !yt) || (yt && !tapped) ? "🔊 tap to hear" : "🔊") : "🔇"}
        </button>
        {label && <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1 text-[12px] font-bold text-white">nikoo.tv live music</span>}
      </div>
    </>
  );
}

/** What plays when the choice cannot: the store's own tracks, else nikoo.tv's main broadcast (which has files a phone plays). */
function Standby({ audioKeys, srcOf, specials, place, label }: { audioKeys: string[]; srcOf: (key: string) => Promise<string | null>; specials: boolean; place: string; label: boolean }) {
  if (audioKeys.length) return <TrackSound audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} />;
  return <RadioSound ch={MAIN_CHANNEL} audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} label={label} />;
}

/**
 * A CATEGORY OF NIKOO.TV'S MUSIC IN THE WALK (owner, 2026-11-13: "from any category in World Music or in Iranian
 * Music"): a singer, a label, or a whole group (Jazz, Pop). Not live: its tracks one after another, round and
 * round, from a different one each visit (`/api/radio?m=…&c=…`).
 * - A file nikoo.tv keeps plays in ONE <audio> (as the channels' do).
 * - A YouTube video plays in YouTube's player kept out of sight, as the channels' YouTube programmes do (the
 *   owner's choice, 2026-11-06). The player tells us when the video ends (its own messages), and the next one
 *   starts; one that will not play (not allowed off YouTube, removed) is passed over after 25 s.
 * - A PHONE cannot start a hidden YouTube player: there only the files are played. Nothing left to play (a phone
 *   and a YouTube-only category, twelve tracks in a row that would not play, nikoo.tv unreachable): `Standby`.
 */
const FAILS_IN_A_ROW = 12;
function ListSound({ source, audioKeys, srcOf, specials, place, label }: {
  source: RadioSource; audioKeys: string[]; srcOf: (key: string) => Promise<string | null>; specials: boolean; place: string; label: boolean;
}) {
  const [on, setOn] = useState(true);
  const [tracks, setTracks] = useState<RadioTrack[] | null>(null); // null: still asking
  const [pos, setPos] = useState({ i: 0, turn: 0 }); // `turn` moves on every change, so one track alone plays again
  const [dead, setDead] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const failures = useRef(0);

  useEffect(() => setOn(readOn()), []);

  const query = sourceQuery(source);
  useEffect(() => {
    let gone = false;
    const phone = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    void fetch(`/api/radio?${query}`, { cache: "no-store" }).then((r) => r.json()).then((j: { tracks?: RadioTrack[] }) => {
      if (gone) return;
      const all = Array.isArray(j?.tracks) ? j.tracks : [];
      const list = phone ? all.filter((t) => t.kind === "file") : all;
      setPos({ i: list.length ? Math.floor(Math.random() * list.length) : 0, turn: 0 });
      setTracks(list);
    }).catch(() => { if (!gone) setTracks([]); });
    return () => { gone = true; };
  }, [query]);

  const n = tracks?.length ?? 0;
  const next = useCallback((failed: boolean) => {
    if (failed) { if (++failures.current >= FAILS_IN_A_ROW) { setDead(true); return; } } else failures.current = 0;
    setPos((p) => ({ i: n ? (p.i + 1) % n : 0, turn: p.turn + 1 }));
  }, [n]);
  const nextRef = useRef(next);
  nextRef.current = next;

  const cur = tracks && n && !dead ? tracks[pos.i] ?? null : null;
  const fileUrl = cur?.kind === "file" ? cur.url : null;
  const ytId = cur?.kind === "youtube" ? cur.id : null;

  // ONE audio element for the visit (an iPhone keeps playing the element a tap unlocked), told to play at once.
  const audioEl = (): HTMLAudioElement => {
    if (!audio.current) {
      const el = new Audio();
      el.preload = "auto";
      el.volume = WALK_MUSIC_VOLUME;
      el.addEventListener("ended", () => nextRef.current(false));
      el.addEventListener("error", () => { if (el.getAttribute("src")) setTimeout(() => nextRef.current(true), 1500); });
      el.addEventListener("playing", () => { failures.current = 0; setWaiting(false); });
      audio.current = el;
    }
    return audio.current;
  };
  const start = (el: HTMLAudioElement) => {
    el.play().then(() => setWaiting(false), () => {
      setWaiting(true);
      const go = () => {
        window.removeEventListener("pointerdown", go, true);
        window.removeEventListener("keydown", go, true);
        if (audio.current === el && readOn() && el.getAttribute("src")) el.play().then(() => setWaiting(false), () => {});
      };
      window.addEventListener("pointerdown", go, true);
      window.addEventListener("keydown", go, true);
    });
  };
  useEffect(() => {
    if (!fileUrl) { audio.current?.pause(); return; }
    const el = audioEl();
    el.src = fileUrl;
    if (readOn()) start(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, pos.turn]);
  useEffect(() => () => { const el = audio.current; if (el) { el.pause(); el.removeAttribute("src"); el.load(); } }, []);

  // The shopper's first tap anywhere: a YouTube player made after it may play with sound.
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (tapped) return;
    const go = () => setTapped(true);
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
    return () => { window.removeEventListener("pointerdown", go, true); window.removeEventListener("keydown", go, true); };
  }, [tapped]);

  // YouTube's player says what it is doing in messages to this page: ended → the next track; an error, or
  // answering but not playing after 25 s → passed over. If it never answers at all we cannot know when the
  // video ends, so it is left to play and the next one starts after 10 minutes.
  const showYt = Boolean(ytId && on && tapped);
  const tell = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
  const listen = () => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "vb-music", channel: "widget" }), "https://www.youtube.com");
    tell("addEventListener", ["onStateChange"]);
    tell("addEventListener", ["onError"]);
    tell("setVolume", [Math.round(WALK_MUSIC_VOLUME * 100)]);
  };
  useEffect(() => {
    if (!showYt) return;
    let heard = false, playing = false, over = false;
    const move = (failed: boolean) => { if (!over) { over = true; nextRef.current(failed); } };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== "https://www.youtube.com" || e.source !== frame.current?.contentWindow) return;
      let d: { event?: string; info?: unknown } | null = null;
      try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      if (!d || typeof d !== "object") return;
      heard = true;
      if (d.event === "onError") { move(true); return; }
      const st = d.event === "onStateChange" ? d.info
        : (d.event === "infoDelivery" || d.event === "initialDelivery") && d.info && typeof d.info === "object" ? (d.info as { playerState?: unknown }).playerState : undefined;
      if (st === 1) { playing = true; failures.current = 0; tell("setVolume", [Math.round(WALK_MUSIC_VOLUME * 100)]); }
      if (st === 0) move(false);
    };
    window.addEventListener("message", onMsg);
    const again = [setTimeout(listen, 1000), setTimeout(listen, 3000)];
    const stuck = setTimeout(() => { if (heard && !playing) move(true); }, 25_000);
    const deaf = setTimeout(() => { if (!heard) move(false); }, 600_000);
    return () => { over = true; window.removeEventListener("message", onMsg); again.forEach(clearTimeout); clearTimeout(stuck); clearTimeout(deaf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showYt, ytId, pos.turn]);

  if (tracks && (!n || dead)) return <Standby audioKeys={audioKeys} srcOf={srcOf} specials={specials} place={place} label={label} />;

  const toggle = () => {
    const turnOn = !on;
    setOn(turnOn);
    writeOn(turnOn);
    if (!turnOn && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const el = audio.current;
    if (!el || !fileUrl) return;
    if (turnOn) start(el);
    else el.pause();
  };
  return (
    <>
      {showYt && ytId && (
        <iframe
          key={`${pos.turn}:${ytId}`}
          ref={frame}
          title="nikoo.tv music"
          aria-hidden="true"
          tabIndex={-1}
          width={1}
          height={1}
          className="pointer-events-none absolute bottom-0 left-0 opacity-0"
          src={`https://www.youtube.com/embed/${ytId}?autoplay=1&playsinline=1&controls=0&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
          allow="autoplay; encrypted-media"
          onLoad={listen}
        />
      )}
      <div dir="ltr" className={`absolute ${place} z-20 flex items-center gap-2`}>
        <button type="button" onClick={toggle} aria-label={on ? "Sound off" : "Sound on"} className={SOUND_KEY_CLASS}>
          {on ? ((waiting && fileUrl) || (ytId && !tapped) ? "🔊 tap to hear" : "🔊") : "🔇"}
        </button>
        {label && <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1 text-[12px] font-bold text-white">nikoo.tv music</span>}
      </div>
    </>
  );
}

type Status = { tone: "ok" | "warn" | "bad"; text: string } | null;

/** «Sound» on the walk's edit page: one question — the file. */
export function SoundEditor({ walks, viewKey, change, setStatus }: {
  walks: Walks;
  viewKey: string | null;
  change: (w: Walks) => void;
  setStatus: (s: Status) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const scene = viewKey ? /^scenes\/([^/]+)\//.exec(viewKey)?.[1] ?? null : null;
  const current = walkOf(walks, viewKey)?.audio ?? null;

  if (!viewKey || !scene) {
    return <p className="text-white/70">A sound can be added only to a walk video from the bucket (?v=scenes/…).</p>;
  }

  async function upload(file: File | undefined) {
    if (!file || !scene || !viewKey) return;
    setBusy(true);
    setStatus({ tone: "ok", text: `Uploading «${file.name}»…` });
    try {
      const type = audioTypeOf(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
      if (!type) throw new Error("choose an .mp3 or .m4a sound (a .wav or a video will not do)");
      if (file.size > MAX_WALK_AUDIO_BYTES) {
        throw new Error(`the sound is ${(file.size / 1048576).toFixed(1)} MB — at most ${MAX_WALK_AUDIO_BYTES / 1048576} MB`);
      }
      const res = await fetch("/api/operator/splats", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
        body: JSON.stringify({ action: "walkAudio", scene, type, size: file.size }),
      });
      const s = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; key?: string; url?: string; headers?: Record<string, string> };
      if (res.status === 401) throw new Error("you are not signed in as operator on this site — sign in and try again");
      if (!res.ok || !s.ok || !s.key || !s.url) throw new Error(s.error || `HTTP ${res.status}`);
      // Straight to R2; if R2 refuses the browser, through our server.
      const direct = await fetch(s.url, { method: "PUT", headers: s.headers, body: file }).then((r) => r.ok).catch(() => false);
      if (!direct) {
        const r = await fetch(`/api/operator/splats/walk-audio?key=${encodeURIComponent(s.key)}`, {
          method: "PUT", headers: { "x-admin-token": readAdminToken(), "content-type": type }, body: file,
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      }
      change(setAudio(walks, viewKey, s.key)); // the editor saves it a second later, and says so
    } catch (e) {
      setStatus({ tone: "bad", text: `Not added: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[15px] font-bold">{current ? "This walk has its sound" : "Add a background sound?"}</div>
      <p className="text-white/70">
        Music or the store&apos;s own hum, as an .mp3 or .m4a. It loops while shoppers are on this walk, whichever way and
        however fast they walk; they can turn it off with 🔊. The video itself stays silent.
      </p>
      {current && <p className="break-all font-mono text-[11px] text-white/50">{current.split("/").pop()}</p>}
      <input ref={input} type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4" className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => input.current?.click()}
          className="flex-1 rounded-md bg-[#00B8C8] px-3 py-2 text-[14px] font-bold text-black disabled:opacity-40">
          {busy ? "Uploading…" : current ? "Choose another sound" : "Choose the sound file"}
        </button>
        {current && (
          <button disabled={busy} onClick={() => change(setAudio(walks, viewKey, null))}
            className="rounded-md border border-white/25 px-3 py-2 text-[13px] text-white/85 disabled:opacity-40">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
