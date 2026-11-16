/**
 * THE STORE'S OWN LOGO, AT THE TOP LEFT OF ITS TOURS (owner, 2026-11-06: "on the new store registration canvas
 * lets add store logo also and accept a paste from clipboard and place that on the top left of the virtual tour").
 * 15% smaller than it was (owner, 2026-11-16: "make the store logo 15% smaller"). The bazaar's logo is on the right (`BrandBadge`). On a light backing, since most logos are drawn on white.
 */
export default function StoreLogo({ src, className = "" }: { src: string; className?: string }) {
  return (
    <div className={`pointer-events-none rounded-xl bg-white/90 p-1 shadow-lg ${className}`}>
      <img src={src} alt="" className="block h-12 w-auto max-w-[7.65rem] object-contain sm:h-[3.4rem]" />
    </div>
  );
}
