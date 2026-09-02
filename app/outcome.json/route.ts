import { completeResolution } from "@/lib/ko/complete-resolution";
import { SCHEMA_VERSION } from "@/lib/ko/serialize";
import { absoluteUrl, site } from "@/lib/site";

/**
 * Close a resolution, or accept the legacy worked:boolean claim.
 *
 * Kept as small as it is on purpose. The signal is weak and we know why: there is no
 * attribution (the agent may have solved it from its own weights and called anyway),
 * only successes tend to come back, and nothing here is verifiable. So it is recorded
 * as a lead for re-verification and nothing else.
 *
 * In particular it does not touch `confidence`. Usage is popularity, not evidence,
 * and a second path to the same label would empty the label of meaning. What this
 * does earn is a place in the re-check queue: an entry collecting "did not work"
 * against a specific version is worth a human reading its sources again.
 *
 * Structured completion is the value exchange: the caller gets either a deterministic
 * agent-observed receipt and ready-to-use final report, or the failed/missing check
 * and the next action. Legacy worked:boolean remains accepted, but never becomes a
 * resolved receipt.
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
        legacyCompatibility: {
          slug: "required. The entry you applied.",
          worked: "required boolean. Records a claim; never returns a resolved receipt.",
          lookupId: "optional.",
          note: "optional.",
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
