/** @type {import('next').NextConfig} */
const nextConfig = {
  // As at Sarekooche, where this app came from: the deploy does not re-run the
  // type or lint pass; `npm run typecheck` + `npm run build` gate it before push.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Which commit a page was built from (the splat viewer's Info tab). Railway sets the SHA.
  experimental: { serverComponentsExternalPackages: ["modal"] },
  env: { NEXT_PUBLIC_BUILD: (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || "local" },
  // The GPU kits in public/gpu are read by `curl … | bash` on a rented pod and
  // by a person in a browser: plain text, never stale after a fix.
  async headers() {
    return [{
      source: "/gpu/:file*",
      headers: [
        { key: "Content-Type", value: "text/plain; charset=utf-8" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Cache-Control", value: "no-cache" },
      ],
    }];
  },
};
module.exports = nextConfig;
