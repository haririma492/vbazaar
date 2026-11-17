// TWILIO'S WEBHOOK FOR TEXTS TO OUR NUMBER (owner, 2026-11-17, «Send a text to store»; `lib/stores/texts.ts`). Set in
// Twilio → the number → Messaging → «A message comes in»: https://vbazaar.app/api/sms/inbound (POST). The signature is
// checked; a reply from the store's phone lands in the shopper's box: by its «#CODE», else the conversation that last
// texted that phone. Answers Twilio with an empty reply (nothing is texted back). Every call is logged
// (`texts/inbound-log.json`, the last 50; shown by /api/operator/texting) so a reply that never lands can be traced.
import { convForReply, logInbound, readConv, twilioSignatureOk, writeConv } from "@/lib/stores/texts";
import { readReply } from "@/lib/stores/textRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const twiml = (status = 200) => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status, headers: { "content-type": "text/xml" } });

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const params: Record<string, string> = {};
  form.forEach((v, k) => { params[k] = v; });
  // The address Twilio signed is the one typed into its console: the public one, with or without www, plus any query.
  const own = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || own.host;
  const urls = [...new Set([
    `https://${host}${own.pathname}${own.search}`,
    `https://vbazaar.app/api/sms/inbound${own.search}`,
    `https://www.vbazaar.app/api/sms/inbound${own.search}`,
    `https://vbazaar.app/api/sms/inbound/${own.search}`,
  ])];
  const sig = req.headers.get("x-twilio-signature");
  const signed = urls.some((u) => twilioSignatureOk(u, params, sig));
  const from = params.From ?? "";
  const tail = from.slice(-4);
  if (!signed) { await logInbound({ ok: false, why: sig ? "signature did not match" : "no signature", from: tail, host }).catch(() => {}); return twiml(403); }
  const { code, text } = readReply(params.Body ?? "");
  if (!text) { await logInbound({ ok: false, why: "empty text", from: tail, host }).catch(() => {}); return twiml(); }
  const id = await convForReply(from, code).catch(() => null);
  const conv = id ? await readConv(id).catch(() => null) : null;
  if (!conv) { await logInbound({ ok: false, why: `no conversation for this phone${code ? ` / code #${code}` : ""}`, from: tail, host }).catch(() => {}); return twiml(); }
  conv.messages.push({ from: "store", text, at: new Date().toISOString() });
  await writeConv(conv);
  await logInbound({ ok: true, why: `to conversation #${conv.id.slice(0, 4)}…`, from: tail, host }).catch(() => {});
  return twiml();
}
