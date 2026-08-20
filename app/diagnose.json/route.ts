import { diagnose } from "@/lib/ko/diagnose";
import { SCHEMA_VERSION } from "@/lib/ko/serialize";
import { getKnowledgeObject } from "@/lib/ko/store";
import { AGENT_INPUT_LIMITS } from "@/lib/mcp/contract";
import { logReport } from "@/lib/query-log";
import { absoluteUrl, site } from "@/lib/site";

/**
 * Which of an entry's causes the caller actually has.
 *
 * This is the half of the loop that gives something back. An entry lists four to six
 * causes, each with a cheap check that tells it apart; an agent working the failure
 * runs those checks regardless. Sending back what they returned costs it nothing and
 * buys a narrowed answer — one cause named, the rest ruled out with the reason.
 *
 * That it also produces the only record anywhere of which cause actually fires is the
 * by-product, not the pitch. A loop that asks agents to file reports for our benefit
 * would not get called twice.
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
        endpoint: absoluteUrl("/diagnose.json"),
        method: "POST",
        body: {
          lookupId: "optional. The id from the /search.json response that led you here.",
          slug: "required. The entry id you are working, e.g. kubernetes-imagepullbackoff.",
          observations:
            "required. What the discriminators returned — log lines, event text, command output.",
        },
        returns:
          "The cause your observations identify, its cause-specific resolution recipe when available, and the completion call that returns a receipt or next action.",
      },
      license: "CC-BY-4.0",
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

  const { lookupId, slug, observations } = (body ?? {}) as Record<string, unknown>;

  if (typeof slug !== "string" || !slug) return usage(400, "missing required field: slug");
  if (typeof observations !== "string" || !observations.trim()) {
    return usage(400, "missing required field: observations");
  }

  const ko = getKnowledgeObject(slug);
  if (!ko) return usage(404, `no entry with id: ${slug}`);

  const text = observations.slice(0, AGENT_INPUT_LIMITS.observationsCharacters);
  const result = diagnose(ko, text);
  const linkedLookupId =
    typeof lookupId === "string"
      ? lookupId.slice(0, AGENT_INPUT_LIMITS.lookupIdCharacters)
      : "";

  logReport(
    {
      kind: "diagnosis",
      lookupId: linkedLookupId,
      slug: ko.slug,
      cause: result.identified?.cause.cause ?? "",
      lead: result.identified ? result.identified.score - (result.ranked[1]?.score ?? 0) : 0,
      observations: text,
    },
    request.headers.get("user-agent") ?? "",
  );

  const [top, ...rest] = result.ranked;
  const identifiedCause = result.identified?.cause ?? null;
  const resolution = identifiedCause?.resolution ?? null;
  const stepsById = new Map(ko.solution.steps.map((step) => [step.id, step]));
  const resolutionSteps = resolution
    ? resolution.stepIds.map((id) => stepsById.get(id)).filter((step) => Boolean(step))
    : [];

  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      id: ko.slug,
      url: absoluteUrl(`/k/${ko.slug}`),
      lookupId: linkedLookupId || null,
      koRevision: ko.freshness.updated,
      identified: result.identified
        ? {
            causeId: result.identified.cause.id ?? null,
            cause: result.identified.cause.cause,
            weight: result.identified.cause.weight,
            detail: result.identified.cause.detail ?? null,
            discriminator: result.identified.cause.discriminator,
            matchedTerms: result.identified.matchedTerms,
          }
        : null,
      guidance: result.identified
        ? "Your observations point at one cause. The ruled-out list below is what to re-check if the fix does not hold."
        : top && top.score > 0
          ? "These observations do not separate the causes. The candidates below are ordered by fit — run the discriminator on each, then call again with what it returned."
          : "Nothing in these observations matches any discriminator for this entry. That may mean the entry is the wrong one; re-check notApplicableTo on the lookup result.",
      // Returned even when a cause is identified: naming what was excluded, and the
      // check that excludes it, is what makes the answer auditable rather than a guess.
      ruledOut: rest.map((r) => ({
        causeId: r.cause.id ?? null,
        cause: r.cause.cause,
        weight: r.cause.weight,
        discriminator: r.cause.discriminator,
        fit: Number(r.score.toFixed(3)),
      })),
      solution: {
        steps: ko.solution.steps,
        verification: ko.solution.verification,
        fallback: ko.solution.fallback ?? null,
      },
      identifiedResolution:
        resolution && identifiedCause?.id
          ? {
              causeId: identifiedCause.id,
              resolutionId: resolution.id,
              steps: resolutionSteps,
              verificationCriteria: resolution.verificationCriteria,
              fallback: resolution.fallback ?? null,
            }
          : null,
      notApplicableTo: ko.notApplicableTo,
      unrecognisedTerms: result.unmatchedTerms,
      completeResolution:
        resolution && identifiedCause?.id
          ? {
              endpoint: absoluteUrl("/outcome.json"),
              method: "POST",
              body: {
                lookupId: linkedLookupId || "<from the strong lookup>",
                slug: ko.slug,
                koRevision: ko.freshness.updated,
                causeId: identifiedCause.id,
                resolutionId: resolution.id,
                appliedStepIds: resolution.stepIds,
                criteria: resolution.verificationCriteria.map((criterion) => ({
                  id: criterion.id,
                  status: "<met|not_met|unknown|not_run>",
                  observation: "<what the check showed>",
                })),
              },
              returns:
                "Resolved returns an agent-observed receipt and final incident report. Otherwise it returns the failed or missing criterion and the next action. Do not claim resolved unless status is resolved.",
            }
          : null,
      legacyReportOutcome: {
        endpoint: absoluteUrl("/outcome.json"),
        method: "POST",
        body: {
          lookupId: linkedLookupId || "<from the lookup>",
          slug: ko.slug,
          worked: "<true|false>",
        },
        note: "Compatibility only. This records a claim and cannot return a resolved receipt.",
      },
      license: "CC-BY-4.0",
      source: site.url,
    },
    { headers: CORS },
  );
}

export function GET() {
  return usage(405, "use POST");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
