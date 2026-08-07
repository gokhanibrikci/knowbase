import { getAllKnowledgeObjects, freshnessOf } from "@/lib/ko/store";
import { absoluteUrl, site } from "@/lib/site";

/**
 * llms.txt — a single entry point that tells a model what is here and how to fetch
 * any of it, without crawling the HTML. Format follows llmstxt.org.
 */
export const dynamic = "force-static";

export function GET() {
  const objects = getAllKnowledgeObjects();
  const domains = [...new Set(objects.map((ko) => ko.domain))].sort();

  const lines: string[] = [];

  lines.push(`# ${site.name}`, "");
  lines.push(`> ${site.description}`, "");
  lines.push(
    "Every entry is a Knowledge Object: one concrete failure, its root cause, the fix, the",
    "versions it applies to, the primary sources that back it, and the date it was last",
    "checked against them. Entries also state what they do *not* apply to.",
    "",
    "Any entry is available as JSON, Markdown, or plain text by appending an extension:",
    `${absoluteUrl("/k/<slug>.json")} · .md · .txt`,
    "",
    "License: CC-BY-4.0. Attribution is the canonical URL of the entry.",
    "",
  );

  for (const domain of domains) {
    lines.push(`## ${domain}`, "");
    for (const ko of objects.filter((o) => o.domain === domain)) {
      const fresh = freshnessOf(ko);
      lines.push(
        `- [${ko.title}](${absoluteUrl(`/k/${ko.slug}`)}): ${ko.summary.replace(/\s+/g, " ").trim()} (confidence: ${ko.confidence}, verified ${fresh.verifiedAt}, ${ko.evidence.length} sources)`,
      );
    }
    lines.push("");
  }

  lines.push("## Optional", "");
  lines.push(
    `- [Full corpus as Markdown](${absoluteUrl("/llms-full.txt")}): every entry concatenated, for a single fetch`,
    `- [Method](${absoluteUrl("/about")}): how entries are produced, sourced, and rated`,
    "",
  );

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
