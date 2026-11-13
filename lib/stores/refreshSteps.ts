// «Refresh all agents»: the steps' names, in order, and which of them a run leaves out (owner, 2026-11-13: "allow
// operator to skip a step in Refresh all agents even in the middle of execution or before"). Pure: the card and
// the run (`refreshAll.ts`) both read it. Tested.
export const REFRESH_STEPS = ["Door photo", "Shelf finder (new shelves)", "Store map", "Shelf Tour", "Title reader", "Spine reader", "Zoom photos"] as const;
export type RefreshStepName = (typeof REFRESH_STEPS)[number];
export const SKIPPED_NOTE = "Skipped by the operator.";
/** What the operator asked to leave out, as step names the run knows (anything else is dropped). */
export function skipList(v: unknown): RefreshStepName[] {
  const all = REFRESH_STEPS as readonly string[];
  return Array.isArray(v) ? REFRESH_STEPS.filter((n) => v.includes(n) && all.includes(n)) : [];
}
/** Where each step of a run stands, for the card: every step is listed, the ones not reached yet too. */
export function stepStates(run: { steps: Array<{ name: string; note: string }>; running: boolean; skip?: string[] } | null): Array<{ name: RefreshStepName; state: "waiting" | "working" | "skipped" | "done" | "failed" | "off"; note: string }> {
  return REFRESH_STEPS.map((name) => {
    const s = run?.steps.find((x) => x.name === name);
    if (!s) return { name, state: run?.skip?.includes(name) ? "skipped" : run?.running ? "waiting" : "off", note: run?.skip?.includes(name) ? (run.running ? "Will be skipped." : SKIPPED_NOTE) : "" };
    const state = s.note === "working…" ? "working" : s.note.startsWith(SKIPPED_NOTE) ? "skipped" : /^Failed|Stopped|budget/i.test(s.note) ? "failed" : "done";
    return { name, state, note: s.note };
  });
}
