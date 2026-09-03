import { completeResolution } from "@/lib/ko/complete-resolution";
import { SCHEMA_VERSION } from "@/lib/ko/serialize";
import { absoluteUrl, site } from "@/lib/site";

/**
 * Close a resolution.
 *
 * Structured completion is the value exchange: the caller submits the checks it already
 * had to run and gets either a deterministic, agent-observed receipt with a paste-ready
 * summary, or the failed or missing check and the next action. Nothing here touches an
 * entry's `confidence` — usage is popularity, not evidence — but a run of unresolved
 * completions against one revision is what puts an entry in the re-verification queue.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function usage(status: number, error?: string) {
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      ...(error ? { error } : {}),
      usage: {
        endpoint: absoluteUrl("/outcome.json"),
        method: "POST",
        completeResolution: {
          lookupId: "required. The 16-character id from a strong lookup.",
          slug: "required. The entry diagnosed.",
          koRevision: "required. The entry updatedAt returned by diagnosis.",
          causeId: "required. The identified root cause id.",
          resolutionId: "required. The cause-specific recipe id.",
          appliedStepIds: "required. Every step id in that recipe.",
          criteria:
            "required array of {id,status:met|not_met|unknown|not_run,observation?,exitCode?}; met/not_met needs observation or exitCode.",
        },
        trustBoundary:
          "A receipt is agent_observed. Knowbase validates the current recipe and required statuses but does not inspect the environment or authenticate the lookup id.",
      },
      license: "CC-BY-SA-4.0",
      source: site.url,
    },
    { status, headers: CORS },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return usage(400, "body must be JSON");
  }

  const result = completeResolution(body, request.headers.get("user-agent") ?? "");

  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      ...result.body,
      license: "CC-BY-SA-4.0",
      source: site.url,
    },
    { status: result.httpStatus, headers: CORS },
  );
}

export function GET() {
  return usage(405, "use POST");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
