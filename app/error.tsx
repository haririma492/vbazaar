"use client";

/**
 * When a page crashes: what went wrong, said on the screen and sent to the operator (`/api/client-error`),
 * instead of Next's bare "Application error" (2026-11-06).
 */
import { useEffect } from "react";
import { reportClientError } from "@/components/common/ErrorReporter";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError("render", error.message || "(no message)", `${error.stack ?? ""}${error.digest ? `\ndigest ${error.digest}` : ""}`); }, [error]);
  return (
    <div dir="ltr" className="mx-auto max-w-xl p-6 text-left text-white">
      <h1 className="text-[20px] font-bold">Something went wrong on this page · مشکلی پیش آمد</h1>
      <p className="mt-3 text-[14px] text-white/80">It has been reported. Try again; if it keeps happening, the message below helps:</p>
      <pre className="mt-3 whitespace-pre-wrap break-words rounded bg-black/50 p-3 text-[12px] text-amber-200">{error.message}</pre>
      <button type="button" onClick={reset} className="mt-4 rounded-full bg-[#00B8C8] px-5 py-2 font-bold text-black">Try again · دوباره</button>
    </div>
  );
}
