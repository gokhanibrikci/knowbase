import { toJson, toMarkdown, toPlainText } from "@/lib/ko/serialize";
import { getAllKnowledgeObjects, getKnowledgeObject } from "@/lib/ko/store";
import { absoluteUrl } from "@/lib/site";

/**
 * Machine-readable renditions of a knowledge object.
 *
 * Reachable both as /k/<slug>/<format> and, via a rewrite in next.config.ts, as
 * /k/<slug>.<ext> — the extension form is what the pages link to and what an agent
 * is most likely to guess.
 */

const FORMATS = ["json", "md", "txt"] as const;
type Format = (typeof FORMATS)[number];

const CONTENT_TYPES: Record<Format, string> = {
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllKnowledgeObjects().flatMap((ko) =>
    FORMATS.map((format) => ({ slug: ko.slug, format })),
  );
}

export async function GET(_request: Request, ctx: RouteContext<"/k/[slug]/[format]">) {
  const { slug, format } = await ctx.params;

  if (!FORMATS.includes(format as Format)) {
    return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain" } });
  }

  const ko = getKnowledgeObject(slug);
  if (!ko) {
    return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain" } });
  }

  const body =
    format === "json"
      ? `${JSON.stringify(toJson(ko), null, 2)}\n`
      : format === "md"
        ? toMarkdown(ko)
        : toPlainText(ko);

  return new Response(body, {
    headers: {
      "content-type": CONTENT_TYPES[format as Format],
      // Public knowledge, meant to be fetched by anything, including from a browser.
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      // Costs the reader no context at all, which is why the lookup endpoint is
      // named here as well as in the body: a client that fetched one entry from a
      // search result otherwise has no way to learn it could have asked for the
      // right one. `service-desc` points at the page describing all of it.
      link: [
        `<${absoluteUrl(`/k/${ko.slug}`)}>; rel="canonical"`,
        `<${absoluteUrl("/search.json")}>; rel="search"; type="application/json"`,
        `<${absoluteUrl("/agents")}>; rel="service-desc"`,
      ].join(", "),
      "x-knowbase-confidence": ko.confidence,
      "x-knowbase-verified-at": ko.freshness.verifiedAt,
    },
  });
}
