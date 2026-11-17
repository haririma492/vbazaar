/**
 * «SEND A TEXT TO STORE» — the pure rules (owner, 2026-11-17: "on the right hand side of the store logo add a field
 * "Send a text to store" a small modal will open and both answer and response will appear. Store phone number is
 * already on the store metadata but for now send it to my number … until in store page operator turns on texting then
 * send and receive to store number"). Twilio carries the texts (`texts.ts`); this file only decides.
 *
 * - A shopper's conversation has an id kept on their device; its short CODE (4 letters) is in every text the store gets,
 *   so the store can answer several shoppers: a reply starting «#CODE» goes to that conversation, any other reply to the
 *   conversation that last texted that phone.
 * - Where the texts go: the store's own phone once the operator turns texting on (`StoreRecord.texting`), else the
 *   owner's (`TEXT_OWNER`).
 */

/** Where a store's texts go until the operator turns texting on for it (the owner's own number, as asked). */
export const TEXT_OWNER = "+16472196606";
/** At most this many characters a text. */
export const TEXT_MAX = 500;
/** A conversation may send at most this many texts in `TEXT_WINDOW_MS` (each one costs). */
export const TEXT_LIMIT = 8;
export const TEXT_WINDOW_MS = 10 * 60 * 1000;

export type TextMessage = { from: "shopper" | "store"; text: string; at: string };
export type TextConversation = { id: string; slug: string; to: string; messages: TextMessage[] };

/** A phone number as Twilio wants it (+1… for a North American 10-digit number); null when it is not one. */
export function e164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** A conversation id is 12 letters and digits (made on the shopper's device). */
export const isConvId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]{12}$/.test(v);

/** The 4-letter code the store sees for a conversation. */
export function codeOf(id: string): string {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 4; i++) { out += A[h % A.length]; h = Math.floor(h / A.length) + (i + 1) * 7919; }
  return out;
}

/** What the store's phone receives for a shopper's text. */
export function outgoingText(storeName: string, id: string, text: string): string {
  return `${storeName} · vbazaar.app shopper #${codeOf(id)}:\n${text}\n(Reply to answer. Start with #${codeOf(id)} to answer this shopper if several are writing.)`;
}

/** A reply from the store's phone: the conversation code it starts with, if any, and its text. */
export function readReply(body: string): { code: string | null; text: string } {
  const m = /^\s*#([A-Za-z]{4})\b[\s:,-]*/.exec(body);
  return m ? { code: m[1].toUpperCase(), text: body.slice(m[0].length).trim() } : { code: null, text: body.trim() };
}

/** A shopper's text cleaned, or why it cannot go. */
export function cleanText(v: unknown): { text: string } | { error: string } {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!t) return { error: "Write a message first." };
  if (t.length > TEXT_MAX) return { error: `At most ${TEXT_MAX} characters.` };
  return { text: t };
}

/** Whether a conversation may send another text now (each one costs). */
export function mayText(c: TextConversation | null, now: number): boolean {
  if (!c) return true;
  const recent = c.messages.filter((m) => m.from === "shopper" && now - Date.parse(m.at) < TEXT_WINDOW_MS);
  return recent.length < TEXT_LIMIT;
}
