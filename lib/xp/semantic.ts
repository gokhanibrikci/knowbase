import { getCloudflareContext } from "@opennextjs/cloudflare";

import { type ProblemKind, identityAgrees, identityTokens } from "./fingerprint";

/**
 * Matching by meaning, for the keys the fingerprint cannot join.
 *
 * A fingerprint joins two agents who pasted the same error. It cannot join an agent who
 * asked in Turkish with one who asked in English, or two phrasings of one question that
 * share no words, and translating before asking — the workaround an agent reaches for —
 * only moves the mismatch. So every problem and every unanswered ask is also placed in a
 * vector index under a multilingual embedding, and a recall that misses by key is
 * retried by meaning. The language of the text stops mattering; the agent sends what it
 * has.
 *
 * When is a neighbour the same problem? For a question, a score above `question` — one
 * question in two languages scores about 0.94 on this model and two different questions
 * about 0.82. For a failure the model is not enough: the same error with a different port
 * scores 0.88, higher than the same failure described in Turkish (0.82). So a failure
 * neighbour is the same only if the asker's hard identifiers (identityTokens: errno names,
 * error classes, quoted names, ports, codes) all appear in the candidate — then a much
 * lower score suffices — or, when the asker's text carries no identifiers at all, if the
 * score is very high. Below that, down to `similar`, it is a candidate, labelled as such.
 * The scores travel with the answer so the bars can be read against the field and moved.
 *
 * Everything here is optional at runtime: without the AI and Vectorize bindings (local
 * dev, another deployment) every function returns nothing and the store behaves as it
 * did before.
 */

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;
/** How much of a text the embedding sees. The error or question is in the first lines. */
const EMBED_CHARACTERS = 2_000;

export const THRESHOLDS = {
  question: 0.88,
  failureWithIdentity: 0.8,
  failureWithoutIdentity: 0.92,
  similar: 0.72,
} as const;

/** Whether a neighbour found by meaning is the same problem as the asker's text. */
export function sameProblem(kind: ProblemKind, score: number, query: string, candidate: string): boolean {
  if (kind === "question") return score >= THRESHOLDS.question;
  if (identityTokens(query).length > 0) {
    return score >= THRESHOLDS.failureWithIdentity && identityAgrees(query, candidate);
  }
  return score >= THRESHOLDS.failureWithoutIdentity;
}

type Bindings = { ai: Ai; index: VectorizeIndex };

function bindings(): Bindings | null {
  try {
    const env = getCloudflareContext().env as { AI?: Ai; SEMANTIC?: VectorizeIndex };
    return env.AI && env.SEMANTIC ? { ai: env.AI, index: env.SEMANTIC } : null;
  } catch {
    return null;
  }
}

/** The meaning of a text as a vector, or null when the index is not available or fails. */
export async function embed(text: string): Promise<number[] | null> {
  const b = bindings();
  if (!b) return null;
  try {
    const result = (await b.ai.run(EMBEDDING_MODEL, {
      text: [text.slice(0, EMBED_CHARACTERS)],
    })) as { data?: number[][] };
    const vector = result?.data?.[0];
    return Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS ? vector : null;
  } catch {
    return null;
  }
}

export type Neighbour = {
  /** problem id, or ask fingerprint */
  ref: string;
  type: "problem" | "ask";
  kind: string;
  score: number;
};

/** The nearest indexed problems or asks, best first, one per referent. */
export async function neighbours(
  vector: number[],
  type: "problem" | "ask",
  topK = 5,
): Promise<Neighbour[]> {
  const b = bindings();
  if (!b) return [];
  try {
    const { matches } = await b.index.query(vector, {
      topK,
      returnMetadata: "all",
      filter: { type },
    });
    const seen = new Set<string>();
    const out: Neighbour[] = [];
    for (const m of matches ?? []) {
      const ref = typeof m.metadata?.ref === "string" ? m.metadata.ref : null;
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      out.push({
        ref,
        type,
        kind: typeof m.metadata?.kind === "string" ? m.metadata.kind : "failure",
        score: m.score,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function vectorId(type: "problem" | "ask", ref: string, variant?: string): string {
  return variant ? `${type}:${ref}:${variant}` : `${type}:${ref}`;
}

/** Place a problem's text in the index. `variant` distinguishes alias texts of one problem. */
export async function indexProblem(
  problemId: string,
  vector: number[],
  kind: ProblemKind,
  variant?: string,
): Promise<boolean> {
  const b = bindings();
  if (!b) return false;
  try {
    await b.index.upsert([
      { id: vectorId("problem", problemId, variant), values: vector, metadata: { type: "problem", ref: problemId, kind } },
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function indexAsk(fingerprint: string, vector: number[], kind: ProblemKind): Promise<boolean> {
  const b = bindings();
  if (!b) return false;
  try {
    await b.index.upsert([
      { id: vectorId("ask", fingerprint), values: vector, metadata: { type: "ask", ref: fingerprint, kind } },
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Remove what the index holds for these referents. Best effort; an orphan is harmless. */
export async function forget(entries: { type: "problem" | "ask"; ref: string; variants?: string[] }[]): Promise<void> {
  const b = bindings();
  if (!b || entries.length === 0) return;
  const ids = entries.flatMap((e) => [
    vectorId(e.type, e.ref),
    ...(e.variants ?? []).map((v) => vectorId(e.type, e.ref, v)),
  ]);
  try {
    await b.index.deleteByIds(ids);
  } catch {
    // Nothing to do; a stale vector points at a row that is gone and is skipped on read.
  }
}

/** Whether the meaning index is available in this runtime. */
export function semanticAvailable(): boolean {
  return bindings() !== null;
}
