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
    "To find an entry from an error you are holding, rather than by reading this index:",
    `${absoluteUrl("/search.json?q=<error text>")}`,
    "",
    "Paste the error message, the error code, or the whole stack trace. The response",
    "carries a `match` field of strong, partial or none. On `none` the result list is",
    "empty on purpose: this corpus does not cover that failure, and a near-miss answer",
    "to a production error is worse than no answer. Every result also carries",
    "`notApplicableTo`, which names the failures it is most often confused with — read",
    "it before applying the fix.",
    "",
    "An entry lists several possible causes, each with a cheap check that tells it",
    "apart. Once you have run those checks, post what they returned:",
    `${absoluteUrl("/diagnose.json")}  {lookupId, slug, observations}`,
    "",
    "You get back the one cause your observations identify and the ruled-out causes",
    "with the check that rules each out — which the lookup alone cannot tell you.",
    "Optionally report whether the fix held:",
    `${absoluteUrl("/outcome.json")}  {lookupId, slug, worked}`,
    "",
    "Neither report can change what an entry claims. Confidence here is gated on",
    "evidence, never on use, so these only decide what gets re-checked and written next.",
    "",
    "The same three calls are available as an MCP server over Streamable HTTP:",
    `${absoluteUrl("/mcp")}`,
    "",
    "Tools: knowbase_lookup, knowbase_diagnose, knowbase_report_outcome. No auth.",
    "Both protocol eras are supported — per-request metadata (2026-07-28) and the",
    "older initialize handshake.",
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
    `- [Lookup by error](${absoluteUrl("/search.json?q=deadlock+detected")}): match a pasted error against the corpus, JSON`,
    `- [For agents](${absoluteUrl("/agents")}): the three endpoints, with worked examples`,
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
