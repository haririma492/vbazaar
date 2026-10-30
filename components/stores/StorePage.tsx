"use client";

/**
 * `/stores/<slug>` — ONE STORE'S OWN PAGE (owner, 2026-10-30: "each store
 * will have a clear, very straightforward URL address, so the store owner can
 * examine, make comments, and also upload … the store page will be a
 * self-sufficient thing").
 *
 * Opened with the store's password (the owner) or the admin token (the
 * operator, already in this browser from /operator). On it: what the crew is
 * doing, the report, the walk to look at, the uploads (the video for the
 * operator only), the store's details, music for the walk, the message box
 * to the crew, and for the operator «Publish».
 */

import { useCallback, useEffect, useState } from "react";
import { STEPS, STEP_SAY, type StoreRecord } from "@/lib/stores/store";
import type { Product } from "@/lib/splats/catalogue";
import { formatCents } from "@/lib/splats/catalogue";
import { getJson, postJson, uploadInParts, uploadMusic } from "./upload";
import { UPLOAD_CARDS } from "./Intake";
import { Bi, Card, FIELD, FilePick, KEY, QUIET, Said, Steps, Thread } from "./ui";

type Page = {
  who: "owner" | "operator";
  store: Omit<StoreRecord, "passwordHash">;
  status: { en: string; fa: string; tone: string };
  products: Product[];
  walkUrl: string | null;
};

const TONE: Record<string, string> = { work: "text-amber-200", you: "text-rose-200", ready: "text-emerald-200", live: "text-emerald-300" };

function SignIn({ slug, done }: { slug: string; done: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await postJson(`/api/stores/${slug}/login`, { password: pw });
          done();
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        <Bi fa="رمز فروشگاه" en="The store's password" className="text-[18px] font-bold text-amber-100" />
        <input type="password" autoFocus autoComplete="current-password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} className={`${FIELD} mt-3`} />
        <Said text={err} />
        <button type="submit" disabled={busy || !pw.trim()} className={`${KEY} mt-3 w-full`}>ورود · Sign in</button>
      </form>
    </Card>
  );
}

const DETAILS: Array<{ field: string; fa: string; en: string; get: (s: Page["store"]) => string }> = [
  { field: "nameEn", fa: "نام (انگلیسی)", en: "Name (English)", get: (s) => s.name.en },
  { field: "nameFa", fa: "نام (فارسی)", en: "Name (Farsi)", get: (s) => s.name.fa },
  { field: "category", fa: "نوع فروشگاه", en: "Kind of store", get: (s) => s.category },
  { field: "contact", fa: "فرد تماس", en: "Contact person", get: (s) => s.contact },
  { field: "phone", fa: "تلفن", en: "Phone", get: (s) => s.phone },
  { field: "email", fa: "ایمیل", en: "Email", get: (s) => s.email },
  { field: "address", fa: "نشانی", en: "Address", get: (s) => s.address },
  { field: "hours", fa: "ساعت کار", en: "Opening hours", get: (s) => s.hours },
  { field: "website", fa: "وبسایت", en: "Website", get: (s) => s.website ?? "" },
];

function Details({ page, save }: { page: Page; save: (edits: Record<string, string>) => Promise<void> }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div>
      <Bi fa="مشخصات فروشگاه" en="The store's details" className="text-[15px] font-bold text-amber-100" />
      <dl className="mt-3 space-y-2">
        {DETAILS.map((d) => (
          <div key={d.field} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt className="w-36 shrink-0 text-[12px] text-white/50">{d.fa} · {d.en}</dt>
            {edit === d.field ? (
              <dd className="flex min-w-0 flex-1 flex-wrap gap-2">
                <input autoFocus dir="auto" value={value} onChange={(e) => setValue(e.target.value)} className={`${FIELD} min-w-0 flex-1`} />
                <button type="button" className={KEY} onClick={async () => {
                  try { await save({ [d.field]: value }); setEdit(null); setSaid({ ok: true, text: "✓ Saved · ذخیره شد" }); }
                  catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
                }}>ذخیره · Save</button>
                <button type="button" className={QUIET} onClick={() => setEdit(null)}>انصراف · Cancel</button>
              </dd>
            ) : (
              <dd className="flex min-w-0 flex-1 items-baseline gap-2">
                <span dir="auto" className="min-w-0 break-words text-[14px]">{d.get(page.store) || "—"}</span>
                <button type="button" className="text-[12px] text-amber-200/80 underline" onClick={() => { setEdit(d.field); setValue(d.get(page.store)); setSaid(null); }}>تغییر · change</button>
              </dd>
            )}
          </div>
        ))}
      </dl>
      {said && <Said ok={said.ok} text={said.text} />}
    </div>
  );
}

export default function StorePage({ slug }: { slug: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [state, setState] = useState<"loading" | "out" | "in" | "missing" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const api = `/api/stores/${slug}`;

  const load = useCallback(async () => {
    try {
      setPage(await getJson<Page>(api));
      setState("in");
      setErr(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) setState("out");
      else if (status === 404) setState("missing");
      else {
        setErr((e as Error).message);
        // A first load that failed says why; a later one keeps the page and shows the error on it.
        setState((was) => (was === "loading" ? "error" : was));
      }
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);
  // While the crew works, the page follows it.
  useEffect(() => {
    if (state !== "in") return;
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [state, load]);

  if (state === "loading") return <p className="p-6 text-center text-white/50">…</p>;
  if (state === "error") return <Card className="mt-10"><Bi fa="صفحه باز نشد." en="The page could not be opened." /><Said text={err} /></Card>;
  if (state === "missing") return <Card className="mt-10"><Bi fa="فروشگاهی با این نشانی نیست." en="There is no store at this address." /></Card>;
  if (state === "out") return <SignIn slug={slug} done={() => void load()} />;
  if (!page) return <Said text={err} />;

  const s = page.store;
  const op = page.who === "operator";
  const act = async (body: object) => {
    await postJson(api, body);
    await load();
  };
  return (
    <div className="space-y-4">
      <header>
        <h1 className="sk-font text-2xl font-bold text-amber-200">{s.name.fa || s.name.en}</h1>
        <p dir="ltr" className="text-left text-[14px] text-white/60">{s.name.en} · vbazaar.app/stores/{s.slug}</p>
        <p className={`mt-2 text-[15px] font-bold ${TONE[page.status.tone] ?? ""}`}>{page.status.fa} · {page.status.en}</p>
        {err && <Said text={err} />}
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {page.walkUrl ? <a href={page.walkUrl} target="_blank" rel="noreferrer" className={KEY + " inline-flex items-center"}>قدم زدن در فروشگاه · Walk the store ↗</a>
            : <p className="text-[13px] text-white/55">The walk appears here once the Video agent has made it. · پس از آماده شدن ویدیو</p>}
          {op && page.walkUrl && <a href={`${page.walkUrl}&edit=1`} target="_blank" rel="noreferrer" className={QUIET + " inline-flex items-center"}>Edit tags by hand ↗</a>}
          {op && !s.live && page.walkUrl && (
            <button type="button" className={KEY} onClick={() => void act({ action: "publish" })}>انتشار در بازار · Publish</button>
          )}
          {op && s.live && <button type="button" className={QUIET} onClick={() => void act({ action: "unpublish" })}>برداشتن از بازار · Unpublish</button>}
        </div>
        <p dir="ltr" className="mt-3 text-left text-[12px] text-white/45">AI spent on this store: ${(s.spentCents / 100).toFixed(2)} of $5.00</p>
      </Card>

      <Card>
        <Bi fa="کار تیم ساخت" en="What the crew is doing" className="mb-3 text-[15px] font-bold text-amber-100" />
        <Steps steps={STEPS.map((n) => [n, s.steps[n]])} say={STEP_SAY} />
        {op && (
          <div className="mt-3 flex flex-wrap gap-2">
            {STEPS.filter((n) => s.steps[n].state === "failed" || s.steps[n].state === "needs-you" || s.steps[n].state === "done").slice(0, 6).map((n) => (
              <button key={n} type="button" className="text-[12px] text-amber-200/80 underline" onClick={() => void act({ action: "redo", step: n })}>Run «{n}» again</button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <Thread
          entries={s.thread}
          hint={op ? "e.g. «price of #112 is $8.99» · «cut 1:20 to 1:45 out» · «tag on saffron is on the wrong jar»" : "مثلاً: «قیمت شماره ۱۱۲ را ۸٫۹۹ دلار کنید» · «price of #112 is $8.99»"}
          send={async (text) => { await act({ action: "message", text }); }}
        />
      </Card>

      {s.report && (
        <Card>
          <Bi fa="گزارش" en={`The report — ${new Date(s.report.at).toLocaleString()}`} className="text-[15px] font-bold text-amber-100" />
          <ul dir="ltr" className="mt-3 space-y-1 text-left text-[14px]">
            <li>{s.report.products} products · {s.report.tagged} price tags pinned · {s.report.photosMatched} photos joined</li>
            {s.report.photosUnmatched.length > 0 && <li className="text-rose-200">Photos not placed: {s.report.photosUnmatched.join(", ")}</li>}
            {s.report.problems.map((p, i) => <li key={i} className="text-amber-200">• {p}</li>)}
          </ul>
        </Card>
      )}

      <Card className="space-y-6">
        {UPLOAD_CARDS.filter((c) => op || c.kind !== "video").map((c) => (
          <FilePick
            key={c.kind}
            fa={c.fa} en={c.en} hint={c.hint} accept={c.accept} multiple={"multiple" in c && c.multiple}
            current={c.kind === "photo" ? (s.files.photos.length ? `${s.files.photos.length} photos` : null) : s.files[c.kind as "video" | "sheet" | "door"]?.name ?? null}
            send={async (file, onProgress) => { await uploadInParts(api, { action: "upload", kind: c.kind }, file, onProgress); await load(); }}
          />
        ))}
        {page.walkUrl && (
          <FilePick
            fa="موسیقی پس‌زمینه فروشگاه" en="Background music for the store's walk (.mp3 / .m4a)" accept=".mp3,.m4a,audio/mpeg,audio/mp4"
            hint="Only music you have the right to use. It loops while shoppers are in the store; «stop the music» in the message box turns it off."
            send={async (file) => { await uploadMusic(api, {}, file); await load(); }}
          />
        )}
      </Card>

      {page.products.length > 0 && (
        <Card>
          <Bi fa="فهرست محصولات" en={`The product list — ${page.products.length}`} className="text-[15px] font-bold text-amber-100" />
          <ul className="mt-3 max-h-[420px] divide-y divide-white/10 overflow-y-auto">
            {page.products.map((p) => (
              <li key={p.n} className="flex items-center gap-3 py-2">
                {p.photo ? <img src={p.photo} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <span className="h-12 w-12 shrink-0 rounded-lg bg-white/5" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">#{p.n} · {p.fa || p.en}</span>
                  <span dir="ltr" className="block truncate text-left text-[12px] text-white/50">{p.en}{p.sku ? ` · ${p.sku}` : ""}</span>
                </span>
                <span dir="ltr" className="shrink-0 text-[14px]">{p.priceCents === null ? "—" : formatCents(p.priceCents)}</span>
                {s.out.notFound?.includes(p.n) && <span className="shrink-0 text-[11px] text-rose-200">not in video</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card><Details page={page} save={async (edits) => { await act({ action: "edit", edits }); }} /></Card>

      <Card>
        <ChangePassword api={api} />
        {!op && <button type="button" className={`${QUIET} mt-4`} onClick={async () => { await fetch(`${api}/login`, { method: "DELETE" }); setState("out"); }}>خروج · Sign out</button>}
      </Card>
    </div>
  );
}

function ChangePassword({ api }: { api: string }) {
  const [pw, setPw] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      try { await postJson(api, { action: "password", password: pw }); setPw(""); setSaid({ ok: true, text: "✓ The new password is set · رمز جدید ذخیره شد" }); }
      catch (x) { setSaid({ ok: false, text: (x as Error).message }); }
    }}>
      <Bi fa="رمز جدید" en="A new password for the store" className="text-[14px] font-bold" />
      <div className="mt-2 flex gap-2">
        <input dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} className={`${FIELD} min-w-0 flex-1`} />
        <button type="submit" disabled={pw.trim().length < 6} className={QUIET}>ذخیره · Save</button>
      </div>
      {said && <Said ok={said.ok} text={said.text} />}
    </form>
  );
}
