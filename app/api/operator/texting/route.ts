// /api/operator/texting — is «Send a text to store» set up? (2026-11-17). Operator only. Says which TWILIO_* variable
// NAMES this server sees and whether the number reads as a phone number; never a value.
import { NextRequest } from "next/server";
import { isOperator } from "@/lib/stores/auth";
import { fail, ok } from "@/lib/stores/http";
import { textingConfigured } from "@/lib/stores/texts";
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
  });
}
