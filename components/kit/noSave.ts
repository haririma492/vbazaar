/**
 * KIT PHOTOS ARE NOT TO BE SAVED (owner, 2026-11-15: "we also need to make the photos (Type III, Type IV & Type V)
 * not downloadable"). On every kit photo a shopper sees: no «Save image» menu (right-click, or a long press on a
 * phone: `-webkit-touch-callout`), no dragging it out of the page. The addresses themselves expire within hours
 * (`signKit` in `lib/stores/kit.ts`). A screenshot cannot be stopped by any web page.
 */
import type { MouseEvent } from "react";

export const noSave = {
  draggable: false,
  onContextMenu: (e: MouseEvent) => e.preventDefault(),
  "data-nosave": "",
} as const;
