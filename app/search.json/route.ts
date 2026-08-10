import { isPlaceholderQuery, matchKnowledgeObjects, type MatchVerdict } from "@/lib/ko/match";
import { SCHEMA_VERSION } from "@/lib/ko/serialize";
import { freshnessOf, getAllKnowledgeObjects } from "@/lib/ko/store";
import { logQuery, newLookupId } from "@/lib/query-log";
import { absoluteUrl, site } from "@/lib/site";

/**
 * Lookup for agents: paste an error, get the entries that cover it.
 *
 * Until this existed, an entry was only reachable by knowing its slug or by crawling
 * the index — which meant the site could be read at crawl time but not consulted
 * mid-task. This is the missing primitive, and the queries it fails are what tell us
 * which entry to write next.
 *
 * What it deliberately does not do is return a best-effort nearest entry when nothing
 * really matches. A near-miss answer to a production failure is worse than no answer,
 * and "we do not cover this" is a useful thing for an agent to be told plainly.
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
/** A whole traceback is a legitimate query; a megabyte of one is not. */
const MAX_QUERY_LENGTH = 8000;

const GUIDANCE: Record<MatchVerdict, string> = {
  strong:
    "One entry clearly covers this error. Check its notApplicableTo before applying it — that field names the near misses this entry is most often confused with.",
  partial:
    "No entry clearly covers this query. The results are related but may address a different failure; treat them as leads to verify, not as the answer, and check notApplicableTo on each.",
  none: "No entry in this corpus covers this error. Do not treat anything here as an answer to it.",
};

function usage(status: number, error?: string) {
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      ...(error ? { error } : {}),
      usage: {
        endpoint: absoluteUrl("/search.json"),
        parameters: {
          q: "required. An error message, error code, or a pasted stack trace.",
          limit: `optional. 1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}.`,
        },
        example: absoluteUrl("/search.json?q=deadlock+detected"),
        match: {
          strong: GUIDANCE.strong,
          partial: GUIDANCE.partial,
          none: GUIDANCE.none,
        },
      },
      corpusSize: getAllKnowledgeObjects().length,
      license: "CC-BY-4.0",
      source: site.url,
    },
    { status, headers: CORS },
  );
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  // Repeat queries are the frequency signal that ranks the authoring queue, so a
  // cached response would quietly delete the most valuable thing this route produces.
  "cache-control": "no-store",
} as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);

  if (!query.trim()) return usage(400, "missing required parameter: q");

  // Answered before matching, and never logged: a placeholder is a client that has
  // not filled the template in, not a question anyone asked. Matching it would hand
  // back a near miss, and logging it would put a phantom on the authoring queue.
  if (isPlaceholderQuery(query)) {
    return usage(
      400,
      `q looks like an unsubstituted placeholder (${query.trim()}) — replace it with the actual error text`,
    );
  }

  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_LIMIT
    : Math.min(MAX_LIMIT, Math.max(1, parsedLimit));

  const all = getAllKnowledgeObjects();
  const report = matchKnowledgeObjects(all, query);
  const lookupId = newLookupId();

  logQuery(query, report, request.headers.get("user-agent") ?? "", lookupId);

  // On "none" the ranked list is noise by definition — withholding it is the point.
  const results = report.verdict === "none" ? [] : report.results.slice(0, limit);

  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      query,
      lookupId,
      match: report.verdict,
      guidance: GUIDANCE[report.verdict],
      /**
       * Named here rather than left to be discovered: an entry lists several causes,
       * and telling them apart is the work. Reporting what the discriminators
       * returned costs the caller nothing it was not already doing, and it is the
       * only way anyone learns which cause actually fires in the field.
       */
      nextStep:
        report.verdict === "none"
          ? null
          : {
              endpoint: absoluteUrl("/diagnose.json"),
              method: "POST",
              body: { lookupId, slug: "<id of the result you are working>", observations: "<what the discriminators returned>" },
              returns: "the cause your observations identify, and why the others are ruled out",
            },
      /** The informative terms we searched on, after dropping filler. */
      terms: report.terms,
      /** Query terms occurring nowhere in the corpus — why a miss is a miss. */
      unmatchedTerms: report.unmatchedTerms,
      totalMatches: report.verdict === "none" ? 0 : report.results.length,
      results: results.map(({ ko, score, matchedTerms }) => {
        const fresh = freshnessOf(ko);
        return {
          id: ko.slug,
          url: absoluteUrl(`/k/${ko.slug}`),
          score: Number(score.toFixed(3)),
          matchedTerms,
          title: ko.title,
          summary: ko.summary,
          domain: ko.domain,
          errorSignature: ko.error.signature,
          appliesTo: ko.appliesTo.technology.map((t) => `${t.name} ${t.versions}`),
          // The discriminators are the actionable part of an entry — the cheap checks
          // that say which cause you have. Inlining them is what makes /diagnose.json
          // usable without a second fetch, and running them is the work an agent was
          // going to do anyway.
          rootCauses: ko.rootCauses.map((c) => ({
            cause: c.cause,
            weight: c.weight,
            discriminator: c.discriminator,
          })),
          // Inlined rather than left to a follow-up fetch: this is the endpoint where
          // the risk of applying a near-miss is highest, and ruling an entry out
          // should not cost a second request.
          notApplicableTo: ko.notApplicableTo,
          confidence: ko.confidence,
          verifiedAt: fresh.verifiedAt,
          freshness: fresh.status,
          sources: ko.evidence.length,
          formats: {
            json: absoluteUrl(`/k/${ko.slug}.json`),
            markdown: absoluteUrl(`/k/${ko.slug}.md`),
            text: absoluteUrl(`/k/${ko.slug}.txt`),
          },
        };
      }),
      corpusSize: all.length,
      license: "CC-BY-4.0",
      source: site.url,
    },
    { headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
