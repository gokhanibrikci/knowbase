import { ruleMarkdown } from "@/lib/rule";
import { isPrivate, orgName, site } from "@/lib/site";

/**
 * The always-loaded rule, as this deployment should state it. A static file cannot know
 * whether the deployment it is served from publishes reports or keeps them private, so
 * the rule is rendered here from one template with the publication sentences filled in.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const priv = isPrivate();
  return new Response(ruleMarkdown(priv, orgName(), site.url), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // A private deployment's rule names the organisation and is not for a shared cache.
      "cache-control": priv ? "private, no-store" : "public, max-age=0, s-maxage=300",
      ...(priv ? {} : { "access-control-allow-origin": "*" }),
    },
  });
}
