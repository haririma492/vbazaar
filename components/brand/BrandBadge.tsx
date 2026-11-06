/**
 * THE BAZAAR'S LOGO WITH «VBAZAAR.APP» UNDER IT (owner, 2026-11-06: "on all store tours and on store owner
 * screens add Vbazaar logo and VBAZAAR.APP under it on the right hand side"). One component, so every screen
 * draws it the same: the Free Tour (the 360° walk), the Shelf Tour and its photos, and the store owner's pages.
 * It links to the home page; `overlay` floats it over a full-screen picture with a dark backing.
 */
export default function BrandBadge({ width = 64, overlay = false, className = "" }: { width?: number; overlay?: boolean; className?: string }) {
  return (
    <a
      href="/"
      dir="ltr"
      aria-label="Virtual Bazaar · vbazaar.app"
      className={`flex shrink-0 flex-col items-center gap-0.5 ${overlay ? "rounded-lg bg-black/55 p-1 shadow-lg" : ""} ${className}`}
      style={{ width: width + (overlay ? 8 : 0) }}
    >
      <img src="/media/brand/vbazaar-logo-v2-1000.webp" alt="" width={width} height={Math.round(width * 0.734)} className="rounded" style={{ width, height: "auto" }} />
      <span className="whitespace-nowrap font-bold leading-none tracking-wide text-[#e8f5ec]" style={{ fontSize: Math.max(9, Math.round(width / 6.4)) }}>
        VBAZAAR.APP
      </span>
    </a>
  );
}
