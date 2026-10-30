/**
 * /api/stores — the operator's list of stores, and a new store from the
 * intake (`/stores/new`). x-admin-token. `lib/stores/`.
 *
 *   GET                     → { stores: [{ slug, name, status, live, steps, spent }] }
 *   POST { intake }         → { slug }   (refused, every problem named, when an answer is wrong)
 */
import { NextRequest } from "next/server";
import { r2Config } from "@/lib/splats/r2";
import { checkIntake, newStore, slugOf, statusOf, type Intake } from "@/lib/stores/store";
import { createStore, readIndex, readStore } from "@/lib/stores/bucket";
import { hashPassword, isOperator } from "@/lib/stores/auth";
import { fail, ok } from "@/lib/stores/http";
import { kick } from "@/lib/stores/crew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isOperator(req)) return fail(401, "Unauthorized");
  if (!r2Config().configured) return fail(503, "R2 is not configured on this host.");
  kick();
  const stores = [];
  for (const e of await readIndex()) {
    const s = await readStore(e.slug);
    if (!s) continue;
    stores.push({ slug: s.slug, name: s.name, status: statusOf(s), live: s.live, spot: s.out.spot ?? null, spent: s.spentCents, steps: s.steps, createdAt: s.createdAt });
  }
  return ok({ stores });
}

export async function POST(req: NextRequest) {
  if (!isOperator(req)) return fail(401, "Unauthorized");
  if (!r2Config().configured) return fail(503, "R2 is not configured on this host.");
  const body = (await req.json().catch(() => ({}))) as { intake?: Partial<Intake> };
  const intake = body.intake ?? {};
  const problems = checkIntake(intake);
  if (problems.length) return fail(400, problems.join(" · "));
  const i = intake as Intake;
  const slug = slugOf(i.nameEn);
  // `area-…` is where the bazaar's own areas keep their uploads.
  if (slug === "new" || slug === "areas") return fail(400, "«New» and «Areas» are this site's own pages: give the store a fuller English name.");
  if (slug.startsWith("area-")) return fail(400, "A store's English name may not start with «Area». · نام فروشگاه با Area شروع نشود.");
  const s = newStore(slug, i, hashPassword(i.password.trim()), new Date());
  if (!(await createStore(s))) return fail(409, `A store at /stores/${slug} already exists. Give this one a different English name. · این نام قبلاً ثبت شده است.`);
  return ok({ slug });
}
