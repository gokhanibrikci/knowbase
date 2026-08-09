/**
 * What agents asked that this corpus could not answer.
 *
 *   npm run misses               last 24 hours
 *   npm run misses -- --days 7
 *   npm run misses -- --all      include the queries we answered well
 *
 * This is the authoring queue. Everything else about what to write next is a guess
 * about demand; this is a record of it. A query that arrives repeatedly and leaves
 * with nothing is the strongest case a topic can make for being written, and it costs
 * nobody anything to produce — it is the exhaust of the endpoint working normally.
 *
 * The `unmatched` column is the part to read first: those are the words from the
 * query that occur nowhere in the corpus, which usually names the technology we are
 * missing outright rather than a phrasing we handled badly.
 */
import { CYAN, DIM, GREEN, RESET, YELLOW, cf, readToken, resolveZone } from "./lib/cloudflare";

const DATASET = "knowbase_queries";

type Row = {
  query: string;
  verdict: string;
  unmatched: string;
  top_slug: string;
  hits: number;
  best_score: number;
};

type SqlResponse = { data?: Row[]; error?: string; errors?: { message: string }[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const days = Math.min(31, Math.max(1, Number(arg("days") ?? 1)));
  const includeAnswered = process.argv.includes("--all");
  const token = readToken();
  const { accountId } = await resolveZone(token);

  // Analytics Engine samples under load, so counts must be summed by the sample
  // interval rather than counted — otherwise a busy hour silently under-reports.
  const sql = `
    SELECT
      blob1 AS query,
      blob2 AS verdict,
      blob5 AS unmatched,
      blob3 AS top_slug,
      sum(_sample_interval) AS hits,
      max(double1) AS best_score
    FROM ${DATASET}
    WHERE timestamp > now() - INTERVAL '${days}' DAY
      ${includeAnswered ? "" : "AND blob2 != 'strong'"}
    GROUP BY query, verdict, unmatched, top_slug
    ORDER BY hits DESC, best_score ASC
    LIMIT 100
  `;

  const res = await cf<SqlResponse>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    token,
    { method: "POST", body: sql },
  );

  if (res.errors?.length) throw new Error(res.errors[0].message);
  if (res.error) throw new Error(res.error);

  const rows = res.data ?? [];
  const window = days === 1 ? "24h" : `${days}d`;

  console.log(
    `${CYAN}${DATASET}${RESET} — last ${window} · ${includeAnswered ? "all queries" : "unanswered only"}\n`,
  );

  if (rows.length === 0) {
    console.log(`${YELLOW}Nothing logged in this window.${RESET}`);
    console.log(
      `${DIM}Either no agent has called /search.json yet, or the dataset is still empty.`,
    );
    console.log(`Analytics Engine can take a couple of minutes to make writes queryable.${RESET}`);
    return;
  }

  const totals = { none: 0, partial: 0, strong: 0 } as Record<string, number>;
  for (const row of rows) totals[row.verdict] = (totals[row.verdict] ?? 0) + Number(row.hits);

  for (const row of rows) {
    const hits = String(row.hits).padStart(4);
    const colour = row.verdict === "none" ? YELLOW : row.verdict === "strong" ? GREEN : RESET;
    console.log(`${colour}${hits}× [${row.verdict.padEnd(7)}]${RESET} ${row.query}`);

    if (row.unmatched) console.log(`${DIM}         unmatched: ${row.unmatched}${RESET}`);
    if (row.verdict !== "none" && row.top_slug) {
      console.log(
        `${DIM}         nearest:   ${row.top_slug} (${Number(row.best_score).toFixed(2)})${RESET}`,
      );
    }
  }

  console.log(
    `\n${DIM}none:${totals.none ?? 0} partial:${totals.partial ?? 0}${includeAnswered ? ` strong:${totals.strong ?? 0}` : ""}${RESET}`,
  );
  console.log(
    `${DIM}A repeated "none" with a technology in its unmatched column is the next entry to write.${RESET}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
