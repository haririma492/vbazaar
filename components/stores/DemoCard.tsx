"use client";

/**
 * «Demo names and prices» (owner, 2026-11-10: "for the sake of demo, add a key on each store page to add arbitrary
 * title & prices on all items that have green light"). The operator's key: every product shown to shoppers takes a
 * made-up name if it has none and a made-up price if it has none, fitting the store's kind (`lib/stores/demoFill.ts`).
 * A name or a price that is there is never changed. It asks first, saying how many and showing a few; «Remove»
 * takes the made-up ones away again. Free.
 */

import { useCallback, useEffect, useState } from "react";
import { postJson } from "./upload";
import { Bi, Card, KEY, QUIET, Said } from "./ui";

type Count = { filled: number; skipped: number; lit: number; demo: number; say: string; sample?: string[] };

export default function DemoCard({ api, onChange }: { api: string; onChange: () => Promise<void> | void }) {
  const [count, setCount] = useState<Count | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setCount(await postJson<Count>(api, { action: "demoFill" })); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function fill() {
    if (!count?.filled) return;
    const few = count.sample?.length ? ` For example: ${count.sample.join("; ")}.` : "";
    if (!confirm(`Give ${count.filled} products a made-up name where they have none and a made-up price where they have none, as for ${count.say}?${few} A name or a price that is already there is not changed. Shoppers will see these names and prices on the walk until you remove them.`)) return;
    setBusy(true);
    try {
      const j = await postJson<Count>(api, { action: "demoFill", apply: true });
      setSaid({ ok: true, text: `✓ Saved: ${j.filled} products took a demo name or price. · ذخیره شد` });
      await load(); await onChange();
    } catch (e) { setSaid({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    setBusy(false);
  }
  async function clear() {
    if (!count?.demo || !confirm(`Remove the demo names and prices from ${count.demo} products? Only what was made up goes. Names and prices the owner gave are not touched.`)) return;
    setBusy(true);
    try {
      const j = await postJson<{ cleared: number }>(api, { action: "demoClear" });
      setSaid({ ok: true, text: `✓ Removed from ${j.cleared} products. · برداشته شد` });
      await load(); await onChange();
    } catch (e) { setSaid({ ok: false, text: `Not removed: ${(e as Error).message}` }); }
    setBusy(false);
  }

  return (
    <Card>
      <Bi fa="نام و قیمت نمایشی" en="Demo names and prices" className="text-[16px] font-bold" />
      <p dir="ltr" className="mt-1 text-left text-[13px] text-white/60">
        {count
          ? `${count.lit} products are shown to shoppers. ${count.filled} of them lack a name or a price and can take made-up ones that fit ${count.say}; ${count.skipped} have both.${count.demo ? ` ${count.demo} carry a demo name or price now.` : ""}`
          : "Counting…"}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={KEY} disabled={busy || !count?.filled} onClick={() => void fill()}>🏷️ نام و قیمت نمایشی بگذار · Add demo names and prices</button>
        {Boolean(count?.demo) && <button type="button" className={QUIET} disabled={busy} onClick={() => void clear()}>Remove them ({count?.demo}) · برداشتن</button>}
      </div>
      {said && <Said ok={said.ok} text={said.text} />}
    </Card>
  );
}
