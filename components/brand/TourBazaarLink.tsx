/**
 * THE LINK TO VBAZAAR.APP ON THE TOURS (owner, 2026-11-06: "on virtual tour lets replace the current logo with a
 * simple schematic sign of a bazar and make the active link really appear as ACTIVE"). Drawn on the Free Tour (the
 * 360° walk), the Shelf Tour and its photos; the store owner's page keeps `BrandBadge` with the full logo.
 *
 * The sign is a line drawing of a single pointed Persian arch, an iwan, in its frame (option C of four the owner
 * was shown). It is drawn as SVG in the link's own colour, so it is sharp at any size and needs no image.
 *
 * Owner, same day: no arrow; the arch in the green of the old logo's sign; the text warm white. Dark green lines
 * all but vanish on the badge's dark backing (looked at), so the arch sits on a small warm-white tile.
 *
 * Why it reads as a link: the address is underlined, the whole badge has a warm-white border, and hover /
 * keyboard focus light it up. It opens vbazaar.app in a NEW TAB with the
 * full address, so the shopper keeps their place in the tour, and an offline or olgoo.com copy still points at
 * vbazaar.app rather than its own host.
 */
/** The green of the sign «بازار مجازی تورنتو» on the old logo, read off its pixels. */
const SIGN_GREEN = "#214E3F";

export default function TourBazaarLink({ overlay = false, className = "" }: { overlay?: boolean; className?: string }) {
  return (
    <a
      href="https://vbazaar.app"
      target="_blank"
      rel="noopener"
      dir="ltr"
      title="Open vbazaar.app in a new tab"
      aria-label="Virtual Bazaar, open vbazaar.app in a new tab"
      className={`group flex shrink-0 cursor-pointer flex-col items-center gap-1 rounded-lg border border-[#FFF4E0]/70 px-2 py-1 text-[#FFF4E0] transition-colors hover:border-[#FFF4E0] hover:bg-[#FFF4E0]/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${overlay ? "bg-black/60 shadow-lg" : "bg-white/5"} ${className}`}
    >
      <span className="rounded bg-[#FFF4E0] px-[3px] py-px">
      <svg width="44" height="30" viewBox="0 0 44 30" fill="none" stroke={SIGN_GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* a single pointed Persian arch (an iwan) in its frame, on the ground line */}
        <path d="M8 28 V2 H36 V28" />
        <path d="M13 28 V15 Q13 9 22 5 Q31 9 31 15 V28" />
        <path d="M4 28 H40" />
        <path d="M8 6 H36" opacity="0.55" />
      </svg>
      </span>
      <span className="whitespace-nowrap text-[11px] font-bold leading-none tracking-wide underline decoration-2 underline-offset-2">
        vbazaar.app
      </span>
    </a>
  );
}
