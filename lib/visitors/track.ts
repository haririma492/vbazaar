/**
 * The page's side of the visitor statistics: one id per tab, and the messages to `/api/visitors` that must get
 * out even as the tab closes (`sendBeacon`). `track("basket-add")` from anywhere counts a click; an element with
 * `data-track="name"` is counted by itself (`components/common/VisitorStats.tsx`). Never throws.
 */
const SID_KEY = "vb_sid";
let memorySid = "";

export function sessionId(): string {
  try {
    let sid = window.sessionStorage.getItem(SID_KEY);
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.sessionStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    // Private mode: the id lasts as long as the page.
    return (memorySid ||= Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
}

/** A journey message (not a heartbeat). */
export function beacon(payload: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({ ...payload, sid: sessionId(), beacon: true });
    if (navigator.sendBeacon?.("/api/visitors", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/visitors", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* counting never breaks the page */ }
}

/** Count a click by name (letters, digits, - . : /). */
export function track(name: string): void {
  if (typeof window === "undefined" || !name) return;
  beacon({ event: { name: String(name), page: window.location.pathname } });
}
