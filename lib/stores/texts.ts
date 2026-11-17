/**
 * «SEND A TEXT TO STORE» — the server side (owner, 2026-11-17; rules in `textRules.ts`). Twilio carries the texts:
 *
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  the account (Railway)
 *   TWILIO_FROM                            the Twilio number texts come from and replies go to (+1…)
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

export function textingConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && e164(process.env.TWILIO_FROM));
}

/** Where a store's texts go now: its own phone once texting is turned on for it, else the owner's. */
export function textTarget(s: StoreRecord): string {
  return (s.texting && e164(s.phone)) || TEXT_OWNER;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!, from = e164(process.env.TWILIO_FROM)!;
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
