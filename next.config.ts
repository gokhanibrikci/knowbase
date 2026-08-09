import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      /**
       * Content negotiation for agents.
       *
       * Every entry already exists as hand-shaped Markdown at /k/<slug>.md, generated
       * from the KO schema — no navigation, no footer, no repeated chrome. A client
       * asking for `Accept: text/markdown` should get that, not the HTML page.
       *
       * This lived in proxy.ts until it turned out that Next 16 proxies run on the
       * Node.js runtime, which @opennextjs/cloudflare refuses to bundle — and a proxy
       * file may not opt into the edge runtime, so there was nothing to configure.
       * Expressed as rewrites it needs no middleware at all and deploys unchanged.
       *
       * These must run beforeFiles: /k/<slug> is prerendered, so an afterFiles rule
       * would never be reached — the static page would resolve first.
       *
       * The q-value comparison the proxy did is gone; this matches on `text/markdown`
       * being asked for at all. No browser sends it, so the case it guarded against
       * does not arise in practice.
       */
      beforeFiles: [
        {
          // The index has no Markdown twin of its own; llms.txt is its structured form.
          source: "/",
          has: [{ type: "header", key: "accept", value: ".*text/(x-)?markdown.*" }],
          destination: "/llms.txt",
        },
        {
          source: "/k/:slug",
          has: [{ type: "header", key: "accept", value: ".*text/(x-)?markdown.*" }],
          destination: "/k/:slug/md",
        },
      ],

      // /k/<slug>.json is the URL an agent guesses; /k/<slug>/json is what the router
      // can express. The rewrite keeps the guessable form as the one we publish.
      afterFiles: [
        { source: "/k/:slug.json", destination: "/k/:slug/json" },
        { source: "/k/:slug.md", destination: "/k/:slug/md" },
        { source: "/k/:slug.txt", destination: "/k/:slug/txt" },
      ],
    };
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
        // The three agent endpoints are excluded because they must not be cached at
        // all, and a rule here silently overrides the one a route handler sets on
        // its own Response. Caching /search.json would drop repeat queries at the
        // edge — and repeat queries are exactly the frequency signal that ranks what
        // to write next.
        source: "/:path((?!_next/static|search\\.json|diagnose\\.json|outcome\\.json).*)",
        headers: [
          {
            key: "cache-control",
            value: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // These routes answer differently depending on Accept — see proxy.ts. Without
        // Vary, a shared cache would hand one representation to a client that asked
        // for the other. Next sets its own Vary for RSC, so this is appended to it.
        source: "/k/:slug",
        headers: [{ key: "vary", value: "accept" }],
      },
      {
        source: "/",
        headers: [{ key: "vary", value: "accept" }],
      },
    ];
  },
};

export default nextConfig;
