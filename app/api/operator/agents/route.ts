/**
 * /api/operator/agents — what every agent is doing, for `/operator/agents`
 * (owner, 2026-11-04: "is there a dashboard that I can see what my agents are
 * doing at each point"). Operator only (x-admin-token). Reads only: nothing
 * here starts, stops or spends anything.
 *
 *   GET → {
 *     server:  which change is running (Railway's commit) and since when,
 *     stores:  each store's crew, step by step (state, tries, live note), its AI spent of the budget,
 *     jobs:    the background jobs (walking speed, re-pinning, reversed copies, the Shadow agent),
 *     walks:   each walk's products (lights, outlines) and whether its pins are the fine follow's,
 *     needsYou: what is waiting for a person, first,
 *   }
 */
import { NextRequest } from "next/server";
import { readIndex, readStore } from "@/lib/stores/bucket";
import { isOperator } from "@/lib/stores/auth";
import { BUDGET_CENTS, MAX_TRIES, STEPS, STEP_SAY, statusOf } from "@/lib/stores/store";
import { fail, ok } from "@/lib/stores/http";
import { readWalks } from "@/lib/splats/r2";
import type { Walk } from "@/lib/splats/walks";
import { paceStatus } from "@/lib/stores/lock";
import { repinStatus } from "@/lib/stores/repin";
import { reverseStatus } from "@/lib/stores/reverse";
import { shadowState } from "@/lib/stores/reflect";
import { PIN_VERSION } from "@/lib/stores/tagging";
import { photosStatus } from "@/lib/stores/crew";
import { readJob } from "@/lib/stores/jobState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** When this server started: a deploy (or a crash) starts a new one. */
const STARTED = new Date().toISOString();

export async function GET(req: NextRequest) {
  if (!isOperator(req)) return fail(401, "Sign in with the admin token.");
  const needsYou: Array<{ what: string; where: string; link?: string }> = [];

  const stores = [];
  for (const e of await readIndex()) {
    const s = await readStore(e.slug).catch(() => null);
    if (!s) continue;
    const steps = STEPS.map((n) => ({ name: n, say: STEP_SAY[n].en, ...s.steps[n] }));
    for (const st of steps) {
      if (st.state === "needs-you" || (st.state === "failed" && st.tries >= MAX_TRIES)) needsYou.push({ what: `${st.say}: ${st.note || st.state}`, where: s.name.en || s.slug, link: `/stores/${s.slug}` });
    }
    stores.push({ slug: s.slug, name: s.name, status: statusOf(s), live: s.live, spentCents: s.spentCents, budgetCents: BUDGET_CENTS, updatedAt: s.updatedAt, walk: s.out.walk ?? null, steps });
  }
  stores.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const [pace, repin, reverse, shadow, walksFile, photos, route, tour, shelfFind] = await Promise.all([
    paceStatus().catch(() => null), repinStatus().catch(() => null), reverseStatus().catch(() => null), shadowState().catch(() => null), readWalks().catch(() => null),
    photosStatus().catch(() => null), readJob("route").catch(() => null), readJob("tour").catch(() => null), readJob("shelfFind").catch(() => null),
  ]);
  const jobs = [
    { id: "pace", name: "Walking speed (lock agent's half)", what: "Measures how fast each walk was filmed, so the speed bar is a real speed. Free.", ...(pace ?? { busy: false, waiting: [] }) },
    { id: "repin", name: "Light keeper", what: "Keeps each product's light on it while it is in view: follows it again, checks it stays on the same product, joins its lights. Free.", ...(repin ?? { busy: false, waiting: [] }) },
    { id: "reverse", name: "Reversed copies", what: "Makes the copy «◀ Back» plays. Free.", ...(reverse ?? { busy: false, waiting: [] }) },
    { id: "photos", name: "Photo improver", what: "Cuts each product's photo where the finder saw it closest, at the sharpest frame, from the original upload, for every store. Free.", ...(photos ?? { busy: false, waiting: [] }) },
    { id: "route", name: "Route optimizer", what: "Plans a smooth forward route through a store's walk (no walking back, no second passes); nothing is cut without a yes. Free.", busy: Boolean(route?.busy), waiting: [], ...(route?.busy && route.key ? { current: route.key } : {}), ...(route?.note ? { note: route.note } : {}) },
    { id: "tour", name: "Shelf Tour builder", what: "Makes a store's Shelf Tour: the camera on each shelf in turn, zoomed to fit, cut from the original upload; shoppers tap a light to add to basket. Free.", busy: Boolean(tour?.busy), waiting: [], ...(tour?.busy && tour.key ? { current: tour.key } : {}), ...(tour?.note ? { note: tour.note } : {}) },
    { id: "shelfFind", name: "Shelf finder", what: "Looks again at each shelf of a store's Shelf Tour, in one steady picture from the original upload, and adds the products not in the list yet (with a light and a photo). AI, from the store's budget, on the owner's yes.", busy: Boolean(shelfFind?.busy), waiting: [], ...(shelfFind?.busy && shelfFind.key ? { current: shelfFind.key } : {}), ...(shelfFind?.note ? { note: shelfFind.note } : {}) },
  ];
  const shadowJob = shadow ? { key: shadow.key, phase: shadow.phase, note: shadow.note, at: shadow.at, looked: shadow.looked, spentCents: shadow.spent } : null;
  if (shadow?.phase === "failed") needsYou.push({ what: `Shadow agent: ${shadow.note}`, where: shadow.key });

  const walks = (Object.entries(walksFile?.walks ?? {}) as Array<[string, Walk]>).filter(([k]) => k.startsWith("scenes/")).map(([key, w]) => {
    const items = w.items ?? [];
    const auto = items.filter((i) => i.id.startsWith("auto-"));
    return {
      key, title: w.title?.en ?? null, products: items.length, outlines: items.filter((i) => i.size).length,
      fine: auto.length ? (w.pinned ?? 1) >= PIN_VERSION : null, pace: w.pace ?? null, doors: w.doors.length,
    };
  }).sort((a, b) => b.products - a.products);

  return ok({
    server: { commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7) || null, message: process.env.RAILWAY_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null, startedAt: STARTED, now: new Date().toISOString() },
    needsYou, stores, jobs, shadow: shadowJob, walks,
  });
}
