// TWILIO'S WEBHOOK FOR TEXTS TO OUR NUMBER (owner, 2026-11-17, «Send a text to store»; `lib/stores/texts.ts`). Set in
// Twilio → the number → Messaging → «A message comes in»: https://vbazaar.app/api/sms/inbound (POST). The signature is
// checked; a reply from the store's phone lands in the shopper's box: by its «#CODE», else the conversation that last
// texted that phone. Answers Twilio with an empty reply (nothing is texted back).
import { convForReply, readConv, twilioSignatureOk, writeConv } from "@/lib/stores/texts";
import { readReply } from "@/lib/stores/textRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const twiml = (status = 200) => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status, headers: { "content-type": "text/xml" } });

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const params: Record<string, string> = {};
  form.forEach((v, k) => { params[k] = v; });
  // The address Twilio signed: the public one (behind Railway's proxy the request's own host may differ).
  const url = `https://vbazaar.app/api/sms/inbound`;
  if (!twilioSignatureOk(url, params, req.headers.get("x-twilio-signature"))) return twiml(403);
  const from = params.From ?? "";
  const { code, text } = readReply(params.Body ?? "");
  if (!text) return twiml();
  const id = await convForReply(from, code).catch(() => null);
  const conv = id ? await readConv(id).catch(() => null) : null;
  if (!conv) return twiml();
  conv.messages.push({ from: "store", text, at: new Date().toISOString() });
  await writeConv(conv);
  return twiml();
}
