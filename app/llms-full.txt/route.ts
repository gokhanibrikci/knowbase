import { toMarkdown } from "@/lib/ko/serialize";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { site, isPrivate, orgName } from "@/lib/site";

/**
 * The whole corpus in one response, so a model can ingest everything in a single
 * fetch rather than crawling entry by entry.
 */
export const dynamic = "force-static";

export function GET() {
  const objects = getAllKnowledgeObjects();

  const header = [
    `# ${site.name} — full corpus`,
    "",
    site.description,
    "",
    `${objects.length} knowledge objects. ${isPrivate() ? `Private deployment for ${orgName()}.` : "License CC-BY-SA-4.0; attribute the canonical URL of each entry."}`,
    "",
    "---",
    "",
  ].join("\n");

  const body = objects.map((ko) => toMarkdown(ko)).join("\n---\n\n");

  return new Response(header + body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
