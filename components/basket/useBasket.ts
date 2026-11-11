"use client";

/**
 * The basket on this device (`lib/basket.ts`): read after the page is up (so
 * the server's page and the first paint agree), kept in step across tabs, and
 * every change written straight back. Never throws: a browser that refuses
 * storage gets a basket that lasts the visit.
 */

import { useCallback, useEffect, useState } from "react";
import { track } from "@/lib/visitors/track";
import { BASKET_KEY, OLD_OFFLINE_KEY, addLine, parseBasket, setQty as setQtyOf, type BasketLine } from "@/lib/basket";

const EVENT = "vbazaar-basket";

function read(): BasketLine[] {
  try {
    let lines = parseBasket(window.localStorage.getItem(BASKET_KEY));
    // The offline demo's earlier basket, folded in once.
    const old = window.localStorage.getItem(OLD_OFFLINE_KEY);
    if (old) {
      for (const l of parseBasket(old)) lines = addLine(lines, l, l.qty);
      window.localStorage.setItem(BASKET_KEY, JSON.stringify(lines));
      window.localStorage.removeItem(OLD_OFFLINE_KEY);
    }
    return lines;
  } catch {
    return [];
  }
}

function write(lines: BasketLine[]) {
  try { window.localStorage.setItem(BASKET_KEY, JSON.stringify(lines)); } catch { /* the visit keeps it */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Add a line from anywhere (the walk's product card); returns how many items the basket now holds. */
export function addToBasket(line: Omit<BasketLine, "qty" | "at">, qty = 1): number {
  const next = addLine(read(), line, qty);
  write(next);
  track("basket-add");
  return next.reduce((n, l) => n + l.qty, 0);
}

export function useBasket() {
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => setLines(read());
    sync();
    setReady(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const setQty = useCallback((id: string, qty: number) => write(setQtyOf(read(), id, qty)), []);
  const clear = useCallback(() => write([]), []);
  return { lines, ready, setQty, clear };
}
