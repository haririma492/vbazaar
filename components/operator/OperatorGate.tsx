"use client";

/**
 * `/operator`'s door: the admin token, checked by the server before anything
 * is drawn. The same token keys AAA uses (`useAdminMode`), so a browser signed
 * in here is signed in for AAA too, and the other way round.
 *
 * ⚠️ THE GATE IS A CONVENIENCE, NOT THE LOCK. Every route the tools call checks
 * `x-admin-token` itself.
 */

import { useEffect, useState } from "react";
import { armAdminMode, readAdminToken } from "@/lib/admin/useAdminMode";

const FIELD = "sk-field w-full rounded-lg bg-black/30 px-3 py-2 text-[14px] text-[--sk-ink] placeholder:text-white/30 outline-none";
const KEY = "min-h-[40px] rounded-full border border-amber-300/50 bg-amber-300/15 px-4 text-sm font-bold text-amber-100 disabled:opacity-40";

export default function OperatorGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "out" | "in">("checking");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!readAdminToken()) {
      setState("out");
      return;
    }
    void armAdminMode().then((ok) => setState(ok ? "in" : "out"));
  }, []);

  if (state === "in") return <>{children}</>;
  if (state === "checking") return <p className="p-6 text-center text-white/50">…</p>;

  return (
    <form
      className="mx-auto mt-16 max-w-sm px-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const ok = await armAdminMode(typed);
        if (ok) setState("in");
        else setError("That admin token was refused.");
      }}
    >
      <h1 className="sk-font mb-1 text-xl font-bold text-amber-200">ورود اپراتور</h1>
      <p dir="ltr" className="mb-4 text-left text-[12px] text-white/45">Operator sign-in</p>
      <input
        type="password"
        autoComplete="current-password"
        dir="ltr"
        placeholder="Admin token"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className={FIELD}
      />
      {error && <p className="mt-2 text-[13px] text-rose-300">{error}</p>}
      <button type="submit" disabled={!typed.trim()} className={`${KEY} mt-3 w-full`}>
        ورود · Sign in
      </button>
    </form>
  );
}
