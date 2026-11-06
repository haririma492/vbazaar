"use client";

/**
 * Sends the page's uncaught errors to `/api/client-error`, once each (2026-11-06: a crash on the owner's
 * browsers that could not be reproduced anywhere else). Reporting never throws and never repeats a message.
 */
import { useEffect } from "react";

const sent = new Set<string>();
export function reportClientError(kind: string, message: string, stack?: string) {
  const id = `${kind}:${message}`.slice(0, 300);
  if (!message || sent.has(id) || sent.size > 20) return;
  sent.add(id);
  try {
    const body = JSON.stringify({ kind, message, stack: stack ?? "", url: location.href });
    if (!navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* never */ }
}

export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError("error", e.message || String(e.error ?? ""), (e.error as Error | undefined)?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as Error | undefined;
      reportClientError("rejection", r?.message ?? String(e.reason ?? ""), r?.stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
