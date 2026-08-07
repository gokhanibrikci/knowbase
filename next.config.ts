import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /k/<slug>.json is the URL an agent guesses; /k/<slug>/json is what the router
  // can express. The rewrite keeps the guessable form as the one we publish.
  async rewrites() {
    return [
      { source: "/k/:slug.json", destination: "/k/:slug/json" },
      { source: "/k/:slug.md", destination: "/k/:slug/md" },
      { source: "/k/:slug.txt", destination: "/k/:slug/txt" },
    ];
  },

  /**
   * Next.js stamps prerendered pages with `s-maxage=31536000` because on Vercel the
   * platform purges them on deploy. Cloudflare has no such hook, so that header would
   * pin a year-old page at the edge — fatal for a site whose whole claim is that its
   * entries carry an honest verification date.
   *
   * Five minutes at the edge with a day of stale-while-revalidate keeps pages fast
   * while making a redeploy visible almost immediately. Hashed build assets under
   * /_next/static are content-addressed and keep their immutable caching.
   */
  async headers() {
    return [
      {
        source: "/:path((?!_next/static).*)",
        headers: [
          {
            key: "cache-control",
            value: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
