import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/operator/", "/stores/"] }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
