"use client";

/**
 * AAA — ADMIN MODE FOR THE WHOLE PAGE, ONE SWITCH SHARED BY EVERY COMPONENT ON IT.
 *
 * Three presses of "a" within 1.2 s (outside a text field) arm it; three more
 * disarm it. Arming needs the admin token: the one already in this browser
 * (`operator_admin_token`, or the parent project's `olgoo_admin_token`), or one
 * typed into the prompt that appears when there is none. The token is checked
 * against the server (`/api/operator/check`) before anything is shown, and a
 * refused one is forgotten.
 *
 * ⚠️ ONE KEY LISTENER FOR THE PAGE, NOT ONE PER COMPONENT. The shop list, the
 * flyer and the order page can all be on one page; a listener each would toggle
 * the switch once per component on a single AAA and leave it wherever the
 * count happened to end.
 *
 * ⚠️ WHAT IT SHOWS IS A CONVENIENCE, NOT A SECRET. The shops' websites it
 * reveals are public; anything that writes (an order's tools) is checked again
 * by its own route with the same token.
 */

import { useEffect, useState } from "react";

const TRIGGER_KEY = "a";
const TRIGGER_COUNT = 3;
const TRIGGER_WINDOW_MS = 1200;
const TOKEN_KEYS = ["operator_admin_token", "olgoo_admin_token"];

export function readAdminToken(): string {
  if (typeof window === "undefined") return "";
  for (const key of TOKEN_KEYS) {
    try {
      const v = window.localStorage.getItem(key)?.trim();
      if (v) return v;
    } catch {
      /* private mode - fall through */
    }
  }
  return "";
}

function forgetAdminToken() {
  for (const key of TOKEN_KEYS) {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

let armed = false;
let installed = false;
let presses: number[] = [];
const subscribers = new Set<(on: boolean) => void>();

function publish(on: boolean) {
  armed = on;
  subscribers.forEach((fn) => fn(on));
}

async function tokenWorks(token: string): Promise<boolean> {
  try {
    const res = await fetch("/api/operator/check", { headers: { "x-admin-token": token }, cache: "no-store" });
    return res.status === 204;
  } catch {
    return false;
  }
}

async function toggle() {
  if (armed) {
    publish(false);
    return;
  }
  let token = readAdminToken();
  if (!token) {
    token = (window.prompt("Admin token") || "").trim();
    if (!token) return;
  }
  if (!(await tokenWorks(token))) {
    forgetAdminToken();
    window.alert("That admin token was refused.");
    return;
  }
  try { window.localStorage.setItem(TOKEN_KEYS[0], token); } catch { /* ignore */ }
  publish(true);
}

/**
 * Arm admin mode WITHOUT AAA — for a phone, which has no keyboard to type it
 * on. Uses `typed` if given, else the token already in this browser. The token
 * is checked by the server first; a refused one is forgotten. Resolves to
 * whether admin mode is now on.
 */
export async function armAdminMode(typed?: string): Promise<boolean> {
  if (armed) return true;
  const token = (typed ?? readAdminToken()).trim();
  if (!token) return false;
  if (!(await tokenWorks(token))) {
    if (!typed) forgetAdminToken();
    return false;
  }
  try { window.localStorage.setItem(TOKEN_KEYS[0], token); } catch { /* ignore */ }
  publish(true);
  return true;
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() !== TRIGGER_KEY) {
      presses = [];
      return;
    }
    const now = Date.now();
    presses = [...presses, now].filter((t) => now - t <= TRIGGER_WINDOW_MS);
    if (presses.length < TRIGGER_COUNT) return;
    presses = [];
    void toggle();
  });
}

/** Is admin mode on? `enabled: false` (a preview) never arms and never listens. */
export function useAdminMode(enabled = true): boolean {
  const [on, setOn] = useState(armed);
  useEffect(() => {
    if (!enabled) return;
    install();
    subscribers.add(setOn);
    setOn(armed);
    return () => { subscribers.delete(setOn); };
  }, [enabled]);
  return enabled && on;
}
