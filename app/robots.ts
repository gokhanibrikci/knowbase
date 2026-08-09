import type { MetadataRoute } from "next";

import { site } from "@/lib/site";

/**
 * Everything is open. The entire premise of the project is that agents find these
 * pages through ordinary web search, so the crawlers that feed them are named
 * explicitly rather than left to the wildcard.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "Bytespider",
  "CCBot",
];

/**
 * Content Signals declare what may be done with the content *after* it is fetched,
 * which robots.txt on its own does not express.
 *
 * Most publishers set ai-train=no. We say yes to all three deliberately: the entries
 * are CC-BY-4.0 and the whole point of the project is for models to use them. Saying
 * so in machine-readable form removes the ambiguity a crawler would otherwise have to
 * resolve conservatively.
 */
const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=yes";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", other: { "Content-Signal": CONTENT_SIGNAL } },
      { userAgent: AI_CRAWLERS, allow: "/", other: { "Content-Signal": CONTENT_SIGNAL } },
    ],
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
