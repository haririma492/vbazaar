import VcaHome, { homeMetadata } from "@/components/home/VcaHome";

// The home page in English (Farsi is /).
export const metadata = homeMetadata("en");

export default function HomePageEn() {
  return <VcaHome lang="en" />;
}
