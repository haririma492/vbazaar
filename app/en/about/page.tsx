import AboutPage, { aboutMetadata } from "@/components/about/AboutPage";

// About us in English (Farsi is /about): components/about/AboutPage.tsx.
export const metadata = aboutMetadata("en");

export default function AboutEn() {
  return <AboutPage lang="en" />;
}
