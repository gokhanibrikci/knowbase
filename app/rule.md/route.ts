import { ruleMarkdown } from "@/lib/rule";
import { isPrivate, orgName } from "@/lib/site";

/**
 * The always-loaded rule, as this deployment should state it. A static file cannot know
 * whether the deployment it is served from publishes reports or keeps them private, so
 * the rule is rendered here from one template with the publication sentences filled in.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(ruleMarkdown(isPrivate(), orgName()), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
