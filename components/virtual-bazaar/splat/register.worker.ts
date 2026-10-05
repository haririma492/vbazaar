/**
 * Joining by the pictures, off the page's own thread: the fit
 * (`lib/splats/register.ts`) takes a few seconds, and the operator keeps
 * walking meanwhile — no pause.
 */
import { register, type Place } from "@/lib/splats/register";

self.onmessage = (e: MessageEvent<{ a: Float32Array; b: Float32Array; guess: Place; reach: number }>) => {
  const { a, b, guess, reach } = e.data;
  try {
    self.postMessage({ ok: true, fit: register(a, b, guess, reach) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message });
  }
};
