// /api/operator/texting — is «Send a text to store» set up? (2026-11-17). Operator only. Says which TWILIO_* variable
// NAMES this server sees and whether the number reads as a phone number; never a value.
import { NextRequest } from "next/server";
import { isOperator } from "@/lib/stores/auth";
import { fail, ok } from "@/lib/stores/http";
import { readInboundLog, setTwilioSmsUrl, textingConfigured, twilioNumberInfo } from "@/lib/stores/texts";
import { e164 } from "@/lib/stores/textRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isOperator(req)) return fail(403, "The operator only.");
  const names = Object.keys(process.env).filter((k) => /twilio/i.test(k)).sort();
  const from = process.env.TWILIO_FROM || process.env.TWILIO_FROM_NUMBER || "";
  return ok({
    configured: textingConfigured(),
    names,
    accountSid: Boolean(process.env.TWILIO_ACCOUNT_SID), authToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    fromSet: Boolean(from), fromReadsAsPhone: Boolean(e164(from)),
    fromShape: from ? from.replace(/\d/g, "9") : null,
    inbound: await readInboundLog(),
    twilio: textingConfigured() ? await twilioNumberInfo() : null,
  });
}

// POST { action: "setWebhook" } — point the Twilio number's incoming texts at this site (operator; owner's yes, 2026-11-17).
export async function POST(req: NextRequest) {
  if (!isOperator(req)) return fail(403, "The operator only.");
  if (!textingConfigured()) return fail(409, "Texting is not set up.");
  const body = await req.json().catch(() => ({})) as { action?: string };
  if (body.action !== "setWebhook") return fail(400, "Unknown action.");
  try { return ok({ smsUrl: await setTwilioSmsUrl("https://vbazaar.app/api/sms/inbound") }); }
  catch (e) { return fail(502, (e as Error).message); }
}
