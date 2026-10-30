import VcaHome, { homeMetadata } from "@/components/home/VcaHome";

// The home page of vbazaar.app, in Farsi: olgoo.com's VCA page carried here
// (components/home/VcaHome.tsx). English is /en. The demo screen is /demo.
export const metadata = homeMetadata("fa");

export default function HomePage() {
  return <VcaHome lang="fa" />;
}
