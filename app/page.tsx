import VcaHome, { homeMetadata } from "@/components/home/VcaHome";

// The home page of vbazaar.app, in Farsi: olgoo.com's VCA page carried here
// (components/home/VcaHome.tsx). English is /en. The demo screen is /demo.
// The places and stores are read from the bucket: fresh within a minute of a change.
export const revalidate = 60;
export const metadata = homeMetadata("fa");

export default function HomePage() {
  return <VcaHome lang="fa" />;
}
