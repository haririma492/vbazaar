// «Send a text to store» (owner, 2026-11-17; `lib/stores/texts.ts`, `textRules.ts`).
//   GET  ?conv=<id>          → { enabled, messages }  (polled while the shopper's box is open)
//   POST { conv, text }      → the text sent to the store's phone; { messages }
import { NextResponse } from "next/server";
import { readStore } from "@/lib/stores/bucket";
import { readConv, rememberLast, sendSms, textTarget, textingConfigured, writeConv } from "@/lib/stores/texts";
import { cleanText, isConvId, mayText, outgoingText } from "@/lib/stores/textRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const conv = new URL(req.url).searchParams.get("conv");
  const enabled = textingConfigured() && Boolean(await readStore(params.slug).catch(() => null));
  if (!enabled) return NextResponse.json({ ok: true, enabled: false, messages: [] }, { headers: NO_STORE });
  const c = isConvId(conv) ? await readConv(conv).catch(() => null) : null;
  return NextResponse.json({ ok: true, enabled: true, messages: c && c.slug === params.slug ? c.messages : [] }, { headers: NO_STORE });
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
  if (!textingConfigured()) return fail(503, "Texting is not set up yet.");
  const s = await readStore(params.slug).catch(() => null);
  if (!s) return fail(404, "No such store.");
  let body: { conv?: unknown; text?: unknown };
  try { body = await req.json(); } catch { return fail(400, "Bad request."); }
  if (!isConvId(body.conv)) return fail(400, "Bad conversation.");
  const clean = cleanText(body.text);
  if ("error" in clean) return fail(400, clean.error);
  const prev = await readConv(body.conv).catch(() => null);
  if (prev && prev.slug !== s.slug) return fail(400, "Bad conversation.");
  if (!mayText(prev, Date.now())) return fail(429, "Please wait a few minutes before sending more.");
  const to = textTarget(s);
  try { await sendSms(to, outgoingText(s.name.en || s.name.fa || s.slug, body.conv, clean.text)); }
  catch (e) { return fail(502, `Not sent: ${(e as Error).message}`); }
  const conv = { id: body.conv, slug: s.slug, to, messages: [...(prev?.messages ?? []), { from: "shopper" as const, text: clean.text, at: new Date().toISOString() }] };
  await writeConv(conv);
  await rememberLast(to, conv.id);
  return NextResponse.json({ ok: true, messages: conv.messages }, { headers: NO_STORE });
}
