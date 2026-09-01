import type { NextConfig } from "next";

const MARKDOWN_ACCEPT = ".*text/(x-)?markdown.*";

/**
 * Crawlers that feed a model, and are therefore better served the Markdown twin.
 *
 * The measurement that motivates this: one entry is ~107 KB of HTML against ~8 KB
 * of Markdown, and 65% of the HTML is the RSC hydration payload — a second copy of
 * the same content, for a client that will never hydrate anything. An agent
 * fetching the page pays roughly 26,800 tokens to receive 2,500 tokens of answer.
 *
 * Googlebot, bingbot and GoogleOther are deliberately absent. Varying content by
 * user-agent is what cloaking looks like from a search engine's side, and nothing
 * here is worth putting ranking at risk for. The bots below do not rank us.
 *
 * Both kinds are included: the ones that ingest for training, and the ones fetching
 * live on behalf of a user. Context is scarcest for the second, so it benefits most.
 */
const AI_CRAWLER_UA = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "Applebot-Extended",
  "meta-externalagent",
  "Bytespider",
  "Amazonbot",
  "CCBot",
].join("|");

const AI_CRAWLER_PATTERN = `.*(${AI_CRAWLER_UA}).*`;

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
          has: [{ type: "header", key: "accept", value: MARKDOWN_ACCEPT }],
          destination: "/llms.txt",
        },
        {
          source: "/k/:slug",
          has: [{ type: "header", key: "accept", value: MARKDOWN_ACCEPT }],
          destination: "/k/:slug/md",
        },

        // The same two rules again, for clients that want the cheap rendition but do
        // not know to ask. Asking is rare; every crawler below sends `Accept: */*`.
        {
          source: "/",
          has: [{ type: "header", key: "user-agent", value: AI_CRAWLER_PATTERN }],
          destination: "/llms.txt",
        },
        {
          source: "/k/:slug",
          has: [{ type: "header", key: "user-agent", value: AI_CRAWLER_PATTERN }],
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
        source: "/:path((?!_next/static|search\\.json|diagnose\\.json|outcome\\.json|mcp|square\\.json|citizen\\.json|world|a/).*)",
        headers: [
          {
            key: "cache-control",
            value: "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      /**
       * These two routes answer differently depending on Accept *and* User-Agent — see
       * the beforeFiles rewrites. Without Vary a shared cache would store the Markdown
       * a crawler was served and hand it to the next browser that asked for the page.
       *
       * Varying on user-agent normally wrecks a cache, because it fragments by every
       * distinct string. It is affordable here: every one of these routes is
       * prerendered and served out of the Worker's own asset bundle, so a miss costs
       * an asset read rather than a render, and s-maxage is only five minutes anyway.
       *
       * Next sets its own Vary for RSC; these are appended to it.
       */
      {
        source: "/k/:slug",
        headers: [{ key: "vary", value: "accept, user-agent" }],
      },
      {
        source: "/",
        headers: [{ key: "vary", value: "accept, user-agent" }],
      },
    ];
  },
};

export default nextConfig;
