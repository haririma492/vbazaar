/**
 * «SEND A TEXT TO STORE» — the server side (owner, 2026-11-17; rules in `textRules.ts`). Twilio carries the texts:
 *
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  the account (Railway)
 *   TWILIO_FROM (or TWILIO_FROM_NUMBER)    the Twilio number texts come from and replies go to (+1…)
 *
 * Without them the shoppers' key is not shown. A shopper's text goes to the store's phone (or the owner's, until the
 * operator turns texting on); the store's reply comes to `/api/sms/inbound` (Twilio's webhook, signed and checked)
 * and lands in the shopper's box. Conversations are kept in the masters bucket (private):
 *   texts/conv/<id>.json   the conversation
 *   texts/last.json        which conversation last texted each phone (a reply without a #CODE goes there)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readMastersText, writeMastersJson } from "@/lib/splats/r2";
import type { StoreRecord } from "./store";
import { TEXT_OWNER, codeOf, e164, type TextConversation } from "./textRules";

/** The Twilio number: `TWILIO_FROM`, or `TWILIO_FROM_NUMBER` as the owner's other project names it (2026-11-17). */
const fromNumber = () => e164(process.env.TWILIO_FROM || process.env.TWILIO_FROM_NUMBER);

export function textingConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && fromNumber());
}

/** Where a store's texts go now: its own phone once texting is turned on for it, else the owner's. */
export function textTarget(s: StoreRecord): string {
  return (s.texting && e164(s.phone)) || TEXT_OWNER;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!, from = fromNumber()!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  if (!res.ok) {
    let why = `${res.status}`;
    try { const j = await res.json() as { message?: string }; if (j.message) why = j.message; } catch { /* */ }
    throw new Error(`the text was not sent (${why})`);
  }
}

/** Twilio's signature on a webhook: HMAC-SHA1 of the URL followed by each field name and value, sorted by name. */
export function twilioSignatureOk(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const want = createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(want), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const convKey = (id: string) => `texts/conv/${id}.json`;
export async function readConv(id: string): Promise<TextConversation | null> {
  const t = await readMastersText(convKey(id));
  return t ? (JSON.parse(t) as TextConversation) : null;
}
export const writeConv = (c: TextConversation) => writeMastersJson(convKey(c.id), c);

type Last = Record<string, { conv: string; codes: Record<string, string> }>;
async function readLast(): Promise<Last> {
  const t = await readMastersText("texts/last.json");
  return t ? (JSON.parse(t) as Last) : {};
}
/** Remember that conversation `id` last texted `phone` (and its code, for «#CODE» replies). */
export async function rememberLast(phone: string, id: string): Promise<void> {
  const last = await readLast();
  const cur = last[phone] ?? { conv: id, codes: {} };
  const codes = { ...cur.codes, [codeOf(id)]: id };
  // Keep the 200 most recent codes per phone.
  const keep = Object.entries(codes).slice(-200);
  last[phone] = { conv: id, codes: Object.fromEntries(keep) };
  await writeMastersJson("texts/last.json", last);
}
/** The conversation a reply from `phone` belongs to: by its #CODE, else the last that texted that phone. */
export async function convForReply(phone: string, code: string | null): Promise<string | null> {
  const last = (await readLast())[phone];
  if (!last) return null;
  return (code && last.codes[code]) || last.conv;
}

/** The last 50 calls to the inbound webhook, newest first (no message text; the phone's last 4 digits only). */
export type InboundLog = { at: string; ok: boolean; why: string; from: string; host: string };
export async function logInbound(e: Omit<InboundLog, "at">): Promise<void> {
  const t = await readMastersText("texts/inbound-log.json").catch(() => null);
  const list = (t ? JSON.parse(t) : []) as InboundLog[];
  await writeMastersJson("texts/inbound-log.json", [{ at: new Date().toISOString(), ...e }, ...list].slice(0, 50));
}
export async function readInboundLog(): Promise<InboundLog[]> {
  const t = await readMastersText("texts/inbound-log.json").catch(() => null);
  return t ? (JSON.parse(t) as InboundLog[]) : [];
}

/** Read only: what Twilio holds for our number (where its incoming texts go) and the account's name. */
export async function twilioNumberInfo(): Promise<{ account: string | null; smsUrl: string | null; smsMethod: string | null; numberName: string | null; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!, from = fromNumber();
  const auth = { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;
  try {
    const [a, n] = await Promise.all([
      fetch(`${base}.json`, { headers: auth }).then((r) => r.json() as Promise<{ friendly_name?: string; message?: string }>),
      fetch(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from ?? "")}`, { headers: auth })
        .then((r) => r.json() as Promise<{ incoming_phone_numbers?: Array<{ sms_url?: string; sms_method?: string; friendly_name?: string }>; message?: string }>),
    ]);
    const num = n.incoming_phone_numbers?.[0];
    return { account: a.friendly_name ?? null, smsUrl: num?.sms_url ?? null, smsMethod: num?.sms_method ?? null, numberName: num?.friendly_name ?? null,
      ...(num ? {} : { error: n.message || a.message || "the number is not in this Twilio account" }) };
  } catch (e) { return { account: null, smsUrl: null, smsMethod: null, numberName: null, error: (e as Error).message }; }
}

/** Point our Twilio number's incoming texts at `url` (the operator's yes, 2026-11-17: it was empty). */
export async function setTwilioSmsUrl(url: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!, from = fromNumber();
  const headers = { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;
  const list = await (await fetch(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from ?? "")}`, { headers })).json() as { incoming_phone_numbers?: Array<{ sid: string }> };
  const num = list.incoming_phone_numbers?.[0];
  if (!num) throw new Error("the number is not in this Twilio account");
  const r = await fetch(`${base}/IncomingPhoneNumbers/${num.sid}.json`, { method: "POST", headers, body: new URLSearchParams({ SmsUrl: url, SmsMethod: "POST" }).toString() });
  const j = await r.json() as { sms_url?: string; message?: string };
  if (!r.ok) throw new Error(j.message || `Twilio answered ${r.status}`);
  return j.sms_url ?? "";
}
