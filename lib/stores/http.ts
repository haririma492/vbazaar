/**
 * What the Store Builder's routes share: their answers, and the upload of a
 * file in parts straight from the browser to the private bucket (an
 * Insta360 walk is several GB; a dropped connection resumes, `parts`).
 * Server only.
 */

import { NextResponse } from "next/server";
import { partPlan } from "@/lib/splats/keys";
import { abortUpload, completeUpload, listParts, signPart, startUpload, uploadPartBytes } from "@/lib/splats/r2";

export const NO_STORE = { "cache-control": "no-store" };
export const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
export const ok = (body: object = {}) => NextResponse.json({ ok: true, ...body }, { headers: NO_STORE });

export type UploadAsk = { action: string; key?: string; uploadId?: string; partNumber?: number; size?: number; parts?: Array<{ partNumber: number; etag: string }> };

/**
 * One turn of an upload whose key the caller has already made and checked:
 *   start { size }                → { uploadId, partSize, partCount }
 *   sign { uploadId, partNumber } → { url }    (PUT the part there)
 *   parts { uploadId }            → { parts }  (what is there already: resume)
 *   complete { uploadId, parts }  → {}         (the caller then records it)
 *   abort { uploadId }
 */
export async function uploadTurn(key: string, ask: UploadAsk) {
  if (ask.action === "start") {
    const plan = partPlan(Number(ask.size));
    if (!plan) return fail(400, "That file is empty or too big for the bucket.");
    return ok({ key, uploadId: await startUpload("master", key), ...plan });
  }
  const uploadId = String(ask.uploadId || "");
  if (!uploadId || uploadId.length > 1024) return fail(400, "No upload id.");
  if (ask.action === "sign") {
    const n = Number(ask.partNumber);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) return fail(400, "Part number 1–10000.");
    return ok({ url: await signPart("master", key, uploadId, n) });
  }
  if (ask.action === "parts") return ok({ parts: await listParts("master", key, uploadId) });
  if (ask.action === "abort") {
    await abortUpload("master", key, uploadId);
    return ok();
  }
  if (ask.action === "complete") {
    const parts = Array.isArray(ask.parts) ? ask.parts.filter((p) => Number.isInteger(p?.partNumber) && typeof p?.etag === "string") : [];
    if (!parts.length) return fail(400, "No parts.");
    await completeUpload("master", key, uploadId, parts);
    return null;
  }
  return fail(400, "Unknown action.");
}

/** The fallback when the browser may not PUT to the bucket itself: the part comes through this server. */
export async function relayPart(key: string, uploadId: string, partNumber: number, body: Uint8Array) {
  if (!body.length || body.length > 600 * 1024 * 1024) return fail(400, "Empty or oversized part.");
  return ok({ etag: await uploadPartBytes("master", key, uploadId, partNumber, body) });
}
