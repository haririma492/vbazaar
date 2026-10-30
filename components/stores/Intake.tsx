"use client";

/**
 * `/stores/new` — A NEW STORE, ONE QUESTION AT A TIME (owner, 2026-10-30:
 * "You need to ask me in a canvas, what's the name of the store? What's the
 * contact person? What's the phone number? What is the real address? … the
 * link to upload the spreadsheet … and the file explorer to upload the
 * Insta360 file").
 *
 * The questions of `INTAKE_QUESTIONS`, each on its own card with «← Back»
 * (and «Skip» where it may be left out), checked as typed; then the store is
 * made, and the uploads follow, one card each: the 360° walk, the product
 * workbook, the product photos, the door photo. The crew starts on each file
 * as soon as it is in.
 */

import { useState } from "react";
import { INTAKE_QUESTIONS, checkAnswer, slugOf, type Intake as Answers } from "@/lib/stores/store";
import { postJson, uploadInParts } from "./upload";
import { Bi, Card, FIELD, FilePick, KEY, QUIET, Said } from "./ui";

const EMPTY: Answers = { nameEn: "", nameFa: "", category: "", contact: "", phone: "", email: "", address: "", hours: "", website: "", password: "" };

export const UPLOAD_CARDS = [
  { kind: "video", fa: "ویدیوی ۳۶۰ درجه فروشگاه (Insta360)", en: "The store's 360° walk (Insta360)", accept: ".mp4,.insv,video/mp4",
    hint: "Start filming outside, at the store's real door, then walk in slowly. Export from Insta360 Studio: 360 Video, 8K, maximum bitrate, H.265, Anti-Flicker on (.mp4).", skip: false },
  { kind: "sheet", fa: "فهرست محصولات (اکسل)", en: "The product workbook (.xlsx)", accept: ".xlsx",
    hint: "Product number, title_en, title_fa, unit, unit price — photos may be in it (placed on a product's row, or on a second sheet of product number → photo).", skip: false },
  { kind: "photo", fa: "عکس محصولات (اختیاری)", en: "Product photos (optional)", accept: "image/jpeg,image/png,image/webp", multiple: true,
    hint: "Name each file by its product number (112.jpg) if you can; the crew looks at the rest to find which product it is.", skip: true },
  { kind: "door", fa: "عکس درِ واقعی فروشگاه", en: "A photo of the store's real door", accept: "image/jpeg,image/png,image/webp",
    hint: "Straight on, the whole door and its sign. It is the door shoppers see on the hallway.", skip: true },
] as const;

export default function Intake() {
  const [a, setA] = useState<Answers>(EMPTY);
  const [i, setI] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [u, setU] = useState(0);

  if (slug) {
    const card = UPLOAD_CARDS[u];
    if (!card) {
      return (
        <Card>
          <Bi fa="همه فایل‌ها رسید. تیم ساخت کار را شروع کرده است." en="All files are in. The crew has started." className="text-[18px] font-bold text-emerald-200" />
          <p dir="ltr" className="mt-2 text-left text-[13px] text-white/60">The store's page shows each agent's progress, and the owner opens it with the store's password.</p>
          <a href={`/stores/${slug}`} className={`${KEY} mt-4 inline-flex items-center`}>صفحه فروشگاه · Open the store's page</a>
        </Card>
      );
    }
    return (
      <Card>
        <p className="mb-3 text-[12px] text-white/45">{u + 1} / {UPLOAD_CARDS.length}</p>
        <FilePick
          key={card.kind}
          fa={card.fa} en={card.en} hint={card.hint} accept={card.accept} multiple={"multiple" in card && card.multiple}
          send={(file, onProgress) => uploadInParts(`/api/stores/${slug}`, { action: "upload", kind: card.kind }, file, onProgress)}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {u > 0 && <button type="button" className={QUIET} onClick={() => setU(u - 1)}>← قبلی · Back</button>}
          <button type="button" className={QUIET} onClick={() => setU(u + 1)}>{card.skip ? "رد شدن · Skip / Next →" : "بعدی · Next →"}</button>
        </div>
      </Card>
    );
  }

  const q = INTAKE_QUESTIONS[i];
  const last = i === INTAKE_QUESTIONS.length - 1;
  const value = a[q.field];
  const problem = value.trim() ? checkAnswer(q.field, value) : null;
  const next = async () => {
    const p = checkAnswer(q.field, value);
    if (p) { setErr(p); return; }
    setErr(null);
    if (!last) { setI(i + 1); return; }
    setBusy(true);
    try {
      const out = await postJson<{ slug: string }>("/api/stores", { intake: a });
      setSlug(out.slug);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <p className="mb-3 text-[12px] text-white/45">{i + 1} / {INTAKE_QUESTIONS.length}</p>
      <form onSubmit={(e) => { e.preventDefault(); void next(); }}>
        <label>
          <Bi fa={q.say.fa} en={q.say.en} className="text-[18px] font-bold text-amber-100" />
          <input
            autoFocus
            key={q.field}
            type={q.field === "password" ? "text" : q.field === "email" ? "email" : q.field === "phone" ? "tel" : "text"}
            dir={q.field === "nameFa" ? "rtl" : "ltr"}
            value={value}
            placeholder={q.hint ?? ""}
            onChange={(e) => setA({ ...a, [q.field]: e.target.value })}
            className={`${FIELD} mt-3`}
          />
        </label>
        {q.field === "nameEn" && value.trim() && slugOf(value) && (
          <p dir="ltr" className="mt-2 text-left text-[12px] text-white/50">The store's page: vbazaar.app/stores/{slugOf(value)}</p>
        )}
        {q.field === "password" && <p dir="ltr" className="mt-2 text-left text-[12px] text-white/50">Give this to the owner: it opens the store's page, and nothing else.</p>}
        <Said text={err ?? problem} />
        <div className="mt-4 flex flex-wrap gap-2">
          {i > 0 && <button type="button" className={QUIET} onClick={() => { setErr(null); setI(i - 1); }}>← قبلی · Back</button>}
          {q.optional && !value.trim() && <button type="button" className={QUIET} onClick={() => { setErr(null); setI(i + 1); }}>رد شدن · Skip</button>}
          <button type="submit" disabled={busy} className={KEY}>{busy ? "…" : last ? "ساخت فروشگاه · Create the store" : "بعدی · Next →"}</button>
        </div>
      </form>
    </Card>
  );
}
