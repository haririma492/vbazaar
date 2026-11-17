/**
 * «🛒 SHELF TOUR | 👣 FREE TOUR», THE SAME IN BOTH TOURS' HEADERS (owner, 2026-11-17: "make the header of both tours
 * consistent and similar, move 🛒 Shelf Tour | 👣 Free Tour from free tour also to header"). At the top right, left of
 * the sound key and the bazaar's arch; on a phone under them. The tour in view is lit; the other is a link.
 */
export default function TourSwitch({ on, shelfHref, freeHref, className = "" }: { on: "shelf" | "free"; shelfHref?: string | null; freeHref?: string | null; className?: string }) {
  const lit = "whitespace-nowrap rounded-full bg-[#00B8C8] px-2.5 py-1 text-[#06131c] sm:px-3";
  const link = "whitespace-nowrap rounded-full px-2.5 py-1 text-white/80 hover:text-white sm:px-3";
  return (
    <div dir="ltr" className={`absolute right-3 top-[4.6rem] z-30 flex items-center rounded-full border border-white/25 bg-black/70 p-1 text-[12px] font-semibold text-white sm:right-[9rem] sm:top-3 sm:text-[13px] ${className}`}>
      {on === "shelf" ? <span className={lit}>🛒 Shelf Tour</span> : shelfHref ? <a className={link} href={shelfHref}>🛒 Shelf Tour</a> : null}
      {on === "free" ? <span className={lit}>👣 Free Tour</span> : freeHref ? <a className={link} href={freeHref}>👣 Free Tour</a> : null}
    </div>
  );
}
