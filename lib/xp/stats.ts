/**
 * Outcomes: what the store did for the people who use it, in the unit they are paid in.
 *
 * A team that runs its own knowbase asks one question — did it save us time? — and the
 * answer has to survive a sceptic. So nothing here is estimated from token prices or
 * guessed per query. A "repeat failure caught" is a recall that landed on a problem which
 * already had a solution some report says worked. The engineer time behind it is the
 * time the SAME problem measurably took to solve the first time: from the first ask that
 * got no working answer to the first report that something worked, clamped to a floor
 * and a ceiling. A hit on a problem that was never clocked borrows the median of the
 * ones that were, and is counted as borrowed. When nothing has been clocked yet, no
 * minutes are claimed at all.
 */

export type RecallFact = {
  verdict: "exact" | "similar" | "none";
  kind: "failure" | "question";
  answered: boolean;
  problemId: string | null;
  title: string | null;
  solvedMs: number | null;
};

export type ReportFact = { worked: boolean; prompted: boolean };

export type Outcomes = {
  days: number;
  recalls: number;
  /** Exact hits on failures that had a working fix: the number the product exists for. */
  repeatFailuresCaught: number;
  questionsAnswered: number;
  /** Exact hits on problems that had only dead ends so far. */
  hitsWithoutFix: number;
  misses: number;
  reports: number;
  deadEndsRecorded: number;
  /** Reports that the fix recall handed over worked: the caught failures that closed. */
  fixesConfirmedFromMemory: number;
  engineerMinutes: {
    saved: number;
    /** Caught hits whose problem was clocked itself. */
    measured: number;
    /** Caught hits valued at the median of clocked problems. */
    borrowed: number;
    /** Caught hits worth nothing yet, because nothing has been clocked. */
    unvalued: number;
    medianMinutes: number | null;
    floorMinutes: number;
    capMinutes: number;
  };
  top: { problemId: string; title: string; hits: number; minutes: number | null }[];
  method: string;
};

/** Under a minute is a retry, not a solving; over four hours the clock was left running. */
export const FLOOR_MS = 60_000;
export const CAP_MS = 4 * 60 * 60_000;

function clamp(ms: number): number {
  return Math.min(CAP_MS, Math.max(FLOOR_MS, ms));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const METHOD =
  "A repeat failure is counted when a recall lands on a problem that already had a fix some report says worked. Its engineer time is the clocked time the same problem took to solve the first time — first unanswered ask to first working report, clamped between one minute and four hours. Problems never clocked borrow the median of those that were; when nothing is clocked, no time is claimed.";

export function summarise(
  days: number,
  recalls: RecallFact[],
  reports: ReportFact[],
  clocked: number[],
): Outcomes {
  const medianMs = median(clocked.map(clamp));
  const perProblem = new Map<string, { title: string; hits: number; ms: number | null }>();
  let caught = 0;
  let questions = 0;
  let withoutFix = 0;
  let misses = 0;
  let savedMs = 0;
  let measured = 0;
  let borrowed = 0;
  let unvalued = 0;

  for (const r of recalls) {
    if (r.verdict !== "exact") {
      misses += 1;
      continue;
    }
    if (!r.answered) {
      withoutFix += 1;
      continue;
    }
    if (r.kind === "question") {
      questions += 1;
      continue;
    }
    caught += 1;
    let worth: number | null = null;
    if (r.solvedMs !== null) {
      worth = clamp(r.solvedMs);
      measured += 1;
    } else if (medianMs !== null) {
      worth = medianMs;
      borrowed += 1;
    } else {
      unvalued += 1;
    }
    if (worth !== null) savedMs += worth;
    if (r.problemId) {
      const row = perProblem.get(r.problemId) ?? { title: r.title ?? r.problemId, hits: 0, ms: null };
      row.hits += 1;
      if (worth !== null) row.ms = (row.ms ?? 0) + worth;
      perProblem.set(r.problemId, row);
    }
  }

  const top = [...perProblem.entries()]
    .sort((a, b) => b[1].hits - a[1].hits)
    .slice(0, 10)
    .map(([problemId, v]) => ({
      problemId,
      title: v.title,
      hits: v.hits,
      minutes: v.ms === null ? null : Math.round(v.ms / 60_000),
    }));

  return {
    days,
    recalls: recalls.length,
    repeatFailuresCaught: caught,
    questionsAnswered: questions,
    hitsWithoutFix: withoutFix,
    misses,
    reports: reports.length,
    deadEndsRecorded: reports.filter((r) => !r.worked).length,
    fixesConfirmedFromMemory: reports.filter((r) => r.worked && r.prompted).length,
    engineerMinutes: {
      saved: Math.round(savedMs / 60_000),
      measured,
      borrowed,
      unvalued,
      medianMinutes: medianMs === null ? null : Math.round(medianMs / 60_000),
      floorMinutes: FLOOR_MS / 60_000,
      capMinutes: CAP_MS / 60_000,
    },
    top,
    method: METHOD,
  };
}

export async function loadOutcomes(db: D1Database, days: number): Promise<Outcomes> {
  const since = Date.now() - days * 86_400_000;
  const [recalls, reports, clocked] = await Promise.all([
    db
      .prepare(
        `SELECT r.verdict, r.kind, r.answered, r.problem_id, p.title, p.solved_ms
           FROM recalls r LEFT JOIN problems p ON p.id = r.problem_id
          WHERE r.created_at >= ?`,
      )
      .bind(since)
      .all<{
        verdict: RecallFact["verdict"];
        kind: RecallFact["kind"];
        answered: number;
        problem_id: string | null;
        title: string | null;
        solved_ms: number | null;
      }>(),
    db
      .prepare("SELECT worked, prompted FROM reports WHERE created_at >= ?")
      .bind(since)
      .all<{ worked: number; prompted: number }>(),
    db
      .prepare("SELECT solved_ms FROM problems WHERE solved_ms IS NOT NULL")
      .all<{ solved_ms: number }>(),
  ]);
  return summarise(
    days,
    (recalls.results ?? []).map((r) => ({
      verdict: r.verdict,
      kind: r.kind,
      answered: r.answered === 1,
      problemId: r.problem_id,
      title: r.title,
      solvedMs: r.solved_ms,
    })),
    (reports.results ?? []).map((r) => ({ worked: r.worked === 1, prompted: r.prompted === 1 })),
    (clocked.results ?? []).map((r) => r.solved_ms),
  );
}
