/**
 * THE STORE'S OWN LOGO, AT THE TOP LEFT OF ITS TOURS (owner, 2026-11-06: "on the new store registration canvas
 * lets add store logo also and accept a paste from clipboard and place that on the top left of the virtual tour").
 * The bazaar's logo is on the right (`BrandBadge`). On a light backing, since most logos are drawn on white.
 */
export default function StoreLogo({ src, className = "" }: { src: string; className?: string }) {
  return (
    <div className={`pointer-events-none rounded-xl bg-white/90 p-1 shadow-lg ${className}`}>
      <img src={src} alt="" className="block h-14 w-auto max-w-[9rem] object-contain sm:h-16" />
    </div>
  );
}
