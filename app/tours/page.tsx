// vbazaar.app/tours — the first address of the stores' list; it is /walk now (owner, 2026-11-11: "for consistency
// also change this to /walk"). Kept so a link already given out still opens the list.
import { redirect } from "next/navigation";

export const metadata = { robots: { index: false, follow: false } };

export default function ToursPage() {
  redirect("/walk");
}
