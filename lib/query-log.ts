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
      // Credentials recognisable by their issuer's prefix, whatever their length: AWS
      // access keys, Google API keys, Slack, GitHub, OpenAI and Anthropic, Stripe, npm,
      // and our own. Every one of these was published verbatim by an earlier version,
      // because it was shorter than the high-entropy rule's forty characters or carried
      // a hyphen that broke the run.
      .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted]")
      .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted]")
      .replace(/\bxox[abeprs]-[0-9A-Za-z-]{10,}\b/g, "[redacted]")
      .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g, "[redacted]")
      .replace(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
      .replace(/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "[redacted]")
      .replace(/\bnpm_[A-Za-z0-9]{30,}\b/g, "[redacted]")
      .replace(/\bkbw_[0-9a-f]{32}\b/g, "[redacted]")
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted key]")
      // HTTP Basic credentials are base64 of user:password — a credential, not a word.
      .replace(/\b(basic)\s+[A-Za-z0-9+/=]{16,}/gi, "$1 [redacted]")
      // Tokens carried in a query string.
      .replace(/([?&](?:access_token|api_key|apikey|key|token|secret|sig|signature|password|pwd)=)[^&\s"']+/gi, "$1[redacted]")
      // A labelled credential — but only where something is actually being assigned.
      // Without the separator this ate ordinary prose: "after rotating the secret."
      // became "secret=[redacted]", and a sentence explaining where a token lives lost
      // its meaning while leaking nothing.
      // `bearer` is consumed as part of the label rather than left behind as the value:
      // "authorization: Bearer eyJ…" used to become "authorization=[redacted] eyJ…",
      // which redacted the word and published the token. The lookbehind replaces \b on
      // the left so MY_SECRET=… matches too — \b does not fire after an underscore.
      .replace(
        /(?<![A-Za-z0-9])(pass(word)?|pwd|token|secret|api[-_]?key|authorization)(?![A-Za-z0-9])\s*[:=]\s*(?:bearer\s+|basic\s+)?(\S+)/gi,
        "$1=[redacted]",
      )
      .replace(/\bbearer\s+[A-Za-z0-9_\-.+/=]{8,}/gi, "bearer [redacted]")
      // The same labels without a separator, where what follows still looks like a
      // credential rather than a word: long, unbroken, and not plain letters.
      .replace(
        /(?<![A-Za-z0-9])(pass(word)?|pwd|token|secret|api[-_]?key)(?![A-Za-z0-9])\s+([A-Za-z0-9_\-.+/=]{16,})/gi,
        "$1 [redacted]",
      )
      // A JWT's dots break the long-run rule below into short segments, so it is named.
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted]")
      // Long high-entropy runs: JWTs, hex digests, base64 blobs. A run that hyphens
      // break into short word-sized segments is prose — an entry slug, not a secret;
      // real blobs keep at least one long unbroken alphanumeric stretch. This started
      // to matter once redaction became part of published text: an entry slug like
      // /k/kubernetes-init-crashloopbackoff-init-error came out as /k/[redacted].
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, (run) =>
        run.split("-").some((segment) => segment.length >= 25) ? "[redacted]" : run,
      )
      // Credentials embedded in a URL: postgres://user:pw@host — and redis://:pw@host,
      // where the user is empty and the old rule let the password through.
      .replace(/([a-z][a-z0-9+.-]*:\/\/)(?:[^/\s:@]*:)?[^/\s@]+@/gi, "$1[redacted]@")
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
 *   blob5 observations  blob6 user agent
 *   blob7 completion receipt/attempt id  blob8 completion status  blob9 KO revision
 *   blob10 cause resolution id
 *   double1 lead (diagnosis) or resolved as 0/1 (completion)
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
        report.kind === "diagnosis" ? clip(redact(report.observations), MAX_QUERY_BYTES) : "",
        clip(userAgent, MAX_UA_BYTES),
        report.kind === "completion" ? report.outcomeId : "",
        report.kind === "completion" ? report.status : "",
        report.kind === "completion" ? report.koRevision : "",
        report.kind === "completion" ? report.resolutionId : "",
      ],
      doubles:
        report.kind === "diagnosis"
          ? [report.lead, 0, 0]
          : [report.status === "resolved" ? 1 : 0, report.criteriaMet, report.criteriaTotal],
    });
    return true;
  } catch {
    // Telemetry must never take the endpoint down with it.
    return false;
  }
}
