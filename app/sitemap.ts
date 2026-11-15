import type { MetadataRoute } from "next";
import { PAGES, SITE } from "@/lib/seo";

// Every indexed page: the home page and About us (Farsi and English), the walk, the 3D bazaar and its square.
// Shop and street addresses (/vb/<street>/<n>-<shop>) are noindex,follow: the
// same 3D scene, not pages of their own. Bump LASTMOD when these pages change.
const LASTMOD = "2026-11-15";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [PAGES.home.path, PAGES.homeEn.path, PAGES.about.path, PAGES.aboutEn.path, PAGES.walk.path, PAGES.bazaar3d.path, PAGES.address.path];
  return paths.map((p) => ({ url: `${SITE}${p}`, lastModified: LASTMOD }));
}
