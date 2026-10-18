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

import { useEffect, useRef, useState } from "react";
import { MAX_WALK_AUDIO_BYTES, audioTypeOf } from "@/lib/splats/keys";
import { setAudio, walkOf, type Walks } from "@/lib/splats/walks";
import { readAdminToken } from "@/lib/admin/useAdminMode";

const MUTE_KEY = "walk-sound";

function readOn(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Whether the shopper has sound on (the 🔊 / 🔇 key): the walk's loop and the specials' voice. */
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

export function WalkSound({ audioKey, srcOf, specials = false }: {
  audioKey: string | null;
  srcOf: (key: string) => Promise<string | null>;
  /** The walk has items on special, which speak: the key is shown for them too. */
  specials?: boolean;
}) {
  const [on, setOn] = useState(true);
  const [waiting, setWaiting] = useState(false); // the browser wants a tap first
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => setOn(readOn()), []);

  // The walk's sound: a new walk (a door, the next aisle) swaps it.
  useEffect(() => {
    if (!audioKey) return;
    let gone = false;
    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.volume = 0.6;
    audio.current = el;
    void srcOf(audioKey).then((src) => {
      if (gone || !src) return;
      el.src = src;
      if (readOn()) start(el);
    });
    return () => {
      gone = true;
      el.pause();
      el.removeAttribute("src");
      el.load();
      if (audio.current === el) audio.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey, srcOf]);

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
      className="absolute right-3 top-3 z-20 rounded-full border border-white/30 bg-black/60 px-3 py-1.5 text-[15px] text-white"
    >
      {on ? (waiting && audioKey ? "🔊 tap to hear" : "🔊") : "🔇"}
    </button>
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
