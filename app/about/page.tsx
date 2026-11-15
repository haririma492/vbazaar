import AboutPage, { aboutMetadata } from "@/components/about/AboutPage";

// About us in Farsi (English is /en/about): components/about/AboutPage.tsx.
export const metadata = aboutMetadata("fa");

export default function About() {
  return <AboutPage lang="fa" />;
}
