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
export function redact(text: string): string {
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
 *   blob1 query  blob2 verdict  blob3 top slug  blob4 user agent  blob5 misses
 *   blob6 lookup id
 *   double1 top score  double2 results  double3 terms  double4 unmatched terms
 */

/**
 * A missing binding drops every row silently, which is the one failure mode that
 * looks exactly like "no agent has called us yet". Say it once per isolate so a
 * misconfigured deploy is visible in the logs rather than inferred months later
 * from an empty report.
 */
let warnedMissingBinding = false;

function sinkFor(name: "QUERY_LOG" | "REPORT_LOG"): AnalyticsEngineDataset | undefined {
  let binding: AnalyticsEngineDataset | undefined;

  try {
    binding = getCloudflareContext().env[name];
  } catch {
    // No Cloudflare context: `next dev`, or a build-time render. Nothing to log to.
    return undefined;
  }

  if (!binding && !warnedMissingBinding) {
    warnedMissingBinding = true;
    console.warn(
      `${name} binding missing — telemetry is being discarded. ` +
        "Check analytics_engine_datasets in wrangler.jsonc.",
    );
  }

  return binding;
}

/**
 * Ties a later report back to the question that produced it without needing to know
 * who is asking. An id that was never issued joins to nothing, which is what lets
 * the reporting endpoints stay open: forging one buys the sender no effect.
 */
export function newLookupId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function logQuery(
  query: string,
  report: MatchReport,
  userAgent: string,
  lookupId: string,
): void {
  const sink = sinkFor("QUERY_LOG");
  if (!sink) return;

  const top = report.results[0];

  try {
    sink.writeDataPoint({
      // The index is what Analytics Engine samples and groups on. Verdict keeps the
      // three buckets we actually report separable at any volume.
      indexes: [report.verdict],
      blobs: [
        clip(redact(query), MAX_QUERY_BYTES),
        report.verdict,
        top?.ko.slug ?? "",
        clip(userAgent, MAX_UA_BYTES),
        clip(report.unmatchedTerms.join(" "), 256),
        lookupId,
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

export type Report =
  | {
      kind: "diagnosis";
      lookupId: string;
      slug: string;
      /** The identified cause, or "" when the observations did not discriminate. */
      cause: string;
      /** How far clear of the runner-up that cause was, 0..1. */
      lead: number;
      observations: string;
    }
  | {
      kind: "outcome";
      lookupId: string;
      slug: string;
      worked: boolean;
      note: string;
    }
  | {
      kind: "completion";
      lookupId: string;
      slug: string;
      causeId: string;
      resolutionId: string;
      /** Deterministic receipt or attempt id; group on this to deduplicate retries. */
      outcomeId: string;
      status: "resolved" | "unresolved" | "verification_inconclusive";
      koRevision: string;
      criteriaMet: number;
      criteriaTotal: number;
    };

/**
 * What an agent found when it went and checked.
 *
 *   blob1 kind  blob2 lookup id  blob3 slug  blob4 cause
 *   blob5 observations or note  blob6 user agent
 *   blob7 completion receipt/attempt id  blob8 completion status  blob9 KO revision
 *   blob10 cause resolution id
 *   double1 lead (diagnosis), worked as 0/1 (outcome), or resolved as 0/1
 *   double2 completion criteria met  double3 completion criteria total
 *
 * Same boundary as the query log, restated because this is the file where it would
 * be tempting to cross: nothing written here can raise or lower a published
 * `confidence`. That label is gated on evidence. These rows decide what to
 * re-research, never what the site claims.
 */
export function logReport(report: Report, userAgent: string): boolean {
  const sink = sinkFor("REPORT_LOG");
  if (!sink) return false;

  try {
    sink.writeDataPoint({
      indexes: [report.kind],
      blobs: [
        report.kind,
        report.lookupId,
        report.slug,
        report.kind === "diagnosis"
          ? clip(report.cause, 256)
          : report.kind === "completion"
            ? report.causeId
            : "",
        report.kind === "diagnosis"
          ? clip(redact(report.observations), MAX_QUERY_BYTES)
          : report.kind === "outcome"
            ? clip(redact(report.note), MAX_QUERY_BYTES)
            : "",
        clip(userAgent, MAX_UA_BYTES),
        report.kind === "completion" ? report.outcomeId : "",
        report.kind === "completion" ? report.status : "",
        report.kind === "completion" ? report.koRevision : "",
        report.kind === "completion" ? report.resolutionId : "",
      ],
      doubles:
        report.kind === "diagnosis"
          ? [report.lead, 0, 0]
          : report.kind === "outcome"
            ? [report.worked ? 1 : 0, 0, 0]
            : [report.status === "resolved" ? 1 : 0, report.criteriaMet, report.criteriaTotal],
    });
    return true;
  } catch {
    // Telemetry must never take the endpoint down with it.
    return false;
  }
}
