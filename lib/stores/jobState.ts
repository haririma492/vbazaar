// WHAT A BACKGROUND JOB IS DOING, WHERE THE DASHBOARD CAN SEE IT (2026-11-04).
// The jobs run in the server's start-up part and `/operator/agents` in a route:
// two copies of each module, so a "busy" flag in memory always read idle on the
// page. Each job writes its state to the bucket instead (`jobs/<id>.json`).
import { readMastersText, writeMastersJson } from "@/lib/splats/r2";

export type JobState = { busy: boolean; key: string | null; at: string; note?: string };

export async function setJob(id: string, state: Omit<JobState, "at">): Promise<void> {
  try { await writeMastersJson(`jobs/${id}.json`, { ...state, at: new Date().toISOString() }); } catch (e) { console.error("[job]", id, e); }
}
export async function readJob(id: string): Promise<JobState | null> {
  try { const t = await readMastersText(`jobs/${id}.json`); return t ? (JSON.parse(t) as JobState) : null; } catch { return null; }
}
