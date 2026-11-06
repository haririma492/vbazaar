"use client";

/**
 * INSTAGRAM, ON THE STORE'S PAGE (owner, 2026-11-06: the Instagram pathway, "lets do that for saraye-bamdad"). Three
 * things the store posts on Instagram, all leading into its walk on vbazaar.app:
 * 1. a vertical Reel cut from its walk (made here, downloaded, posted with Instagram's own music);
 * 2. the walk's link, for the bio and the Reel's caption;
 * 3. one link per product: it opens the walk facing that product with its card open (a Story's link sticker).
 * The third pathway, «Share to Story», is on the walk itself, for shoppers.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, QUIET, Said } from "./ui";

type Reel = { state: "making" | "done" | "failed"; made: string; error?: string; src: string | null; download: string | null; plan?: { seconds: number; products: number } } | null;
type Product = { n: number; name: string; fa: string | null; photo: string | null; link: string };
type Got = { reel: Reel; walkLink: string | null; products: Product[] };

export default function InstagramCard({ api, name }: { api: string; name: string }) {
  const [got, setGot] = useState<Got | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    try { setGot(await postJson<Got>(api, { action: "instagram" })); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  // While the Reel is being made, ask again every 5 s.
  useEffect(() => {
    if (got?.reel?.state !== "making") return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [got?.reel?.state, load]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setSaid({ ok: true, text: `✓ ${what} copied · کپی شد` }); }
    catch { setSaid({ ok: false, text: "Could not copy: select it and copy it by hand." }); }
  };
  const make = async () => {
    setSaid(null);
    try { await postJson(api, { action: "reelMake" }); setSaid({ ok: true, text: "Making the Reel… about a minute. · در حال ساخت" }); await load(); }
    catch (e) { setSaid({ ok: false, text: `Not started: ${(e as Error).message}` }); }
  };

  const caption = got?.walkLink ? `Walk into ${name} in the Virtual Bazaar 👣 Every product is one tap away.\nقدم بزنید در بازار مجازی 👣\nLink in bio · ${got.walkLink}` : "";
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (got?.products ?? []).filter((p) => !t || String(p.n) === t || p.name.toLowerCase().includes(t) || (p.fa ?? "").includes(q.trim()));
  }, [got, q]);
  const reel = got?.reel ?? null;

  return (
    <Card>
      <Bi fa="اینستاگرام: از پست تا قدم زدن در فروشگاه" en="Instagram: from a post to a walk in the store" className="text-[16px] font-bold" />
      <p dir="ltr" className="mt-1 text-left text-[13px] text-white/60">
        Instagram cannot hold the walk itself, so each post is a teaser and its link opens the walk on vbazaar.app.
        Shoppers can also share a picture of where they are in the walk to their own Story (the «Share» key on the walk).
      </p>

      {!got ? <p className="mt-3 text-white/50">…</p> : !got.walkLink ? <p className="mt-3 text-white/60">The walk is not made yet.</p> : (
        <div dir="ltr" className="mt-3 space-y-5 text-left">
          <section>
            <div className="text-[14px] font-bold text-amber-100">1 · The Reel (9:16, from inside the store)</div>
            <div className="mt-2 flex flex-wrap items-start gap-4">
              {reel?.src && reel.state === "done" ? (
                <video src={reel.src} controls playsInline muted loop className="aspect-[9/16] w-[180px] rounded-xl border border-white/10 bg-black object-cover" />
              ) : (
                <div className="flex aspect-[9/16] w-[180px] items-center justify-center rounded-xl border border-dashed border-white/15 p-3 text-center text-[12px] text-white/50">
                  {reel?.state === "making" ? "Being made…" : reel?.state === "failed" ? `Not made: ${reel.error ?? "?"}` : "No Reel yet"}
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-2 text-[13px] text-white/70">
                {reel?.state === "done" && reel.plan && <p>{Math.round(reel.plan.seconds)} s, looking at the shelf side with the most products ({reel.plan.products} lights in view), never toward the camera operator. No sound: add a track from Instagram&apos;s own music when posting.</p>}
                <div className="flex flex-wrap gap-2">
                  {reel?.download && reel.state === "done" && <a className={`${QUIET} inline-flex items-center`} href={reel.download}>⬇ Download the Reel</a>}
                  <button type="button" className={QUIET} disabled={reel?.state === "making"} onClick={() => void make()}>{reel?.state === "done" ? "Make it again" : "Make the Reel"}</button>
                </div>
                <textarea readOnly value={caption} rows={4} className="w-full rounded-lg bg-black/40 p-2 text-[12px] text-white/85" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className={QUIET} onClick={() => void copy(caption, "Caption")}>Copy the caption</button>
              </div>
            </div>
          </section>

          <section>
            <div className="text-[14px] font-bold text-amber-100">2 · The link for the bio</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-black/40 px-2 py-1 text-[12px] text-white/85">{got.walkLink}</code>
              <button type="button" className={QUIET} onClick={() => void copy(got.walkLink!, "Link")}>Copy</button>
            </div>
          </section>

          <section>
            <div className="text-[14px] font-bold text-amber-100">3 · A link to each product ({got.products.length})</div>
            <p className="mt-1 text-[12px] text-white/50">For a Story&apos;s link sticker, or a reply to a customer: it opens the walk facing that product, its card open with «Add to basket».</p>
            {got.products.length === 0 ? <p className="mt-2 text-[13px] text-white/60">No product has a light in the walk yet.</p> : (
              <>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product by name or number" className="mt-2 w-full max-w-sm rounded-lg bg-black/40 px-3 py-2 text-[13px] text-white" />
                <ul className="mt-2 max-h-[360px] space-y-1 overflow-y-auto pr-1">
                  {shown.slice(0, 200).map((p) => (
                    <li key={p.n} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-[13px]">
                      {p.photo ? <img src={p.photo} alt="" className="h-9 w-9 shrink-0 rounded object-cover" /> : <span className="h-9 w-9 shrink-0 rounded bg-white/10" />}
                      <span className="w-9 shrink-0 text-white/45">#{p.n}</span>
                      <span className="min-w-0 flex-1 truncate">{p.name}{p.fa && p.fa !== p.name ? <span dir="rtl" className="ms-2 text-white/50">{p.fa}</span> : null}</span>
                      <a href={p.link} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-sky-300 underline">Open</a>
                      <button type="button" className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/80" onClick={() => void copy(p.link, `Link to #${p.n}`)}>Copy link</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
      {said && <div className="mt-3"><Said ok={said.ok} text={said.text} /></div>}
    </Card>
  );
}
