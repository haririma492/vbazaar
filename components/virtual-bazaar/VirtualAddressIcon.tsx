/**
 * THE VIRTUAL ADDRESS'S MARK — a Persian arch (the bazaar's gate) with a
 * location pin in its doorway: "a door you can visit". Drawn on the same 24px
 * grid and stroke as the usual contact icons, so it sits in a row with X,
 * Facebook, Instagram and a phone number; `currentColor`, so it takes the
 * colour of the text beside it. The same drawing, in the house teal, is
 * `public/icons/virtual-address.svg` for use outside React.
 */
export default function VirtualAddressIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4.5 21V11.2Q4.5 6 12 2.5Q19.5 6 19.5 11.2V21" />
      <path d="M2.5 21h19" />
      <path d="M12 18s-3.2-3-3.2-5.4a3.2 3.2 0 0 1 6.4 0C15.2 15 12 18 12 18z" />
      <circle cx="12" cy="12.6" r="1.1" />
    </svg>
  );
}
