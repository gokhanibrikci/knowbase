/**
 * Outcomes: what the store did for the people who use it, in the unit they are paid in.
 *
 * A team that runs its own knowbase asks one question — did it save us time? — and the
 * answer has to survive a sceptic in their own finance meeting. So nothing here is
 * estimated from token prices or guessed per query, and every number is deliberately
 * biased downwards where the evidence runs out.
 *
 *   what counts   A repeat failure caught is an OCCASION: a recall that landed on a
 *                 problem which already had a solution some report says worked. The same
 *                 asker meeting the same failure again within the hour is one occasion,
 *                 not two — a hook and a model both reacting to one failed command, or a
 *                 CI job retried three times, is one person being saved one search.
 *   what it is    The engineer time behind an occasion is the time that SAME problem
 *     worth       measurably took to solve the first time: first ask that got no working
 *                 answer, to first report that something worked.
 *   what is       A clock longer than the cap is not a measurement of a solve — it is a
 *     thrown      clock somebody left running across days — so it is excluded from the
 *     away        median and its problem is valued like an unclocked one. A problem never
 *                 clocked borrows the median of those that were. When nothing has been
 *                 clocked at all, no time is claimed.
 */

/** Under a minute is a retry, not a solving; over four hours the clock was left running. */
export const FLOOR_MS = 60_000;
export const CAP_MS = 4 * 60 * 60_000;
/** Two hits from one asker on one problem inside this window are one occasion. */
export const OCCASION_MS = 60 * 60_000;

/** One problem that was met again after it already had a working fix. */
export type CaughtProblem = {
  problemId: string;
  title: string;
  /** Distinct asker-hours: how many separate occasions the store answered. */
  occasions: number;
  /** The clocked cost of solving this problem the first time, if it was clocked. */
  solvedMs: number | null;
};

/** Everything countable without looking at a single problem. */
export type Totals = {
  recalls: number;
  misses: number;
  questionsAnswered: number;
  hitsWithoutFix: number;
  reports: number;
  deadEndsRecorded: number;
  fixesConfirmedFromMemory: number;
};

export type Outcomes = Totals & {
  days: number;
  repeatFailuresCaught: number;
  engineerMinutes: {
    saved: number;
    /** Occasions valued at their own problem's clocked time. */
    measured: number;
    /** Occasions on problems that were never clocked, valued at the median. */
    borrowed: number;
    /** Occasions whose problem's clock ran past the cap, valued at the median too. */
    capped: number;
    /** Occasions worth nothing yet, because nothing anywhere has been clocked. */
    unvalued: number;
    medianMinutes: number | null;
    floorMinutes: number;
    capMinutes: number;
  };
  top: { problemId: string; title: string; hits: number; minutes: number | null }[];
  method: string;
};

/** A clocked interval that is credible as one solve, or null. */
export function credible(ms: number | null): number | null {
  if (ms === null || ms > CAP_MS) return null;
  return Math.max(FLOOR_MS, ms);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const METHOD =
  "A repeat failure caught is one occasion: a recall that landed on a problem which already had a fix some report says worked, counting the same asker on the same problem within an hour once. Its engineer time is the clocked time that problem took to solve the first time — first unanswered ask to first working report — when that interval is between one minute and four hours. Longer intervals are treated as a clock left running, not a measurement: they are excluded from the median, and those problems are valued at it like problems that were never clocked. When nothing has been clocked, no time is claimed.";

export function summarise(
  days: number,
  totals: Totals,
  caught: CaughtProblem[],
  clocked: (number | null)[],
): Outcomes {
  const medianMs = median(clocked.map(credible).filter((v): v is number => v !== null));

  let savedMs = 0;
  let measured = 0;
  let borrowed = 0;
  let capped = 0;
  let unvalued = 0;

  const top = caught.map((c) => {
    const own = credible(c.solvedMs);
    const worth = own ?? medianMs;
    if (own !== null) measured += c.occasions;
    else if (medianMs === null) unvalued += c.occasions;
    else if (c.solvedMs !== null) capped += c.occasions;
    else borrowed += c.occasions;
    if (worth !== null) savedMs += worth * c.occasions;
    return {
      problemId: c.problemId,
      title: c.title,
      hits: c.occasions,
      minutes: worth === null ? null : Math.round((worth * c.occasions) / 60_000),
    };
  });
  top.sort((a, b) => b.hits - a.hits || (b.minutes ?? 0) - (a.minutes ?? 0));

  return {
    ...totals,
    days,
    repeatFailuresCaught: caught.reduce((n, c) => n + c.occasions, 0),
    engineerMinutes: {
      saved: Math.round(savedMs / 60_000),
      measured,
      borrowed,
      capped,
      unvalued,
      medianMinutes: medianMs === null ? null : Math.round(medianMs / 60_000),
      floorMinutes: FLOOR_MS / 60_000,
      capMinutes: CAP_MS / 60_000,
    },
    top: top.slice(0, 10),
    method: METHOD,
  };
}

/**
 * The counting happens in the database. An earlier version read every recall and report
 * row of the window into memory to count them there, which is fine for a demo store and
 * exactly wrong for the customer this is built for: a few hundred developers produce more
 * rows in a month than one query should ever return.
 */
export async function loadOutcomes(db: D1Database, days: number): Promise<Outcomes> {
  const since = Date.now() - days * 86_400_000;
  const [totals, caught, clocked] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM recalls WHERE created_at >= ?1) AS recalls,
           (SELECT COUNT(*) FROM recalls WHERE created_at >= ?1 AND verdict != 'exact') AS misses,
           (SELECT COUNT(*) FROM recalls WHERE created_at >= ?1 AND verdict = 'exact' AND answered = 1 AND kind = 'question') AS questionsAnswered,
           (SELECT COUNT(*) FROM recalls WHERE created_at >= ?1 AND verdict = 'exact' AND answered = 0) AS hitsWithoutFix,
           (SELECT COUNT(*) FROM reports WHERE created_at >= ?1) AS reports,
           (SELECT COUNT(*) FROM reports WHERE created_at >= ?1 AND worked = 0) AS deadEndsRecorded,
           (SELECT COUNT(*) FROM reports WHERE created_at >= ?1 AND worked = 1 AND prompted = 1) AS fixesConfirmedFromMemory`,
      )
      .bind(since)
      .first<Totals>(),
    db
      .prepare(
        `SELECT o.problem_id AS problemId, COUNT(*) AS occasions,
                COALESCE(p.title, o.problem_id) AS title, p.solved_ms AS solvedMs
           FROM (SELECT problem_id, asker, created_at / ?2 AS occasion
                   FROM recalls
                  WHERE created_at >= ?1 AND verdict = 'exact' AND answered = 1 AND kind = 'failure'
                    AND problem_id IS NOT NULL
                  GROUP BY problem_id, asker, occasion) o
           LEFT JOIN problems p ON p.id = o.problem_id
          GROUP BY o.problem_id
          ORDER BY occasions DESC`,
      )
      .bind(since, OCCASION_MS)
      .all<CaughtProblem>(),
    db.prepare("SELECT solved_ms FROM problems WHERE solved_ms IS NOT NULL").all<{ solved_ms: number }>(),
  ]);

  return summarise(
    days,
    totals ?? {
      recalls: 0,
      misses: 0,
      questionsAnswered: 0,
      hitsWithoutFix: 0,
      reports: 0,
      deadEndsRecorded: 0,
      fixesConfirmedFromMemory: 0,
    },
    caught.results ?? [],
    (clocked.results ?? []).map((r) => r.solved_ms),
  );
}
