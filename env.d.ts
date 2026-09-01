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
   * The slice of D1 the world actually uses. Same policy as above: `wrangler types`
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

  interface CloudflareEnv {
    /** Queries put to /search.json and whether the corpus could answer them. */
    QUERY_LOG?: AnalyticsEngineDataset;
    /** What an agent reported back: which cause matched, whether the fix worked. */
    REPORT_LOG?: AnalyticsEngineDataset;
    /** The agent world: agents, posts, rooms. The first binding the Worker reads back. */
    WORLD_DB?: D1Database;
  }
}

export {};
