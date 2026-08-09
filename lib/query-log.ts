import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { MatchReport } from "@/lib/ko/match";

/**
 * What was asked, and whether we could answer it.
 *
 * The failures are the reason this exists. A query we answer confirms the corpus is
 * doing its job; a query we miss is the only unfaked evidence of what is not in it
 * yet, and ranking those by frequency is what turns "write more entries" into a
 * queue. Read it with `npm run misses`.
 *
 * Deliberately not a feedback channel. Nothing written here can raise or lower a
 * published `confidence` — that is gated on evidence, and a second, weaker path to
 * the same label would make the label meaningless. This log decides what to research,
 * never what to claim.
 */

/** Analytics Engine caps a blob set at 5120 bytes; stay well under it. */
const MAX_QUERY_BYTES = 1024;
const MAX_UA_BYTES = 256;

/**
 * Agents paste whole tracebacks, and a traceback occasionally carries a bearer token
 * or a connection string. We keep the query text because reading what people asked is
 * the entire value of the log, so the least we can do is not persist the obvious
 * secrets inside it.
 */
function redact(text: string): string {
  return (
    text
      // Anything after a password/token/secret/key style label.
      .replace(/\b(pass(word)?|pwd|token|secret|api[-_]?key|authorization|bearer)\b\s*[:=]?\s*\S+/gi, "$1=[redacted]")
      // Long unbroken high-entropy runs: JWTs, hex digests, base64 blobs.
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
      // Credentials embedded in a URL: postgres://user:pw@host
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
  );
}

function clip(text: string, maxBytes: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > maxBytes ? `${trimmed.slice(0, maxBytes - 1)}…` : trimmed;
}

/**
 * Blob and double positions are the schema — the SQL in scripts/misses.ts reads them
 * by index, so append rather than reorder.
 *
 *   blob1 query   blob2 verdict   blob3 top slug   blob4 user agent   blob5 misses
 *   double1 top score   double2 results   double3 terms   double4 unmatched terms
 */
/**
 * A missing binding drops every row silently, which is the one failure mode that
 * looks exactly like "no agent has called us yet". Say it once per isolate so a
 * misconfigured deploy is visible in the logs rather than inferred months later
 * from an empty report.
 */
let warnedMissingBinding = false;

export function logQuery(query: string, report: MatchReport, userAgent: string): void {
  let dataset: AnalyticsEngineDataset | undefined;

  try {
    dataset = getCloudflareContext().env.QUERY_LOG;
  } catch {
    // No Cloudflare context: `next dev`, or a build-time render. Nothing to log to.
    return;
  }

  if (!dataset) {
    if (!warnedMissingBinding) {
      warnedMissingBinding = true;
      console.warn(
        "QUERY_LOG binding missing — /search.json telemetry is being discarded. " +
          "Check analytics_engine_datasets in wrangler.jsonc.",
      );
    }
    return;
  }

  const top = report.results[0];

  try {
    dataset.writeDataPoint({
      // The index is what Analytics Engine samples and groups on. Verdict keeps the
      // three buckets we actually report separable at any volume.
      indexes: [report.verdict],
      blobs: [
        clip(redact(query), MAX_QUERY_BYTES),
        report.verdict,
        top?.ko.slug ?? "",
        clip(userAgent, MAX_UA_BYTES),
        clip(report.unmatchedTerms.join(" "), 256),
      ],
      doubles: [
        top?.score ?? 0,
        report.results.length,
        report.terms.length,
        report.unmatchedTerms.length,
      ],
    });
  } catch {
    // Telemetry must never take the endpoint down with it.
  }
}
