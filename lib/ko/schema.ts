import { z } from "zod";

/**
 * A Knowledge Object (KO) is the atomic unit of knowbase: one concrete technical
 * failure, its root cause, and the verified fix.
 *
 * The schema is deliberately strict. A KO that cannot state which versions it
 * applies to, or which primary sources prove it, is not knowledge — it is a
 * blog post, and blog posts are what this site exists to replace.
 */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const KO_DOMAINS = [
  "kubernetes",
  "database",
  "api",
  "cloud",
  "devops",
  "framework",
  "language",
  "networking",
  "security",
] as const;

export const EVIDENCE_TYPES = [
  "official-docs",
  "specification",
  "source-code",
  "github-issue",
  "github-pr",
  "release-notes",
  "vendor-kb",
  "security-advisory",
] as const;

/** How strongly a listed cause explains the observed error in the wild. */
export const CAUSE_WEIGHTS = ["primary", "common", "edge"] as const;

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

const isoDate = z.iso.date();

export const evidenceSchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  title: z.string().min(3),
  url: z.url(),
  publisher: z.string().min(2),
  /** When a human or the pipeline last read this source end-to-end. */
  retrievedAt: isoDate,
  /** Which specific claim in this KO the source backs. Keeps evidence auditable. */
  supports: z.string().min(10),
  /**
   * Verbatim excerpt, required. This is what turns a citation from an assertion into
   * something checkable: `npm run verify:quotes` refetches the page and fails the
   * build unless these exact words are still on it. Kept under a sentence or two —
   * we cite, we do not republish.
   */
  quote: z.string().min(12).max(240),
});

export const rootCauseSchema = z.object({
  cause: z.string().min(8),
  detail: z.string().min(10).optional(),
  weight: z.enum(CAUSE_WEIGHTS),
  /**
   * The cheap check that tells a reader whether this is the cause they have.
   * Required: a list of possible causes without a way to tell them apart is a
   * search result, not an answer.
   */
  discriminator: z.string().min(8),
});

export const solutionStepSchema = z.object({
  instruction: z.string().min(6),
  command: z.string().optional(),
  code: z.string().optional(),
  language: z.string().optional(),
  note: z.string().optional(),
});

export const appliesToSchema = z.object({
  technology: z
    .array(
      z.object({
        name: z.string().min(1),
        /** Human-readable range, e.g. "1.20 and later" or ">=8.0 <9.0". */
        versions: z.string().min(1),
        note: z.string().optional(),
      }),
    )
    .min(1),
  platforms: z.array(z.string()).optional(),
  runtimes: z.array(z.string()).optional(),
});

export const koSchema = z
  .object({
    slug: z.string().regex(slugPattern, "slug must be lowercase kebab-case"),
    title: z.string().min(8).max(90),
    /** One sentence an agent can quote verbatim as the answer. */
    summary: z.string().min(20).max(320),
    domain: z.enum(KO_DOMAINS),
    tags: z.array(z.string().min(2)).min(1).max(12),

    error: z.object({
      /** The literal string a user sees and pastes into a search box. */
      signature: z.string().min(3),
      /** Machine codes: SQLSTATE, HTTP status, exit code, error number. */
      codes: z.array(z.string()).default([]),
      /** Alternate phrasings agents may search for. Drives our own search index. */
      aliases: z.array(z.string()).default([]),
    }),

    problem: z.string().min(40),
    rootCauses: z.array(rootCauseSchema).min(1),

    solution: z.object({
      steps: z.array(solutionStepSchema).min(1),
      /** Required: a fix nobody can confirm worked is advice, not a solution. */
      verification: z.string().min(10),
      /** What to do when the primary fix does not apply. */
      fallback: z.string().min(10).optional(),
    }),

    appliesTo: appliesToSchema,
    /** Explicit negative scope. Stops an agent from applying a near-miss KO. */
    notApplicableTo: z.array(z.string().min(6)).default([]),

    /** Two sources minimum: one document read once is a summary, not a verification. */
    evidence: z.array(evidenceSchema).min(2),
    confidence: z.enum(CONFIDENCE_LEVELS),
    /** Why this confidence level and not the one above it. */
    confidenceRationale: z.string().min(20),

    freshness: z.object({
      created: isoDate,
      updated: isoDate,
      /** Last time the claims were re-checked against the sources. */
      verifiedAt: isoDate,
      /** How long a verification stays trustworthy for this topic. */
      reviewIntervalDays: z.number().int().min(30).max(730),
    }),

    related: z.array(z.string().regex(slugPattern)).default([]),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;
export type RootCause = z.infer<typeof rootCauseSchema>;
export type SolutionStep = z.infer<typeof solutionStepSchema>;
export type KnowledgeObject = z.infer<typeof koSchema>;

/**
 * Editorial rules that the shape alone cannot express. These are what make the
 * word "verified" mean something, so they are enforced at build time.
 */
export type EditorialViolation = { rule: string; message: string };

const PRIMARY_EVIDENCE = new Set(["official-docs", "specification", "source-code"]);

export function checkEditorialRules(ko: KnowledgeObject): EditorialViolation[] {
  const violations: EditorialViolation[] = [];
  const primaryCount = ko.evidence.filter((e) => PRIMARY_EVIDENCE.has(e.type)).length;

  if (primaryCount === 0) {
    violations.push({
      rule: "primary-source-required",
      message: "at least one evidence item must be official-docs, specification, or source-code",
    });
  }

  if (ko.confidence === "high") {
    if (ko.evidence.length < 3) {
      violations.push({
        rule: "high-confidence-evidence-count",
        message: `confidence "high" requires >= 3 evidence items, found ${ko.evidence.length}`,
      });
    }
    if (primaryCount < 1) {
      violations.push({
        rule: "high-confidence-primary-source",
        message: 'confidence "high" requires at least one primary source',
      });
    }
  }

  if (ko.confidence === "medium" && ko.evidence.length < 2) {
    violations.push({
      rule: "medium-confidence-evidence-count",
      message: `confidence "medium" requires >= 2 evidence items, found ${ko.evidence.length}`,
    });
  }

  if (!ko.rootCauses.some((c) => c.weight === "primary")) {
    violations.push({
      rule: "primary-root-cause-required",
      message: 'at least one root cause must have weight "primary"',
    });
  }

  if (ko.freshness.verifiedAt < ko.freshness.created) {
    violations.push({
      rule: "freshness-ordering",
      message: "verifiedAt cannot precede created",
    });
  }

  if (ko.freshness.updated < ko.freshness.created) {
    violations.push({
      rule: "freshness-ordering",
      message: "updated cannot precede created",
    });
  }

  const seenUrls = new Set<string>();
  for (const item of ko.evidence) {
    if (seenUrls.has(item.url)) {
      violations.push({
        rule: "duplicate-evidence",
        message: `evidence url cited twice: ${item.url}`,
      });
    }
    seenUrls.add(item.url);
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const item of ko.evidence) {
    if (item.retrievedAt > today) {
      violations.push({
        rule: "future-retrieval",
        message: `evidence claims to have been read in the future (${item.retrievedAt}): ${item.url}`,
      });
    }
  }

  return violations;
}

/**
 * Depth floors, derived from the five hand-written seeds rather than invented.
 *
 * The shape rules above accept a KO with one root cause and one step. The seeds
 * average 5.2 causes and 6.2 steps. That gap is the room a generator optimising for
 * a green build would happily occupy, producing entries that pass every check and
 * are a third the depth of the exemplars. These floors sit just under the measured
 * minimum, so a genuinely thin topic can still ship while a lazy one cannot.
 */
export function checkDepthRules(ko: KnowledgeObject): EditorialViolation[] {
  const violations: EditorialViolation[] = [];

  const require = (rule: string, ok: boolean, message: string) => {
    if (!ok) violations.push({ rule, message });
  };

  require(
    "root-cause-depth",
    ko.rootCauses.length >= 4,
    `expected >= 4 root causes, found ${ko.rootCauses.length} (seed minimum is 5)`,
  );

  require(
    "solution-depth",
    ko.solution.steps.length >= 5,
    `expected >= 5 solution steps, found ${ko.solution.steps.length} (seed minimum is 6)`,
  );

  const actionable = ko.solution.steps.filter((s) => s.command || s.code).length;
  require(
    "solution-actionable",
    actionable >= 2,
    `expected >= 2 steps carrying a command or code block, found ${actionable}`,
  );

  require(
    "negative-scope",
    ko.notApplicableTo.length >= 2,
    `expected >= 2 notApplicableTo entries, found ${ko.notApplicableTo.length} — naming the near misses is what stops an agent applying this to the wrong failure`,
  );

  require(
    "search-surface",
    ko.error.aliases.length >= 2,
    `expected >= 2 error aliases, found ${ko.error.aliases.length} — these are the phrasings people actually search for`,
  );

  return violations;
}
