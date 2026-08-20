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
 * What a term is worth when the only place it appears is `notApplicableTo`.
 *
 * That field exists to name the failures an entry is most often confused with, so a
 * query whose distinctive words land *only* there is a query the entry is disclaiming
 * — evidence against it, not for it. Treating that text as ordinary body prose did
 * the opposite: "Cannot connect to the Docker daemon. Is the docker daemon running?"
 * matched the entry about permission denied at 0.91, because that entry is the one
 * careful enough to say it is not about this.
 *
 * The magnitude sits between a tag hit and a signature hit: enough to move a wrong
 * entry off the top, not enough to bury one whose signature the query also matches.
 *
 * This term-level signal only fires when the vocabularies differ, which measured
 * reality says is the rare case — confusable errors mostly share their words (the
 * Docker query above shares every informative token with the permission entry's own
 * signature, so no term ever reaches the disclaimer). The coverage comparison in
 * `disclaimingItem` below is what handles that common case; this weight stays for
 * the disjoint-vocabulary one.
 */
const DISCLAIMER_WEIGHT = -4;

/**
 * A disclaimer item only counts as explaining the query when it accounts for at
 * least this share of the query's informative tokens. Below it, an overlap is topic
 * noise — "docker" appearing in both — not a competing diagnosis.
 */
const DISCLAIM_COVERAGE_FLOOR = 0.8;

/**
 * A pasted trace can carry hundreds of distinct tokens. Past the most informative
 * few, extra terms only add noise, so both scoring and normalisation stop here.
 */
const MAX_TERMS_CONSIDERED = 40;
const MAX_TERMS_NORMALISED = 8;

/** A score is only a ranking hint; semantic identity gates below decide hit vs miss. */
const PARTIAL_FLOOR = 0.15;
const STRONG_FLOOR = 0.45;
/** A strong answer must account for at least half of the query's identity vocabulary. */
const IDENTITY_COVERAGE_FLOOR = 0.5;
/** Without an exact, specific identifier, two error-family terms must agree. */
const MIN_IDENTITY_ANCHORS = 2;
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
  /** Share of all informative query tokens found in the error signature/codes/aliases. */
  identityCoverage: number;
  /** Exact/prefix identity terms after technology names have been removed. */
  identityAnchors: string[];
  /** Whether a complete published signature, code or alias appears in the query. */
  exactIdentityMatch: boolean;
  /** Whether that exact identity is specific enough to survive unrelated stack noise. */
  exactSpecificIdentityMatch: boolean;
  /** Whether the query contains a published code that is specific without context. */
  exactSpecificCodeMatch: boolean;
  /** A specific code, or a generic code paired with this KO's technology. */
  exactCodeAnchor: boolean;
  /** Generic codes need an explicit technology/environment term beside them. */
  genericCodeWithoutContext: boolean;
  /** The query explicitly names a different technology than this KO covers. */
  technologyConflict: boolean;
  /**
   * Query terms this entry mentions only to exclude. Two errors can be lexically
   * near-identical — "cannot connect to the Docker daemon" is the permission failure
   * and the daemon-is-down failure both — and where they are, the words they share
   * cannot separate them but the disclaimer can.
   */
  disclaimedTerms: string[];
  /**
   * The notApplicableTo item that explains the query better than this entry's own
   * error signature does, when one exists. Ranking is untouched — the entry may
   * still be the closest thing here — but a verdict of "strong" is off the table:
   * by the entry's own account, the caller may be holding the excluded failure.
   */
  disclaimedBy?: string;
};

export type MatchReport = {
  /** The informative terms extracted from the query, rarest first. */
  terms: string[];
  /** Terms occurring in no entry at all — the sharpest statement of a corpus gap. */
  unmatchedTerms: string[];
  verdict: MatchVerdict;
  results: MatchResult[];
};

/**
 * Results safe to expose to a caller.
 *
 * Ranking keeps every positive score so verdict calculation and telemetry remain
 * inspectable. Public surfaces need a stricter boundary: a strong verdict has one
 * answer, while a partial verdict may expose only candidates with their own semantic
 * identity or an explicit negative-scope explanation.
 */
export function presentableMatchResults(
  report: MatchReport,
  limit = Number.POSITIVE_INFINITY,
): MatchResult[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : Number.POSITIVE_INFINITY;
  if (report.verdict === "none" || safeLimit === 0) return [];
  if (report.verdict === "strong") return report.results.slice(0, Math.min(1, safeLimit));

  return report.results
    .filter(
      (result) =>
        result.score >= PARTIAL_FLOOR &&
        (result.exactIdentityMatch ||
          result.identityAnchors.length >= MIN_IDENTITY_ANCHORS ||
          result.disclaimedTerms.length > 0 ||
          Boolean(result.disclaimedBy)),
    )
    .slice(0, safeLimit);
}

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
  "because", "couldn", "didn", "doesn", "isn", "shouldn", "wasn", "weren",
  "wouldn",
]);

/** Tokens shorter than this exact/prefix-match too much to carry meaning. */
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

type TokenSet = Set<string>;
type Haystack = Record<keyof typeof FIELD_WEIGHTS, TokenSet> & { disclaimer: TokenSet };

function tokenSet(text: string): TokenSet {
  return new Set(tokenize(text));
}

/**
 * Match whole tokens, plus conservative prefixes for ecosystem spellings such as
 * `postgres`/`postgresql`. The ratio guard keeps `state` from matching `statement`.
 */
function tokensMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const shortest = Math.min(left.length, right.length);
  const longest = Math.max(left.length, right.length);
  return (
    shortest >= 5 &&
    shortest / longest >= 0.75 &&
    (left.startsWith(right) || right.startsWith(left))
  );
}

function tokenSetHas(tokens: TokenSet, term: string): boolean {
  for (const token of tokens) {
    if (tokensMatch(token, term)) return true;
  }
  return false;
}

function haystack(ko: KnowledgeObject): Haystack {
  return {
    signature: tokenSet([ko.error.signature, ...ko.error.codes, ...ko.error.aliases].join(" ")),
    title: tokenSet(ko.title),
    tags: tokenSet(ko.tags.join(" ")),
    body: tokenSet([
      ko.summary,
      ko.problem,
      ...ko.rootCauses.map((c) => `${c.cause} ${c.detail ?? ""}`),
      ...ko.appliesTo.technology.map((t) => t.name),
    ].join(" ")),
    // Kept out of the positive fields on purpose — see DISCLAIMER_WEIGHT.
    disclaimer: tokenSet(ko.notApplicableTo.join(" ")),
  };
}

function identityTokens(ko: KnowledgeObject): TokenSet {
  return tokenSet([ko.error.signature, ...ko.error.codes, ...ko.error.aliases].join(" "));
}

function technologyTokens(ko: KnowledgeObject): TokenSet {
  const names = [
    ko.domain,
    ...ko.appliesTo.technology.map((technology) => technology.name),
    ...(ko.appliesTo.runtimes ?? []),
  ];
  const tokens = tokenSet(names.join(" "));

  for (const name of names) {
    const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (words.length < 2) continue;
    const acronym = words.map((word) => word[0]).join("");
    if (acronym.length >= MIN_TERM_LENGTH) tokens.add(acronym);
  }

  return tokens;
}

function normalisePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/**
 * Full signatures and aliases are reliable anchors even inside a long stack trace.
 * Codes are matched as whole normalised tokens; a substring such as `npm` inside an
 * unrelated npm error is deliberately not enough.
 */
function hasExactIdentityMatch(ko: KnowledgeObject, query: string): boolean {
  const normalisedQuery = normalisePhrase(query);
  if (!normalisedQuery) return false;

  const paddedQuery = ` ${normalisedQuery} `;
  for (const code of ko.error.codes) {
    const normalisedCode = normalisePhrase(code);
    if (normalisedCode && paddedQuery.includes(` ${normalisedCode} `)) return true;
  }

  for (const phrase of [ko.error.signature, ...ko.error.aliases]) {
    const normalised = normalisePhrase(phrase);
    if (normalised.length >= MIN_TERM_LENGTH && paddedQuery.includes(` ${normalised} `)) {
      return true;
    }
  }

  return false;
}

/** Codes/statuses whose meaning is not specific without a product/runtime name. */
const GENERIC_CODES = new Set([
  "backoff",
  "cors",
  "eacces",
  "enospc",
  "err_failed",
  "hy000",
  "importerror",
  "invalid_request",
  "lock_timeout",
  "pending",
  "sigkill",
  "too_many_connections",
]);

/** Identity phrases shared by several products; the KO's technology disambiguates. */
const GENERIC_IDENTITY_PHRASES = [
  "invalid signature",
  "lock wait timeout",
  "no space left on device",
  "pull access denied",
  "relation does not exist",
  "signature verification failed",
  "too many connections",
].map(normalisePhrase);

/** Broad platform nouns must not manufacture a cross-technology conflict. */
const GENERIC_TECHNOLOGY_TERMS = new Set([
  "api",
  "browser",
  "browsers",
  "client",
  "engine",
  "framework",
  "http",
  "https",
  "kernel",
  "language",
  "linux",
  "networking",
  "runtime",
  "security",
  "server",
  "signature",
  "token",
  "web",
]);

function hasGenericIdentityPhrase(query: string): boolean {
  const paddedQuery = ` ${normalisePhrase(query)} `;
  return GENERIC_IDENTITY_PHRASES.some((phrase) => paddedQuery.includes(` ${phrase} `));
}

function isGenericIdentityPhrase(phrase: string): boolean {
  const paddedPhrase = ` ${normalisePhrase(phrase)} `;
  return GENERIC_IDENTITY_PHRASES.some((generic) =>
    paddedPhrase.includes(` ${generic} `),
  );
}

/**
 * Exact non-generic prose is reliable inside a noisy stack trace. Unlike `invalid
 * signature` or `lock wait timeout`, the complete React/CORS-style message already
 * identifies its failure family and should not be diluted by application frames.
 */
function hasExactSpecificPhraseMatch(ko: KnowledgeObject, query: string): boolean {
  const paddedQuery = ` ${normalisePhrase(query)} `;
  return [ko.error.signature, ...ko.error.aliases].some((phrase) => {
    const normalised = normalisePhrase(phrase);
    return (
      normalised.length >= MIN_TERM_LENGTH &&
      !isGenericIdentityPhrase(normalised) &&
      paddedQuery.includes(` ${normalised} `)
    );
  });
}

function exactCodeMatches(ko: KnowledgeObject, query: string): string[] {
  const paddedQuery = ` ${normalisePhrase(query)} `;
  return ko.error.codes.filter((code) => {
    const normalised = normalisePhrase(code);
    return normalised.length > 0 && paddedQuery.includes(` ${normalised} `);
  });
}

function isGenericCode(code: string): boolean {
  const normalised = normalisePhrase(code).replace(/ /g, "_");
  return /^\d{3}$/.test(normalised) || GENERIC_CODES.has(normalised);
}

/** Unknown diagnostic identifiers are the strongest evidence that this is a gap. */
function hasUnmatchedErrorIdentifier(query: string, unmatchedTerms: string[]): boolean {
  const unmatched = new Set(unmatchedTerms);
  const raw = query.match(/[A-Za-z0-9][A-Za-z0-9._-]*/g) ?? [];

  return raw.some((token) => {
    const lower = token.toLowerCase();
    if (!unmatched.has(lower)) return false;
    return (
      /^[A-Z][A-Z0-9_-]{3,}$/.test(token) ||
      /(?:error|exception)$/i.test(token) ||
      /^err(?:or)?[_-][a-z0-9_-]{3,}$/i.test(token) ||
      /^e(?:acces|addr|again|conn|exist|host|inval|io|mfile|net|nfile|noent|nospc|perm|pipe|proto|timed)[a-z0-9_-]{2,}$/i.test(token) ||
      /^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]+)+$/.test(token)
    );
  });
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

/**
 * The notApplicableTo item that accounts for the query better than the entry's own
 * signature does, if any.
 *
 * Coverage is compared, not phrases: confusable errors share their phrasing (both
 * Docker failures contain "connect to the Docker daemon at unix://..."), so any
 * contiguous-match rule fires on the genuine query too. Coverage has the property
 * that matters instead — a query drawn from the entry's own signature is covered
 * ~fully by it, and nothing can beat full coverage, so a true positive can never be
 * disclaimed. The confusable query's extra words ("cannot", "is ... running?") are
 * exactly what the disclaimer covers and the signature does not.
 */
function disclaimingItem(ko: KnowledgeObject, queryTokens: string[]): string | undefined {
  if (queryTokens.length === 0 || ko.notApplicableTo.length === 0) return undefined;

  const signature = identityTokens(ko);

  const coverageBy = (tokens: TokenSet) =>
    queryTokens.reduce((n, term) => n + (tokenSetHas(tokens, term) ? 1 : 0), 0) /
    queryTokens.length;

  const own = coverageBy(signature);

  let best: string | undefined;
  let bestCoverage = 0;
  for (const item of ko.notApplicableTo) {
    const c = coverageBy(tokenSet(item));
    if (c > bestCoverage) {
      bestCoverage = c;
      best = item;
    }
  }

  // Strictly greater: an item merely tying the signature is the shared-vocabulary
  // baseline, not a competing diagnosis.
  return bestCoverage >= DISCLAIM_COVERAGE_FLOOR && bestCoverage > own ? best : undefined;
}

/**
 * The heaviest field this term appears in.
 *
 * Positive fields are checked first, so a term the entry genuinely covers keeps its
 * full value even when notApplicableTo happens to repeat the word. Only a term found
 * *nowhere but* the disclaimer scores against the entry.
 */
function fieldWeight(fields: Haystack, term: string): number {
  if (tokenSetHas(fields.signature, term)) return FIELD_WEIGHTS.signature;
  if (tokenSetHas(fields.title, term)) return FIELD_WEIGHTS.title;
  if (tokenSetHas(fields.tags, term)) return FIELD_WEIGHTS.tags;
  if (tokenSetHas(fields.body, term)) return FIELD_WEIGHTS.body;
  if (tokenSetHas(fields.disclaimer, term)) return DISCLAIMER_WEIGHT;
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
  const technologiesByKo = objects.map(technologyTokens);
  const allTechnologyTokens = new Set<string>();
  for (const tokens of technologiesByKo) {
    for (const token of tokens) allTechnologyTokens.add(token);
  }
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
      const disclaimedTerms: string[] = [];
      const identity = fields.signature;
      const technologies = technologiesByKo[i];
      let raw = 0;
      let hitsIdentity = false;

      for (const term of terms) {
        const weight = fieldWeight(fields, term);
        if (weight === 0) continue;

        raw += idf.get(term)! * weight;

        // A term the entry only disclaims is not one it matched, so it is neither
        // reported as a hit nor allowed to count towards identity.
        if (weight > 0) {
          matchedTerms.push(term);
          if (weight >= FIELD_WEIGHTS.title) hitsIdentity = true;
        } else {
          disclaimedTerms.push(term);
        }
      }

      // Discount by the share of the query's distinctive words we actually know.
      // Without this, "terraform state lock could not be acquired" scores as a
      // confident hit on a MySQL lock-timeout entry: every word we recognise is a
      // real hit, and the two that would have told us otherwise cost nothing.
      const score = Math.min(1, (raw / bestPossible) * coverage);
      const queryIdentityTerms = candidates.filter(
        (term) =>
          GENERIC_TECHNOLOGY_TERMS.has(term) || !tokenSetHas(technologies, term),
      );
      const identityAnchors = queryIdentityTerms.filter((term) => tokenSetHas(identity, term));
      const identityCoverage =
        queryIdentityTerms.length === 0 ? 0 : identityAnchors.length / queryIdentityTerms.length;
      const matchedCodes = exactCodeMatches(ko, query);
      const genericCodeMatch = matchedCodes.some(isGenericCode);
      const exactSpecificCodeMatch = matchedCodes.some((code) => !isGenericCode(code));
      const queryTechnologyTerms = candidates.filter((term) =>
        !GENERIC_TECHNOLOGY_TERMS.has(term) && tokenSetHas(allTechnologyTokens, term),
      );
      const hasTechnologyContext = queryTechnologyTerms.some((term) =>
        tokenSetHas(technologies, term),
      );
      const technologyConflict =
        queryTechnologyTerms.length > 0 && !hasTechnologyContext;
      const exactCodeAnchor =
        exactSpecificCodeMatch || (genericCodeMatch && hasTechnologyContext);
      const genericIdentityWithoutContext =
        hasGenericIdentityPhrase(query) && !hasTechnologyContext;
      const exactSpecificIdentityMatch =
        exactSpecificCodeMatch || hasExactSpecificPhraseMatch(ko, query);

      return {
        ko,
        score,
        matchedTerms,
        hitsIdentity,
        identityCoverage,
        identityAnchors,
        exactIdentityMatch: hasExactIdentityMatch(ko, query),
        exactSpecificIdentityMatch,
        exactSpecificCodeMatch,
        exactCodeAnchor,
        genericCodeWithoutContext:
          (genericCodeMatch && !hasTechnologyContext) || genericIdentityWithoutContext,
        technologyConflict,
        disclaimedTerms,
        disclaimedBy: disclaimingItem(ko, candidates),
      };
    })
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(Boolean(b.disclaimedBy)) - Number(Boolean(a.disclaimedBy)) ||
        a.ko.title.localeCompare(b.ko.title),
    );

  return { terms, unmatchedTerms, verdict: verdictFor(results, query, unmatchedTerms), results };
}

function verdictFor(
  results: MatchResult[],
  query: string,
  unmatchedTerms: string[],
): MatchVerdict {
  const top = results[0];
  if (!top || top.score < PARTIAL_FLOOR) return "none";

  // An explicit negative-scope match is useful as a lead even when the query's own
  // identifier is absent: the entry is naming the nearby failure and ruling itself
  // out, which is exactly what `partial` means.
  if (top.disclaimedTerms.length > 0 || top.disclaimedBy) return "partial";

  const hasIdentityAnchors = top.identityAnchors.length >= MIN_IDENTITY_ANCHORS;
  const hasSemanticLead = top.exactIdentityMatch || hasIdentityAnchors;

  // A score without an error-family anchor is merely topical overlap. This semantic
  // gate lets the numeric floor stay tolerant of real neighbouring errors without
  // turning AWS, Java or Git nouns into arbitrary partial results.
  if (!hasSemanticLead) return "none";

  if (top.score < STRONG_FLOOR || !top.hitsIdentity) return "partial";

  // A full but generic status (429, Pending, SIGKILL...) is not product-specific.
  // It becomes actionable only when the query also names this KO's environment.
  if (top.genericCodeWithoutContext || top.technologyConflict) return "partial";

  // An unknown diagnostic family vetoes strong unless a specific published code is
  // present. Shared prose around a foreign error is useful at most as a lead.
  if (!top.exactSpecificCodeMatch && hasUnmatchedErrorIdentifier(query, unmatchedTerms)) {
    return "partial";
  }

  // A broad technology word in an identity field is not an error match. In
  // particular, `npm EADDRINUSE` used to become a strong ERESOLVE answer because
  // `npm` hit the title while the actual error code was absent from the corpus.
  if (
    !top.exactSpecificIdentityMatch &&
    (!hasIdentityAnchors || top.identityCoverage < IDENTITY_COVERAGE_FLOOR)
  ) {
    return "partial";
  }

  // A clear winner is part of what "strong" claims. When a runner-up is this
  // close the honest answer is usually that two entries fit and their
  // notApplicableTo sections, not our ranking, are what tells them apart.
  //
  // Usually — because the corpus writes those sections with the sibling's slug in
  // them, and that is a machine-readable arrow. A runner-up whose own exclusions
  // point at the top entry has already conceded this query: "Init:CrashLoopBackOff"
  // sits at 1.000 for the bare CrashLoopBackOff query too, but its first exclusion
  // names kubernetes-crashloopbackoff, so the tie it creates is not an ambiguity.
  // Only contenders that do NOT defer to the winner keep the verdict at partial.
  const contenders = results
    .slice(1)
    .filter((r) => top.score - r.score < AMBIGUITY_MARGIN)
    .filter((r) => !r.ko.notApplicableTo.some((item) => item.includes(top.ko.slug)));
  if (contenders.length > 0) return "partial";

  return "strong";
}
