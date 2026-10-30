"use client";

/**
 * A FILE INTO THE BUCKET, IN PARTS, FROM THE BROWSER (`lib/stores/http.ts`
 * on the server). An Insta360 walk is several GB: each part goes straight to
 * R2 on an address the server signs, three at a time; if the connection
 * drops or the page is closed, choosing the same file again carries on from
 * the parts already there. A part the browser may not PUT to R2 itself (the
 * bucket's CORS) goes through the server instead.
 */

import { readAdminToken } from "@/lib/admin/useAdminMode";

export type Progress = { sent: number; total: number };

const memoKey = (endpoint: string, tag: string, f: File) => `vb-upload:${endpoint}:${tag}:${f.name}:${f.size}:${f.lastModified}`;

function headers(): Record<string, string> {
  const token = readAdminToken();
  return { "content-type": "application/json", ...(token ? { "x-admin-token": token } : {}) };
}

async function call<T>(endpoint: string, body: object): Promise<T> {
  const res = await fetch(endpoint, { method: "POST", headers: headers(), credentials: "same-origin", body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
  if (!res.ok || !out.ok) throw new Error(out.error || `The server answered ${res.status}.`);
  return out as T;
}

/**
 * Upload `file` through `endpoint` (`/api/stores/<slug>` or `/api/stores/areas`);
 * `fields` say what it is (`{ action: "upload", kind }` or `{ action: "upload", id }`).
 * Resolves with the server's answer to «complete».
 */
export async function uploadInParts<T = Record<string, unknown>>(endpoint: string, fields: Record<string, unknown>, file: File, onProgress: (p: Progress) => void): Promise<T> {
  const tag = JSON.stringify(fields);
  const memo = memoKey(endpoint, tag, file);
  let saved: { key: string; uploadId: string; partSize: number; partCount: number } | null = null;
  try { saved = JSON.parse(localStorage.getItem(memo) || "null"); } catch { /* none */ }

  const done = new Map<number, string>();
  if (saved) {
    try {
      const { parts } = await call<{ parts: Array<{ partNumber: number; etag: string }> }>(endpoint, { ...fields, ask: "parts", key: saved.key, uploadId: saved.uploadId });
      for (const p of parts) done.set(p.partNumber, p.etag);
    } catch {
      saved = null; // the unfinished upload is gone: start again
    }
  }
  if (!saved) {
    saved = await call(endpoint, { ...fields, ask: "start", name: file.name, size: file.size });
    try { localStorage.setItem(memo, JSON.stringify(saved)); } catch { /* private mode */ }
  }
  const { key, uploadId, partSize, partCount } = saved!;
  const sizeOf = (n: number) => Math.min(file.size, n * partSize) - (n - 1) * partSize;
  let sent = [...done.keys()].reduce((s, n) => s + sizeOf(n), 0);
  onProgress({ sent, total: file.size });

  const todo = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  let direct = true;
  const sendPart = async (n: number) => {
    const blob = file.slice((n - 1) * partSize, Math.min(file.size, n * partSize));
    for (let attempt = 1; ; attempt++) {
      try {
        let etag: string | null = null;
        if (direct) {
          const { url } = await call<{ url: string }>(endpoint, { ...fields, ask: "sign", key, uploadId, partNumber: n });
          try {
            const res = await fetch(url, { method: "PUT", body: blob });
            etag = res.ok ? res.headers.get("etag") : null;
            if (res.ok && !etag) direct = false; // the bucket hides ETag from the browser: go through the server
          } catch {
            direct = false; // refused by CORS (or a proxy): go through the server
          }
        }
        if (!etag) {
          const q = new URLSearchParams({ key, uploadId, partNumber: String(n), ...(typeof fields.id === "string" ? { id: fields.id } : {}) });
          const h = headers();
          delete h["content-type"];
          const res = await fetch(`${endpoint}?${q}`, { method: "PUT", headers: h, credentials: "same-origin", body: blob });
          const out = await res.json().catch(() => ({}));
          if (!res.ok || !out.etag) throw new Error(out.error || `part ${n}: the server answered ${res.status}`);
          etag = out.etag;
        }
        done.set(n, etag!);
        sent += blob.size;
        onProgress({ sent, total: file.size });
        return;
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  };
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) await sendPart(n);
  }));
  const out = await call<T>(endpoint, {
    ...fields, ask: "complete", key, uploadId, name: file.name, size: file.size,
    parts: [...done].map(([partNumber, etag]) => ({ partNumber, etag })),
  });
  try { localStorage.removeItem(memo); } catch { /* fine */ }
  return out;
}

/** Music (.mp3/.m4a, ≤40 MB): one PUT to the address the server signs, then the walk plays it. */
export async function uploadMusic(endpoint: string, fields: Record<string, unknown>, file: File): Promise<void> {
  const type = file.type === "audio/mp3" ? "audio/mpeg" : file.type || (/\.m4a$/i.test(file.name) ? "audio/mp4" : "audio/mpeg");
  const { key, url, headers: h } = await call<{ key: string; url: string; headers: Record<string, string> }>(endpoint, { ...fields, action: "music", type, size: file.size });
  const res = await fetch(url, { method: "PUT", headers: h, body: file });
  if (!res.ok) throw new Error(`The bucket refused the music (${res.status}).`);
  await call(endpoint, { ...fields, action: "musicDone", key });
}

export { call as postJson };

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers(), credentials: "same-origin", cache: "no-store" });
  const out = await res.json().catch(() => ({ ok: false, error: `The server answered ${res.status}.` }));
  if (!res.ok || !out.ok) {
    const e = new Error(out.error || `The server answered ${res.status}.`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return out as T;
}
