/**
 * A STORE IN THE BAZAAR (owner, 2026-10-30: "every new registered store …
 * the agents ask me, what is the 3D movie … the spreadsheet … the photos …
 * figure out on their own which photo belongs to which product … put labels
 * on all the products"). The Store Builder crew's record of one store.
 *
 *   intake       the operator answers one question per card (`/stores/new`):
 *                names, category, contact, phone, email, address, hours,
 *                website, the store's password, then the uploads
 *   uploads      the Insta360 360° walk (.mp4 exported from Insta360 Studio;
 *                an .insv is refused with what to do), the product workbook,
 *                product photos, and a photo of the store's real door
 *   the crew     video → catalogue → photos → tag → place → check
 *                (`STEPS`), each step's progress kept here, so a restart
 *                carries on where it stopped (`nextStep`)
 *   the page     `/stores/<slug>`, opened with the store's password (the owner)
 *                or the admin token (the operator); a message box there
 *                reaches the crew (`ThreadEntry`)
 *
 * A new store waits for the operator's «Publish»; later changes (a price, a
 * photo, a moved tag) go live by themselves.
 *
 * Stored privately, `stores/<slug>/store.json` in the masters bucket
 * (`storeKey`). Pure: imports nothing, so `node --test` runs it.
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const storeKey = (slug: string) => `stores/${slug}/store.json`;
/** The scene (and product list) the store's walk is under: `store-<slug>`. */
export const sceneOf = (slug: string) => `store-${slug}`;
export const STORES_INDEX_KEY = "stores/index.json";

/** AI spending per store, in cents (owner, 2026-10-30: "we will pay that $1 to $5 per store"). */
export const BUDGET_CENTS = 500;
/** A failing step is tried this many times, then it waits for a person. */
export const MAX_TRIES = 3;

export type Bi = { en: string; fa: string };

export type UploadKind = "video" | "sheet" | "photo" | "door";
export type Uploaded = { key: string; name: string; size: number; at: string };

export type StepName = "video" | "catalogue" | "photos" | "tag" | "place" | "check";
export const STEPS: StepName[] = ["video", "catalogue", "photos", "tag", "place", "check"];
export type StepState = "todo" | "working" | "done" | "failed" | "needs-you";
export type Step = { state: StepState; tries: number; note: string; at: string | null };

/** What each agent is called on the page. */
export const STEP_SAY: Record<StepName, Bi> = {
  video: { en: "Video agent — web and phone copies", fa: "ویدیو — نسخه وب و موبایل" },
  catalogue: { en: "Catalogue agent — the product list", fa: "فهرست محصولات" },
  photos: { en: "Photo matcher — each photo to its product", fa: "تطبیق عکس‌ها با محصولات" },
  tag: { en: "Tagger — price tags on the products in the video", fa: "برچسب قیمت روی محصولات" },
  place: { en: "Placer — the store's door on the hallway", fa: "درِ فروشگاه در راهرو" },
  check: { en: "Checker — the report", fa: "بررسی و گزارش" },
};

/** The steps each one waits for. */
export const NEEDS: Record<StepName, StepName[]> = {
  video: [],
  catalogue: [],
  photos: ["catalogue"],
  tag: ["video", "photos"],
  place: ["video"],
  check: ["video", "catalogue", "photos", "tag", "place"],
};

/** A new upload of this kind sends these steps back to do (and nothing else). */
export const REDO: Record<UploadKind, StepName[]> = {
  video: ["video", "tag", "place", "check"],
  sheet: ["catalogue", "photos", "tag", "check"],
  photo: ["photos", "tag", "check"],
  door: ["place", "check"],
};

export type ThreadEntry = {
  at: string;
  from: "owner" | "operator" | "crew";
  text: string;
  /** A message to the crew not yet answered. */
  open?: boolean;
};

export type Report = {
  at: string;
  products: number;
  photosMatched: number;
  photosUnmatched: string[];
  tagged: number;
  notFound: number[];
  walk: string | null;
  phone: boolean;
  problems: string[];
};

export type StoreRecord = {
  slug: string;
  name: Bi;
  category: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
  website?: string;
  /** scrypt, `scrypt$<salt>$<hash>` (`lib/stores/auth.ts`). */
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  files: { video?: Uploaded; sheet?: Uploaded; photos: Uploaded[]; door?: Uploaded };
  steps: Record<StepName, Step>;
  /** What the crew made. */
  out: {
    /** The store's walk, `scenes/store-<slug>/walk-<stamp>.mp4` (its phone copy beside it). */
    walk?: string;
    /** The door photo shoppers see on the hallway (public, web bucket). */
    doorImage?: string;
    /** The hallway spot the door is in (`bazaar.ts`). */
    spot?: string;
    /** The Photo matcher's result: photos joined to a product, and the files it could not place. */
    matched?: number;
    unmatched?: string[];
    /** The Tagger's result: tags pinned, and the list's products it did not find in the video. */
    tagged?: number;
    notFound?: number[];
  };
  spentCents: number;
  /** Shoppers see it once the operator presses «Publish». */
  live: boolean;
  thread: ThreadEntry[];
  report?: Report;
};

/** The questions the intake asks, in order (one card each). */
export type Intake = {
  nameEn: string;
  nameFa: string;
  category: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
  website: string;
  password: string;
};

export const INTAKE_QUESTIONS: Array<{ field: keyof Intake; say: Bi; optional?: boolean; hint?: string }> = [
  { field: "nameEn", say: { fa: "نام فروشگاه به انگلیسی؟", en: "The store's name in English?" }, hint: "Ali's Market" },
  { field: "nameFa", say: { fa: "نام فروشگاه به فارسی؟", en: "The store's name in Farsi?" }, hint: "سوپرمارکت علی" },
  { field: "category", say: { fa: "چه نوع فروشگاهی است؟", en: "What kind of store is it?" }, hint: "Grocery · Dry nuts · Clothing" },
  { field: "contact", say: { fa: "نام فرد تماس؟", en: "The contact person's name?" } },
  { field: "phone", say: { fa: "شماره تلفن؟", en: "Phone number?" }, hint: "+1 416 …" },
  { field: "email", say: { fa: "ایمیل؟", en: "Email?" }, optional: true },
  { field: "address", say: { fa: "نشانی واقعی فروشگاه؟", en: "The store's real address?" }, hint: "238 Doris Ave, North York, ON" },
  { field: "hours", say: { fa: "ساعت کار؟", en: "Opening hours?" }, optional: true, hint: "Mon–Sat 9–9, Sun 10–6" },
  { field: "website", say: { fa: "وبسایت یا اینستاگرام؟", en: "Website or Instagram?" }, optional: true, hint: "https://…" },
  { field: "password", say: { fa: "رمز فروشگاه؟ (صاحب فروشگاه با آن وارد می‌شود)", en: "The store's password? (the owner signs in with it)" } },
];

export const MIN_PASSWORD = 6;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** «Ali's Market» → `alis-market` (at most 34 long: its walk is the scene `store-<slug>`). Empty when nothing usable is left. */
export function slugOf(name: string): string {
  const s = name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34).replace(/-+$/, "");
  return SLUG_RE.test(s) ? s : "";
}

/** One answer checked as it is typed: null when fine, else what is wrong (English, then Farsi). */
export function checkAnswer(field: keyof Intake, raw: string): string | null {
  const v = raw.trim();
  const q = INTAKE_QUESTIONS.find((x) => x.field === field);
  if (!v) return q?.optional ? null : "This one is needed · این لازم است";
  if (field === "nameEn" && !slugOf(v)) return "Use English letters or digits · با حروف انگلیسی";
  if (field === "phone" && v.replace(/\D/g, "").length < 7) return "Not a phone number · شماره تلفن نیست";
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Not an email address · ایمیل درست نیست";
  if (field === "website" && !/^https:\/\/[^\s]+\.[^\s]+$/.test(v) && !/^@?[A-Za-z0-9._]{2,30}$/.test(v)) return "An https:// address or an @instagram name · نشانی https:// یا نام اینستاگرام";
  if (field === "password" && v.length < MIN_PASSWORD) return `At least ${MIN_PASSWORD} characters · دست‌کم ${MIN_PASSWORD} حرف`;
  return null;
}

/** The whole intake checked: the problems, each naming its question. */
export function checkIntake(i: Partial<Intake>): string[] {
  const out: string[] = [];
  for (const q of INTAKE_QUESTIONS) {
    const p = checkAnswer(q.field, typeof i[q.field] === "string" ? (i[q.field] as string) : "");
    if (p) out.push(`${q.say.en} ${p}`);
  }
  return out;
}

/** An @name becomes its Instagram address. */
export function websiteOf(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (v.startsWith("https://")) return v;
  return `https://www.instagram.com/${v.replace(/^@/, "")}/`;
}

const freshSteps = (): Record<StepName, Step> =>
  Object.fromEntries(STEPS.map((s) => [s, { state: "todo", tries: 0, note: "", at: null }])) as Record<StepName, Step>;

export function newStore(slug: string, i: Intake, passwordHash: string, now: Date): StoreRecord {
  const at = now.toISOString();
  return {
    slug,
    name: { en: clean(i.nameEn, 80), fa: clean(i.nameFa, 80) },
    category: clean(i.category, 80),
    contact: clean(i.contact, 80),
    phone: clean(i.phone, 40),
    email: clean(i.email, 120),
    address: clean(i.address, 200),
    hours: clean(i.hours, 120),
    website: websiteOf(i.website),
    passwordHash,
    createdAt: at,
    updatedAt: at,
    files: { photos: [] },
    steps: freshSteps(),
    out: {},
    spentCents: 0,
    live: false,
    thread: [],
  };
}

/** The details the owner or operator may change on the store's page. */
export const EDITABLE = ["nameEn", "nameFa", "category", "contact", "phone", "email", "address", "hours", "website"] as const;
export type Editable = (typeof EDITABLE)[number];

export function applyEdits(s: StoreRecord, edits: Partial<Record<Editable, string>>): { store: StoreRecord; problems: string[] } {
  const problems: string[] = [];
  const next: StoreRecord = { ...s, name: { ...s.name } };
  for (const f of EDITABLE) {
    const v = edits[f];
    if (typeof v !== "string") continue;
    const p = checkAnswer(f, v);
    if (p) { problems.push(`${f}: ${p}`); continue; }
    if (f === "nameEn") next.name.en = clean(v, 80);
    else if (f === "nameFa") next.name.fa = clean(v, 80);
    else if (f === "website") next.website = websiteOf(v);
    else next[f] = clean(v, f === "address" ? 200 : f === "email" ? 120 : 80);
  }
  return { store: next, problems };
}

/** Whether the inputs a step works from are there. */
export function hasInputs(s: StoreRecord, step: StepName): boolean {
  if (step === "video") return Boolean(s.files.video);
  if (step === "catalogue") return Boolean(s.files.sheet);
  return true;
}

/**
 * The step the crew should run next, or null when nothing can run: the first,
 * in order, that is to do (or failed with tries left), whose inputs are there
 * and whose earlier steps are done. A step working when the server stopped
 * runs again.
 */
export function nextStep(s: StoreRecord): StepName | null {
  for (const name of STEPS) {
    const st = s.steps[name];
    const runnable = st.state === "todo" || st.state === "working" || (st.state === "failed" && st.tries < MAX_TRIES);
    if (!runnable) continue;
    if (!hasInputs(s, name)) continue;
    if (NEEDS[name].every((n) => s.steps[n].state === "done")) return name;
  }
  return null;
}

/** A new upload (or a message's change) sends these steps back to do. */
export function redo(s: StoreRecord, steps: StepName[]): StoreRecord {
  const next = { ...s, steps: { ...s.steps } };
  for (const n of steps) next.steps[n] = { state: "todo", tries: 0, note: "", at: null };
  return next;
}

export function setStep(s: StoreRecord, name: StepName, state: StepState, note: string, now: Date): StoreRecord {
  const prev = s.steps[name];
  const tries = state === "failed" ? prev.tries + 1 : state === "done" ? 0 : prev.tries;
  return { ...s, updatedAt: now.toISOString(), steps: { ...s.steps, [name]: { state, tries, note: note.slice(0, 600), at: now.toISOString() } } };
}

/** Whether every step is done. */
export const allDone = (s: StoreRecord) => STEPS.every((n) => s.steps[n].state === "done");

/** What the store's page says about it, in one line. */
export function statusOf(s: StoreRecord): { en: string; fa: string; tone: "work" | "you" | "ready" | "live" } {
  if (STEPS.some((n) => s.steps[n].state === "needs-you" || (s.steps[n].state === "failed" && s.steps[n].tries >= MAX_TRIES))) {
    return { en: "Needs you", fa: "منتظر شما", tone: "you" };
  }
  if (!s.files.video || !s.files.sheet) return { en: "Waiting for uploads", fa: "منتظر فایل‌ها", tone: "you" };
  if (!allDone(s)) return { en: "The crew is working", fa: "در حال ساخت", tone: "work" };
  return s.live ? { en: "Live in the bazaar", fa: "در بازار", tone: "live" } : { en: "Ready — waiting for «Publish»", fa: "آماده — منتظر «انتشار»", tone: "ready" };
}

/** Money left for this store's AI, in cents. */
export const budgetLeft = (s: StoreRecord) => Math.max(0, BUDGET_CENTS - s.spentCents);

/** What an upload of `kind` may be, by its file name: null when fine, else why not. */
export function checkUploadName(kind: UploadKind, name: string): string | null {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  if (kind === "video") {
    if (ext === "insv") {
      return "This is the camera's raw file (.insv). Open it in Insta360 Studio, Imaging → Adjust, then Export → 360 Video, 8K, maximum bitrate, H.265, Anti-Flicker on, and upload that .mp4. · این فایل خام دوربین است؛ در Insta360 Studio خروجی ‎.mp4 بگیرید.";
    }
    return ext === "mp4" ? null : "The 360° walk is an .mp4 exported from Insta360 Studio. · ویدیوی ۳۶۰ باید ‎.mp4 باشد.";
  }
  if (kind === "sheet") return ext === "xlsx" ? null : "The product list is an Excel workbook (.xlsx). · فهرست محصولات باید ‎.xlsx باشد.";
  return ["jpg", "jpeg", "png", "webp"].includes(ext) ? null : "A photo is .jpg, .png or .webp. · عکس باید jpg یا png یا webp باشد.";
}

/** Where an upload is kept (masters bucket, private): `stores/<slug>/uploads/<kind>/<stamp>-<name>`. */
export function uploadKey(slug: string, kind: UploadKind, name: string, now: Date): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "").slice(-80) || "file";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `stores/${slug}/uploads/${kind}/${stamp}-${base}`;
}

export const isUploadKeyOf = (slug: string, key: string) =>
  new RegExp(`^stores/${slug}/uploads/(video|sheet|photo|door)/[0-9]{8}-[0-9]{6}-[A-Za-z0-9._-]{1,80}$`).test(key);

/** The upload recorded: a video, sheet or door replaces the last one; photos add up. Then the steps it affects go back to do. */
export function addUpload(s: StoreRecord, kind: UploadKind, file: Uploaded): StoreRecord {
  const files = { ...s.files, photos: [...s.files.photos] };
  if (kind === "photo") {
    const i = files.photos.findIndex((p) => p.name === file.name);
    if (i >= 0) files.photos[i] = file;
    else files.photos.push(file);
  } else files[kind] = file;
  return redo({ ...s, files, updatedAt: file.at }, REDO[kind]);
}

/** The thread, newest last, kept to its last 200 entries. */
export function addToThread(s: StoreRecord, e: ThreadEntry): StoreRecord {
  return { ...s, thread: [...s.thread, { ...e, text: e.text.slice(0, 4000) }].slice(-200) };
}

/** What the page shows a signed-in visitor: everything but the password's hash. */
export function forPage(s: StoreRecord): Omit<StoreRecord, "passwordHash"> {
  const { passwordHash: _, ...rest } = s;
  return rest;
}

/** Read back what the bucket holds; null when it is not a store record. */
export function parseStore(raw: unknown): StoreRecord | null {
  const o = (raw && typeof raw === "object" ? raw : null) as StoreRecord | null;
  if (!o || typeof o.slug !== "string" || !SLUG_RE.test(o.slug) || typeof o.passwordHash !== "string") return null;
  const steps = freshSteps();
  for (const n of STEPS) {
    const st = o.steps?.[n];
    if (st && typeof st.state === "string") steps[n] = { state: st.state, tries: Number(st.tries) || 0, note: String(st.note ?? ""), at: st.at ?? null };
  }
  return {
    ...o,
    name: { en: o.name?.en ?? "", fa: o.name?.fa ?? "" },
    files: { ...(o.files ?? {}), photos: Array.isArray(o.files?.photos) ? o.files.photos : [] },
    steps,
    out: o.out ?? {},
    spentCents: Number(o.spentCents) || 0,
    live: o.live === true,
    thread: Array.isArray(o.thread) ? o.thread : [],
  };
}
