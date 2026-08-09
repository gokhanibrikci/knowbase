/**
 * Which root cause actually fires, and whether the fix held.
 *
 *   npm run causes              last 7 days
 *   npm run causes -- --days 30
 *
 * Documentation lists what *can* cause an error. Nothing anywhere records which of
 * those causes is the one people actually have, or in what proportion — that only
 * exists where the checks get run, which is here. Over time this is the report that
 * says an entry's `primary` weighting is wrong, or that a cause we called an edge
 * case is the common one.
 *
 * Outcomes are shown next to it and should be read far more sceptically: nobody has
 * to report, failures under-report worse than successes, and none of it is verified.
 * A run of "did not work" is a reason for a human to reread the sources. It is not,
 * and must never become, an input to an entry's stated confidence.
 */
import { CYAN, DIM, GREEN, RESET, YELLOW, cf, readToken, resolveZone } from "./lib/cloudflare";

const DATASET = "knowbase_reports";

type CauseRow = { slug: string; cause: string; hits: number; avg_lead: number };
type OutcomeRow = { slug: string; worked: number; hits: number; note: string };
type SqlResponse<T> = { data?: T[]; error?: string; errors?: { message: string }[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const days = Math.min(90, Math.max(1, Number(arg("days") ?? 7)));
  const token = readToken();
  const { accountId } = await resolveZone(token);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

  const run = async <T>(sql: string): Promise<T[]> => {
    const res = await cf<SqlResponse<T>>(url, token, { method: "POST", body: sql });
    if (res.errors?.length) throw new Error(res.errors[0].message);
    if (res.error) throw new Error(res.error);
    return res.data ?? [];
  };

  // Sum by sample interval rather than count: Analytics Engine samples under load.
  const causes = await run<CauseRow>(`
    SELECT blob3 AS slug, blob4 AS cause,
           sum(_sample_interval) AS hits,
           avg(double1) AS avg_lead
    FROM ${DATASET}
    WHERE timestamp > now() - INTERVAL '${days}' DAY
      AND blob1 = 'diagnosis' AND blob4 != ''
    GROUP BY slug, cause
    ORDER BY slug ASC, hits DESC
    LIMIT 200
  `);

  const undecided = await run<{ hits: number }>(`
    SELECT sum(_sample_interval) AS hits FROM ${DATASET}
    WHERE timestamp > now() - INTERVAL '${days}' DAY
      AND blob1 = 'diagnosis' AND blob4 = ''
  `);

  // Grouped by note as well as outcome: Analytics Engine SQL has no any()/argMax,
  // and distinct notes are distinct information anyway — "fails on k3s 1.29" and
  // "fails behind a proxy" should not collapse into one row.
  const outcomes = await run<OutcomeRow>(`
    SELECT blob3 AS slug, double1 AS worked, blob5 AS note,
           sum(_sample_interval) AS hits
    FROM ${DATASET}
    WHERE timestamp > now() - INTERVAL '${days}' DAY AND blob1 = 'outcome'
    GROUP BY slug, worked, note
    ORDER BY slug ASC, hits DESC
    LIMIT 100
  `);

  console.log(`${CYAN}${DATASET}${RESET} — last ${days}d\n`);

  if (causes.length === 0 && outcomes.length === 0) {
    console.log(`${YELLOW}No agent has reported back yet.${RESET}`);
    console.log(
      `${DIM}/diagnose.json and /outcome.json are advertised in llms.txt; until one is`,
    );
    console.log(`called there is nothing here. Writes take a few minutes to be queryable.${RESET}`);
    return;
  }

  if (causes.length > 0) {
    console.log(`${GREEN}Which cause fired${RESET}`);
    let current = "";
    const bySlug = new Map<string, number>();
    for (const row of causes) bySlug.set(row.slug, (bySlug.get(row.slug) ?? 0) + Number(row.hits));

    for (const row of causes) {
      if (row.slug !== current) {
        current = row.slug;
        console.log(`\n  ${row.slug}`);
      }
      const total = bySlug.get(row.slug) ?? 1;
      const share = ((Number(row.hits) / total) * 100).toFixed(0);
      console.log(
        `    ${String(row.hits).padStart(4)}×  ${share.padStart(3)}%  ${row.cause}` +
          `${DIM} (lead ${Number(row.avg_lead).toFixed(2)})${RESET}`,
      );
    }

    const unresolved = Number(undecided[0]?.hits ?? 0);
    if (unresolved > 0) {
      console.log(
        `\n${DIM}${unresolved} report(s) did not separate the causes — the discriminators`,
      );
      console.log(`for those entries may not be as cheap or as distinct as we think.${RESET}`);
    }
  }

  if (outcomes.length > 0) {
    console.log(`\n${GREEN}Outcomes${RESET} ${DIM}(a lead for re-verification, not evidence)${RESET}`);
    for (const row of outcomes) {
      const label = Number(row.worked) === 1 ? `${GREEN}worked ${RESET}` : `${YELLOW}failed ${RESET}`;
      console.log(`  ${String(row.hits).padStart(4)}× ${label} ${row.slug}`);
      if (row.note) console.log(`${DIM}          ${row.note}${RESET}`);
    }
  }

  console.log(
    `\n${DIM}A cause weighted "edge" that keeps firing, or a "primary" that never does,`,
  );
  console.log(`is the entry telling you its own weighting is wrong.${RESET}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
