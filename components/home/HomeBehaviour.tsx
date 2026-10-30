"use client";

import { useEffect } from "react";

// What olgoo.com's site.js does on its VCA page, for the copy here: lines
// reveal as they scroll in, video tiles open the full-screen player, and the
// pilot form records a lead (through /api/lead, which hands it to olgoo.com).
export default function HomeBehaviour({ lang }: { lang: "fa" | "en" }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".vb-home");
    if (!root) return;
    const off: (() => void)[] = [];
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Document, ev: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(ev, fn as EventListener);
      off.push(() => el.removeEventListener(ev, fn as EventListener));
    };

    // Reveal
    const rv = root.querySelectorAll<HTMLElement>(".rv:not(.in)");
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
      }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
      rv.forEach((e) => io.observe(e));
      off.push(() => io.disconnect());
    } else rv.forEach((e) => e.classList.add("in"));

    // Video player
    const dlg = root.querySelector<HTMLDialogElement>("#player");
    const vid = root.querySelector<HTMLVideoElement>("#playerVideo");
    if (dlg && vid && dlg.showModal) {
      const close = () => { vid.pause(); vid.removeAttribute("src"); vid.load(); if (dlg.open) dlg.close(); };
      root.querySelectorAll<HTMLElement>(".hm-tile[data-video]").forEach((t) => on(t, "click", () => {
        vid.src = t.dataset.video || ""; vid.setAttribute("aria-label", t.dataset.title || "");
        dlg.showModal(); vid.play().catch(() => {});
      }));
      const x = root.querySelector<HTMLElement>("#playerClose");
      if (x) on(x, "click", close);
      on(dlg, "click", (e) => { if (e.target === dlg) close(); });
      on(dlg, "close", () => vid.pause());
    }

    // Pilot form
    const form = root.querySelector<HTMLFormElement>("#leadForm");
    if (form) {
      const btn = root.querySelector<HTMLButtonElement>("#leadBtn")!;
      const ok = root.querySelector<HTMLElement>("#leadOk")!, err = root.querySelector<HTMLElement>("#leadErr")!;
      const want = new URLSearchParams(location.search).get("offer");
      const pre = want && form.querySelector<HTMLInputElement>(`input[name="offer"][value="${want.replace(/[^a-z_]/g, "")}"]`);
      if (pre) pre.checked = true;
      on(form, "submit", async (e) => {
        e.preventDefault();
        const email = (root.querySelector<HTMLInputElement>("#leadEmail")?.value || "").trim();
        ok.textContent = ""; err.textContent = "";
        if (!email) { err.textContent = lang === "fa" ? "ایمیل خود را بنویسید." : "Enter your email."; return; }
        btn.disabled = true;
        try {
          const r = await fetch("/api/lead", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "launch", email,
              business: (root.querySelector<HTMLInputElement>("#leadBiz")?.value || "").trim(),
              offer: form.querySelector<HTMLInputElement>('input[name="offer"]:checked')?.value,
            }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || (lang === "fa" ? "مشکلی پیش آمد — دوباره امتحان کنید." : "Something went wrong — please try again."));
          ok.textContent = d.message || ""; btn.hidden = true;
        } catch (x) {
          err.textContent = (x as Error).message;
        } finally { btn.disabled = false; }
      });
    }
    return () => off.forEach((f) => f());
  }, [lang]);
  return null;
}
