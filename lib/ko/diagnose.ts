import { tokenize } from "./match";
import type { KnowledgeObject, RootCause } from "./schema";

/**
 * Which of an entry's root causes is the one the caller actually has.
 *
 * Every root cause carries a `discriminator` — the cheap check that tells them
 * apart — and an agent working a failure runs those checks anyway. Reporting what
 * they returned therefore costs it nothing, and it buys back a narrowed answer:
 * one cause named, the rest ruled out with the reason.
 *
 * The by-product is the part no document anywhere contains. Docs list what *can*
 * cause an error; nothing records which cause actually fires, and how often. That
 * only comes from the field, and this is the call that collects it.
 *
 * Scoring is the same idea as lib/ko/match.ts one level down: inverse document
 * frequency, but over this entry's four to six causes rather than the whole corpus.
 * A word appearing in every discriminator cannot separate them and scores zero; a
 * word appearing in one is decisive. At this size that is the whole algorithm.
 */

export type CauseMatch = {
  cause: RootCause;
  /** 0..1 against the best-scoring cause for these observations. */
  score: number;
  matchedTerms: string[];
};

export type Diagnosis = {
  /** The cause the observations point at, or null when they do not discriminate. */
  identified: CauseMatch | null;
  /** Every cause, best first. The ones below the top are the ruled-out set. */
  ranked: CauseMatch[];
  /** True when the top cause is clearly ahead rather than narrowly ahead. */
  confident: boolean;
  /** Observation terms matching no discriminator — often the interesting part. */
  unmatchedTerms: string[];
};

/**
 * How far ahead the leader must be to count as identified. Provisional, like the
 * thresholds in match.ts, and for the same reason: there is no field data to fit it
 * to yet. Unlike those, this one is cheap to correct — the reports say what the
 * spread actually looks like.
 */
const LEAD_MARGIN = 0.25;

function haystack(cause: RootCause): string {
  return [cause.cause, cause.detail ?? "", cause.discriminator].join(" ").toLowerCase();
}

export function diagnose(ko: KnowledgeObject, observations: string): Diagnosis {
  const causes = ko.rootCauses;
  const empty: Diagnosis = {
    identified: null,
    ranked: causes.map((cause) => ({ cause, score: 0, matchedTerms: [] })),
    confident: false,
    unmatchedTerms: [],
  };

  const terms = tokenize(observations);
  if (terms.length === 0 || causes.length === 0) return empty;

  const documents = causes.map(haystack);
  const unmatchedTerms: string[] = [];
  const idf = new Map<string, number>();

  for (const term of terms) {
    const df = documents.reduce((n, doc) => n + (doc.includes(term) ? 1 : 0), 0);
    if (df === 0) {
      unmatchedTerms.push(term);
      continue;
    }
    // log(N/df) again: a term every discriminator shares is worth exactly nothing,
    // which is the right treatment for the shared vocabulary of one error's causes.
    idf.set(term, Math.log(causes.length / df));
  }

  const scored = causes.map((cause, i) => {
    const doc = documents[i];
    const matchedTerms: string[] = [];
    let raw = 0;

    for (const [term, weight] of idf) {
      if (!doc.includes(term)) continue;
      raw += weight;
      matchedTerms.push(term);
    }

    return { cause, raw, matchedTerms };
  });

  const best = Math.max(...scored.map((s) => s.raw));
  if (best === 0) return { ...empty, unmatchedTerms };

  const ranked = scored
    .map(({ cause, raw, matchedTerms }) => ({ cause, score: raw / best, matchedTerms }))
    .sort((a, b) => b.score - a.score);

  // A cause that only ties the field has not been identified by these observations,
  // and saying so is more useful than naming a winner the evidence does not support.
  const runnerUp = ranked[1]?.score ?? 0;
  const confident = ranked[0].score - runnerUp >= LEAD_MARGIN;

  return {
    identified: confident ? ranked[0] : null,
    ranked,
    confident,
    unmatchedTerms,
  };
}
