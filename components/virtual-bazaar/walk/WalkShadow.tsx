"use client";

/**
 * «Shadow» on the walk's edit page: THE SHADOW AGENT (owner, 2026-11-03:
 * "lets call this agent 'The Shadow agent' and let to activate when during the
 * ?edit=1 the operator ask for it"). One question, then it works on its own
 * and says what it did: it finds the operator's reflection in shop windows,
 * glass doors and steel fridges and softens it (`lib/stores/reflect.ts`), at
 * most $0.30 a scene. «Undo» puts the walk back as it was.
 */

import { useEffect, useState } from "react";
import { readAdminToken } from "@/lib/admin/useAdminMode";

type Status = { key: string; state: "working" | "done" | "failed"; note: string; at: string } | null;
type Answer = { status?: Status; kept?: boolean; ceiling?: number; note?: string };

async function ask(body: Record<string, unknown>): Promise<Answer> {
  const res = await fetch("/api/operator/splats", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": readAdminToken() },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Answer & { ok?: boolean; error?: string };
  if (res.status === 401) throw new Error("you are not signed in as operator on this site — sign in and try again");
  if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

export function ShadowEditor({ viewKey }: { viewKey: string | null }) {
  const [status, setStatus] = useState<Status>(null);
  const [kept, setKept] = useState(false);
  const [error, setError] = useState("");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [note, setNote] = useState("");
  const key = viewKey && /^scenes\/[^/]+\/[^/]+\.mp4$/.test(viewKey) ? viewKey : null;

  // Ask after the agent while it works (it takes minutes: the video is made again).
  useEffect(() => {
    if (!key) return;
    let gone = false;
    const poll = async () => {
      try {
        const a = await ask({ action: "shadowStatus", key });
        if (gone) return;
        setStatus(a.status ?? null);
        setKept(Boolean(a.kept));
      } catch (e) {
        if (!gone) setError((e as Error).message);
      }
    };
    void poll();
    const id = window.setInterval(poll, 4000);
    return () => { gone = true; window.clearInterval(id); };
  }, [key]);

  if (!key) return <p className="text-white/70">The Shadow agent works on a 360° walk video from the bucket (?v=scenes/…).</p>;
  const working = status?.state === "working";

  async function start() {
    setError(""); setNote("");
    try { await ask({ action: "shadow", key }); setStatus({ key: key!, state: "working", note: "Starting…", at: new Date().toISOString() }); }
    catch (e) { setError((e as Error).message); }
  }
  async function undo() {
    setError(""); setConfirmUndo(false);
    try { const a = await ask({ action: "shadowUndo", key }); setNote(a.note ?? ""); setKept(false); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-2">
      <div className="text-[15px] font-bold">The Shadow agent</div>
      {working ? (
        <p className="rounded-md bg-white/10 p-2">⏳ {status!.note}<br /><span className="text-white/55">It keeps working if you close this page.</span></p>
      ) : confirmUndo ? (
        <>
          <p>Put this walk back as it was before the Shadow agent?</p>
          <div className="flex gap-2">
            <button className="flex-1 rounded-md bg-[#00B8C8] px-3 py-2 font-bold text-black" onClick={() => void undo()}>Yes, put it back</button>
            <button className="rounded-md border border-white/25 px-3 py-2" onClick={() => setConfirmUndo(false)}>← Back</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-white/75">
            Find your reflection (face, body, the camera over your head) in shop windows, glass doors and steel fridges along this walk, and soften it.
            At most $0.30. It takes a few minutes; the original is kept.
          </p>
          <button className="w-full rounded-md bg-[#00B8C8] px-3 py-2 text-[14px] font-bold text-black" onClick={() => void start()}>
            {kept ? "Run the Shadow agent again" : "Run the Shadow agent"}
          </button>
          {kept && <button className="w-full rounded-md border border-white/25 px-3 py-2 text-[13px]" onClick={() => setConfirmUndo(true)}>Undo: put the walk back as it was</button>}
        </>
      )}
      {status && status.state !== "working" && (
        <p className={`rounded-md p-2 ${status.state === "done" ? "bg-emerald-500/15 text-emerald-100" : "bg-red-500/15 text-red-100"}`}>
          {status.state === "done" ? "✓ " : "Not done: "}{status.note}
          {status.state === "done" && <><br /><button className="underline" onClick={() => window.location.reload()}>Reload to see it</button></>}
        </p>
      )}
      {note && <p className="rounded-md bg-white/10 p-2">✓ {note} <button className="underline" onClick={() => window.location.reload()}>Reload</button></p>}
      {error && <p className="rounded-md bg-red-500/15 p-2 text-red-100">Not done: {error}</p>}
    </div>
  );
}
