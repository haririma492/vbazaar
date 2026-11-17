/**
 * THE BAZAAR'S MARK ON EVERY KIT PHOTO (owner, 2026-11-15: a web page cannot stop screenshots, so "add that watermark
 * with our address vbazaar.app and the arch logo"). Drawn OVER the photo on screen, so a screenshot carries it, while
 * the photo itself stays exactly as uploaded (the quality rule of the kit): the bazaar's arch (`app/icon.svg`,
 * `TourBazaarLink.tsx`) and «vbazaar.app» in a corner, and the same, faint, tiled across the whole photo so a crop
 * cannot cut it away. Never catches a tap. Placed inside a positioned box that holds the photo.
 */

const GREEN = "#214E3F";
const ARCH = "M8 2 H36 V28 H8 Z M13.5 28 V15 Q13.5 9.4 22 5.6 Q30.5 9.4 30.5 15 V28 Z";

/** The faint tile: the arch and the address, turned, white with a dark edge so it shows on light and dark photos. */
const TILE = (() => {
  const mark = (stroke: string, fill: string, sw: number) =>
    `<g transform="translate(26 92) rotate(-24)" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round">`
    + `<path fill-rule="evenodd" d="${ARCH}" transform="scale(0.9)"/>`
    + `<text x="46" y="22" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700">vbazaar.app</text></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="170">`
    + `<g opacity="0.2">${mark("#000", "none", 3)}</g><g opacity="0.3">${mark("none", "#fff", 0)}</g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
})();

const SIZES = {
  /** A large photo (the 3× photo, a shelf): a badge and the tile. */
  lg: { tile: 300, badge: "bottom-2 right-2 gap-1.5 rounded-lg px-2 py-1 text-[13px]", arch: 22 },
  /** A tray photo. */
  sm: { tile: 170, badge: "bottom-1 right-1 gap-1 rounded-md px-1.5 py-0.5 text-[10px]", arch: 14 },
  /** A product's small photo: the tile only and the arch. */
  xs: { tile: 120, badge: "bottom-0.5 right-0.5 rounded px-0.5 py-0.5", arch: 10 },
} as const;

// The address is not written in the corner of a section's photo (Type IV): the tray and the 3× photo (owner, 2026-11-16:
// "remove vbazaar.app from the corner of type IV photos"). The arch stays there, and the faint tile keeps the address.
// `sparse` (owner, 2026-11-17, of the Shelf Tour: "there are too many vbazaar.app watermark it is annoying"): the tile
// three times as far apart and half as strong, still across the whole photo so a crop cannot cut it all away.
export default function Watermark({ size = "lg", className = "", address = size === "lg", sparse = false }: { size?: keyof typeof SIZES; className?: string; address?: boolean; sparse?: boolean }) {
  const z = SIZES[size];
  const tile = sparse ? z.tile * 3 : z.tile;
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 select-none overflow-hidden ${className}`}>
      <div className="absolute inset-0" style={{ backgroundImage: TILE, backgroundSize: `${tile}px ${Math.round(tile * 170 / 300)}px`, backgroundRepeat: "repeat", opacity: sparse ? 0.5 : 1 }} />
      <div dir="ltr" className={`absolute flex items-center bg-[#FFF9EE]/85 font-bold leading-none shadow ${z.badge}`} style={{ color: GREEN }}>
        <svg width={z.arch} height={Math.round(z.arch * 30 / 44)} viewBox="0 0 44 30">
          <path fill={GREEN} fillRule="evenodd" d={ARCH} />
          <path d="M4 28 H40" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {address && <span>vbazaar.app</span>}
      </div>
    </div>
  );
}
