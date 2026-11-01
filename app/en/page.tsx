import VcaHome, { homeMetadata } from "@/components/home/VcaHome";

// The home page in English (Farsi is /).
// The places and stores are read from the bucket: fresh within a minute of a change.
export const revalidate = 60;
export const metadata = homeMetadata("en");

export default function HomePageEn() {
  return <VcaHome lang="en" />;
}
