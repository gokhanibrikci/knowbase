/**
 * Cloudflare bindings, as the app sees them.
 *
 * `wrangler types` generates this automatically, but it emits the full workerd
 * runtime declarations too — ~14k lines that collide with the `dom` lib this app
 * needs for React. It also augments the global `Env`, while the interface OpenNext
 * actually resolves `getCloudflareContext().env` against is `CloudflareEnv`.
 *
 * So the one binding we use is declared by hand. If a second binding is ever added,
 * add it here as well rather than committing the generated file.
 */

declare global {
  /**
   * Write-only event sink. `writeDataPoint` returns void and does not block the
   * response, so it needs no waitUntil.
   *
   * Limits that matter here: at most one index of <=96 bytes, 20 blobs totalling
   * <=16 KB, and 20 doubles. Data is retained for three months.
   * https://developers.cloudflare.com/analytics/analytics-engine/get-started/
   */
  interface AnalyticsEngineDataset {
    writeDataPoint(event: {
      indexes?: [string] | [];
      blobs?: (string | null)[];
      doubles?: number[];
    }): void;
  }

  /**
   * The slice of D1 the store actually uses. Same policy as above: `wrangler types`
   * would hand us the full runtime and a fight with the dom lib; these five methods
   * are the whole dependency.
   * https://developers.cloudflare.com/d1/worker-api/
   */
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
    run(): Promise<unknown>;
  }

  interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  }

  /**
   * Workers AI and Vectorize, declared by hand for the same reason as D1: the generated
   * runtime types fight the dom lib. Only the calls the meaning index makes.
   * https://developers.cloudflare.com/workers-ai/  https://developers.cloudflare.com/vectorize/
   */
  interface Ai {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  }

  interface VectorizeVector {
    id: string;
    values: number[];
    metadata?: Record<string, string | number | boolean>;
  }

  interface VectorizeMatch {
    id: string;
    score: number;
    metadata?: Record<string, unknown>;
  }

  interface VectorizeIndex {
    upsert(vectors: VectorizeVector[]): Promise<unknown>;
    query(
      vector: number[],
      options?: {
        topK?: number;
        returnValues?: boolean;
        returnMetadata?: "all" | "indexed" | "none" | boolean;
        filter?: Record<string, unknown>;
      },
    ): Promise<{ matches: VectorizeMatch[] }>;
    deleteByIds(ids: string[]): Promise<unknown>;
  }

  interface CloudflareEnv {
    /** Queries put to /search.json and whether the corpus could answer them. */
    QUERY_LOG?: AnalyticsEngineDataset;
    /** What an agent reported back: which cause matched, whether the fix worked. */
    REPORT_LOG?: AnalyticsEngineDataset;
    /** The store: agents, problems, solutions, reports, asks. The binding the Worker reads back. */
    STORE_DB?: D1Database;
    /** Multilingual embeddings, so a recall that misses by key can be retried by meaning. */
    AI?: Ai;
    /** One vector per problem and per unanswered ask; see lib/xp/semantic.ts. */
    SEMANTIC?: VectorizeIndex;
  }
}

export {};
