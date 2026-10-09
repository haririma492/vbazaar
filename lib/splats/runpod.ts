/**
 * THE PART OF RUNPOD'S REST API v2 THE TRAINING USES (operator, 2026-10-09:
 * Modal wanted a payment method and pushed startup-credit forms, so the GPU
 * is rented from RunPod instead).
 *
 *   POST   /v2/pods        create a pod: one GPU type, our image, our command
 *   GET    /v2/pods/{id}   its status (PROVISIONING → STARTING → RUNNING,
 *                          EXITED, ERROR, TERMINATED) and its cost per hour
 *   DELETE /v2/pods/{id}   terminate it: the bill stops, the disk is gone
 *
 * Checked against RunPod's own OpenAPI file (github.com/runpod/docs,
 * api-reference-v2/openapi.json, 2026-10-09). v1 (rest.runpod.io/v1) is
 * retired on 2026-11-15, so v2 it is. Auth: `Authorization: Bearer <key>`.
 *
 * ⚠️ A POD IS NOT A JOB. It has no time limit, and when its command ends the
 * container is started again. The trainer (`train.ts`) terminates it, and
 * `gpu-train.sh` deletes its own pod when it ends and idles until then.
 *
 * ⚠️ CREATE DOES NOT SEARCH FOR CAPACITY: it places one GPU type or refuses.
 * The trainer tries a list of types in turn.
 *
 * Pure apart from the `fetch` passed in, so `node --test` runs it.
 */

export const RUNPOD_API = "https://api.runpod.io";

export type PodStatus = "PROVISIONING" | "STARTING" | "RUNNING" | "EXITED" | "ERROR" | "TERMINATED";

export type PodInfo = {
  id: string;
  status: PodStatus | string;
  /** USD per hour while it runs (RunPod's `cost`); null when not said. */
  cost: number | null;
};

/** The request body of POST /v2/pods, as far as the trainer fills it in. */
export type PodCreate = {
  name: string;
  cloud: "SECURE" | "COMMUNITY";
  gpu: { id: string; count: number };
  image: string;
  disk: number;
  entrypoint: string[];
  cmd: string[];
  env: Record<string, string>;
};

export type RunPodLike = {
  create(body: PodCreate): Promise<PodInfo>;
  /** Null when RunPod no longer knows the pod (404). */
  get(id: string): Promise<PodInfo | null>;
  /** Terminate it; a pod already gone is fine. */
  terminate(id: string): Promise<void>;
};

/** RunPod said no: its HTTP status and its own words. */
export class RunPodError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RunPodError";
    this.status = status;
  }
}

/** RunPod's ErrorResponse ({ title, status, detail, errors[] }) in a line. */
function reason(status: number, text: string): string {
  try {
    const o = JSON.parse(text) as { title?: unknown; detail?: unknown; errors?: unknown };
    const parts = [o.detail, o.title].filter((v): v is string => typeof v === "string" && v.length > 0);
    const errors = Array.isArray(o.errors) ? o.errors.filter((v): v is string => typeof v === "string").slice(0, 3) : [];
    const words = [parts[0], ...errors].filter(Boolean).join("; ");
    if (words) return `${words} (HTTP ${status})`;
  } catch {
    /* not JSON */
  }
  return `HTTP ${status}${text.trim() ? `: ${text.trim().slice(0, 200)}` : ""}`;
}

function podInfo(raw: unknown): PodInfo {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) throw new RunPodError(502, "RunPod answered without a pod id");
  return {
    id: o.id,
    status: typeof o.status === "string" ? o.status : "PROVISIONING",
    cost: typeof o.cost === "number" && Number.isFinite(o.cost) ? o.cost : null,
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

export function runpodClient(apiKey: string, fetchImpl: FetchLike, base = RUNPOD_API): RunPodLike {
  async function call(method: string, path: string, body?: unknown) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, text: await res.text() };
  }
  const pod = (id: string) => `/v2/pods/${encodeURIComponent(id)}`;
  return {
    async create(body) {
      const r = await call("POST", "/v2/pods", body);
      if (r.status !== 200 && r.status !== 201) throw new RunPodError(r.status, reason(r.status, r.text));
      return podInfo(JSON.parse(r.text));
    },
    async get(id) {
      const r = await call("GET", pod(id));
      if (r.status === 404) return null;
      if (r.status !== 200) throw new RunPodError(r.status, reason(r.status, r.text));
      return podInfo(JSON.parse(r.text));
    },
    async terminate(id) {
      const r = await call("DELETE", pod(id));
      if (r.status === 404 || (r.status >= 200 && r.status < 300)) return;
      throw new RunPodError(r.status, reason(r.status, r.text));
    },
  };
}
