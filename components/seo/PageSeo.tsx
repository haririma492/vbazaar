import { pageJsonLd } from "@/lib/seo";

// What search needs on a full-screen 3D page (olgoo-com's "Masoud SEO
// standards"): one H1 with the page's term, and one JSON-LD @graph. The 3D
// fills the screen, so the H1 is for screen readers and search only.
export default function PageSeo({ h1, path, title, description }: { h1: string; path: string; title: string; description: string }) {
  return (
    <>
      <h1 className="sr-only">{h1}</h1>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd({ path, title, description })) }} />
    </>
  );
}
