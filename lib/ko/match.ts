import type { KnowledgeObject } from "./schema";

/**
 * Matching a pasted error against the corpus.
 *
 * This replaces a plain term-frequency scan, which had one flaw that mattered more
 * than its ranking quality: it could not tell a hit from a miss. Every KO sharing a
 * single common word scored above zero, so "no good answer" and "a weak answer"
 * looked identical. That distinction is the entire point of the endpoint — an agent
 * needs to know when to stop trusting us, and the unanswered queries are the only
 * honest signal of what the corpus is missing.
 *
 * Two properties do most of the work:
 *
 * 1. **Terms are weighted by inverse document frequency.** An agent does not paste a
 *    tidy error string; it pastes a stack trace, most of which is framework noise.
 *    Noise is by definition common, so IDF discounts it without a hand-maintained
 *    stopword list — and a term occurring in every entry is worth exactly nothing.
 *
 * 2. **Terms absent from the corpus are counted, not ignored.** A query whose rare
 *    terms appear nowhere here is a gap, and saying so is more useful than returning
 *    whatever ranked least badly.
 */

/** Where a term hit, in descending order of how much it implies a real match. */
const FIELD_WEIGHTS = { signature: 8, title: 5, tags: 3, body: 1 } as const;
const MAX_FIELD_WEIGHT = FIELD_WEIGHTS.signature;

/**
 * A pasted trace can carry hundreds of distinct tokens. Past the most informative
 * few, extra terms only add noise, so both scoring and normalisation stop here.
 */
const MAX_TERMS_CONSIDERED = 40;
const MAX_TERMS_NORMALISED = 8;

/**
 * Provisional thresholds. They are round numbers chosen against the seed corpus
 * rather than measured, which is honest but temporary: the miss log exists so the
 * next revision can be fitted to queries agents actually send.
 */
const PARTIAL_FLOOR = 0.15;
const STRONG_FLOOR = 0.45;
/** Two entries this close are not reliably distinguishable; make the agent look. */
const AMBIGUITY_MARGIN = 0.15;

/**
 * Whether a query is an unsubstituted placeholder rather than something someone asked.
 *
 * This is not hypothetical. The JSON-LD SearchAction on every page advertises
 * `?q={search_term_string}`, and a crawler fetched that URL verbatim — placeholder
 * and all. The words inside happened to hit an entry about string truncation, so we
 * answered a meaningless question with a near miss and recorded it as real demand.
 * Both are exactly what this project is arranged against.
 *
 * Angle brackets are covered too, because the documentation this repo publishes uses
 * `<your error text>` as its own example placeholder.
 */
export function isPlaceholderQuery(query: string): boolean {
  return /^\s*[<{][^<>{}]*[>}]\s*$/.test(query);
}

export type MatchVerdict = "strong" | "partial" | "none";

export type MatchResult = {
  ko: KnowledgeObject;
  /** 0..1, where 1 is every informative query term landing on the error signature. */
  score: number;
  /** Which query terms this entry accounts for. Lets a caller check our ranking. */
  matchedTerms: string[];
  /**
   * Whether any term reached the error signature or title rather than only the prose.
   * A body-only hit is a topic overlap, not an answer, and cannot be called strong.
   */
  hitsIdentity: boolean;
};

export type MatchReport = {
  /** The informative terms extracted from the query, rarest first. */
  terms: string[];
  /** Terms occurring in no entry at all — the sharpest statement of a corpus gap. */
  unmatchedTerms: string[];
  verdict: MatchVerdict;
  results: MatchResult[];
};

const STOPWORDS = new Set([
  // Ordinary English that survives the length filter but discriminates nothing.
  // The list is longer than it looks like it needs to be because IDF alone is a
  // weak filter at this corpus size: a filler word appearing in three of twenty-five
  // entries scores as "rare" and outranks the technology the query is actually about.
  "the", "and", "for", "with", "this", "that", "from", "was", "were", "has", "have",
  "had", "not", "but", "you", "your", "can", "will", "would", "should", "when",
  "what", "why", "how", "does", "did", "are", "its", "his", "her", "their", "they",
  "been", "being", "could", "keep", "keeps", "kept", "under", "over", "into", "than",
  "then", "some", "such", "only", "just", "like", "after", "before", "while",
  "about", "there", "here", "where", "which", "who", "whom", "each", "more", "most",
  "other", "same", "too", "very", "also", "any", "all", "get", "gets", "got",
  "make", "makes", "made", "use", "uses", "used", "using", "run", "runs", "running",
  "try", "tries", "trying", "want", "wants", "need", "needs", "recent", "last",
  "still", "even", "now", "way", "one", "two", "see", "seen", "say", "says",
  // Trace and log scaffolding. Common enough that IDF would discount them anyway;
  // dropping them early keeps the reported term list readable for a human.
  "error", "err", "exception", "warning", "info", "debug", "trace", "traceback",
  "stack", "caused", "line", "file", "module", "func", "function", "method", "call",
  "called", "failed", "failure", "fatal", "panic", "raise", "raised", "throw",
  "thrown", "log", "logs", "message", "msg", "code", "status", "result", "return",
]);

/** Tokens shorter than this substring-match too much to carry meaning. */
const MIN_TERM_LENGTH = 3;

/**
 * Splits a query into candidate terms.
 *
 * Compound tokens are emitted whole *and* in parts, because both forms show up in
 * the wild: an entry may cite `ORA-00933` while a log line carries `ora` and `00933`
 * separately, and `40P01` should be findable inside `sqlstate=40P01`.
 */
export function tokenize(query: string): string[] {
  const raw = query.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? [];
  const out = new Set<string>();

  for (const token of raw) {
    if (token.length >= MIN_TERM_LENGTH && !STOPWORDS.has(token)) out.add(token);

    if (/[._-]/.test(token)) {
      for (const part of token.split(/[._-]+/)) {
        if (part.length >= MIN_TERM_LENGTH && !STOPWORDS.has(part)) out.add(part);
      }
    }
  }

  return [...out];
}

type Haystack = Record<keyof typeof FIELD_WEIGHTS, string>;

function haystack(ko: KnowledgeObject): Haystack {
  return {
    signature: [ko.error.signature, ...ko.error.codes, ...ko.error.aliases]
      .join(" ")
      .toLowerCase(),
    title: ko.title.toLowerCase(),
    tags: ko.tags.join(" ").toLowerCase(),
    body: [
      ko.summary,
      ko.problem,
      ...ko.rootCauses.map((c) => `${c.cause} ${c.detail ?? ""}`),
      ...ko.appliesTo.technology.map((t) => t.name),
      ...ko.notApplicableTo,
    ]
      .join(" ")
      .toLowerCase(),
  };
}

/**
 * Suffixes worth stripping from a term that matched nothing, longest first.
 *
 * This is not stemming, and deliberately so: it runs only on terms already known to
 * be absent from the corpus, so it can rescue `deadlocking` onto `deadlock` without
 * any risk of mangling a term that was matching perfectly well. A user describes a
 * failure in the present continuous; an error signature never does.
 */
const SUFFIXES = ["ing", "ies", "ed", "es", "s"] as const;
const MIN_STEM_LENGTH = 4;

function stemCandidates(term: string): string[] {
  const out: string[] = [];
  for (const suffix of SUFFIXES) {
    if (!term.endsWith(suffix) || term.length - suffix.length < MIN_STEM_LENGTH) continue;
    const stem = term.slice(0, -suffix.length);
    out.push(stem);
    // "retries" -> "retry", "queries" -> "query"
    if (suffix === "ies") out.push(`${stem}y`);
    // A doubled consonant is dropped when -ing is added: "dropping" -> "drop". The
    // length floor applies again here — matching is by substring, so a three-letter
    // stem finds itself inside unrelated words ("billing" -> "bil") and scores noise.
    if (suffix === "ing" && /(.)\1$/.test(stem) && stem.length - 1 >= MIN_STEM_LENGTH) {
      out.push(stem.slice(0, -1));
    }
  }
  return out;
}

/** The heaviest field this term appears in, or 0 if the entry does not mention it. */
function fieldWeight(fields: Haystack, term: string): number {
  if (fields.signature.includes(term)) return FIELD_WEIGHTS.signature;
  if (fields.title.includes(term)) return FIELD_WEIGHTS.title;
  if (fields.tags.includes(term)) return FIELD_WEIGHTS.tags;
  if (fields.body.includes(term)) return FIELD_WEIGHTS.body;
  return 0;
}

export function matchKnowledgeObjects(
  objects: KnowledgeObject[],
  query: string,
): MatchReport {
  const candidates = tokenize(query);
  const empty: MatchReport = {
    terms: [],
    unmatchedTerms: [],
    verdict: "none",
    results: [],
  };
  if (candidates.length === 0 || objects.length === 0) return empty;

  const fieldsByKo = objects.map(haystack);
  const total = objects.length;

  // Document frequency, then IDF. log(N/df) is deliberate: a term every entry
  // contains scores zero rather than merely little, which is what makes a pasted
  // trace's boilerplate free to ignore.
  const idf = new Map<string, number>();
  const unmatchedTerms: string[] = [];

  const documentFrequency = (term: string) =>
    fieldsByKo.reduce((n, fields) => n + (fieldWeight(fields, term) > 0 ? 1 : 0), 0);

  for (const term of candidates) {
    let effective = term;
    let df = documentFrequency(term);

    if (df === 0) {
      for (const stem of stemCandidates(term)) {
        const stemDf = documentFrequency(stem);
        if (stemDf > 0) {
          effective = stem;
          df = stemDf;
          break;
        }
      }
    }

    if (df === 0) {
      unmatchedTerms.push(term);
      continue;
    }

    // Two query words can reduce to the same stem; keep the one occurrence.
    if (!idf.has(effective)) idf.set(effective, Math.log(total / df));
  }

  // Rarest first, so the cap keeps the most discriminating terms.
  const terms = [...idf.keys()]
    .sort((a, b) => idf.get(b)! - idf.get(a)!)
    .slice(0, MAX_TERMS_CONSIDERED);

  if (terms.length === 0) {
    return { ...empty, terms: [], unmatchedTerms };
  }

  // Normalise against a bounded ideal: the most informative few terms all landing on
  // an error signature. Capping the count is what stops a long paste from being
  // unmatchable — its signal is concentrated in a line or two, not spread evenly.
  const bestPossible =
    terms
      .slice(0, MAX_TERMS_NORMALISED)
      .reduce((sum, term) => sum + idf.get(term)!, 0) * MAX_FIELD_WEIGHT;

  if (bestPossible === 0) {
    return { ...empty, terms, unmatchedTerms };
  }

  // Terms we know nothing about are the sharpest evidence of a gap, but only the
  // topical ones: a traceback is full of `main.py` and `services.billing`, which are
  // absent because they belong to the caller's project, not because the corpus is
  // missing a subject. Plain alphabetic tokens are the ones that name a technology.
  const topicalMisses = unmatchedTerms.filter((t) => /^[a-z]+$/.test(t)).length;
  const coverage = terms.length / (terms.length + topicalMisses);

  const results = objects
    .map((ko, i) => {
      const fields = fieldsByKo[i];
      const matchedTerms: string[] = [];
      let raw = 0;
      let hitsIdentity = false;

      for (const term of terms) {
        const weight = fieldWeight(fields, term);
        if (weight === 0) continue;
        raw += idf.get(term)! * weight;
        matchedTerms.push(term);
        if (weight >= FIELD_WEIGHTS.title) hitsIdentity = true;
      }

      // Discount by the share of the query's distinctive words we actually know.
      // Without this, "terraform state lock could not be acquired" scores as a
      // confident hit on a MySQL lock-timeout entry: every word we recognise is a
      // real hit, and the two that would have told us otherwise cost nothing.
      const score = Math.min(1, (raw / bestPossible) * coverage);

      return { ko, score, matchedTerms, hitsIdentity };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.ko.title.localeCompare(b.ko.title));

  return { terms, unmatchedTerms, verdict: verdictFor(results), results };
}

function verdictFor(results: MatchResult[]): MatchVerdict {
  const top = results[0];
  if (!top || top.score < PARTIAL_FLOOR) return "none";
  if (top.score < STRONG_FLOOR || !top.hitsIdentity) return "partial";

  // A clear winner is part of what "strong" claims. When the runner-up is this
  // close the honest answer is that two entries fit and their notApplicableTo
  // sections, not our ranking, are what tells them apart.
  const runnerUp = results[1];
  if (runnerUp && top.score - runnerUp.score < AMBIGUITY_MARGIN) return "partial";

  return "strong";
}

/** Ranked entries only — the shape the HTML search page wants. */
export function searchKnowledgeObjects(
  objects: KnowledgeObject[],
  query: string,
): KnowledgeObject[] {
  if (!query.trim()) return objects;
  return matchKnowledgeObjects(objects, query).results.map((r) => r.ko);
}
