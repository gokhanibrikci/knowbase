import { storeDb } from "./agents";

/**
 * D1 access for shared experience. Plain queries only; the rules live in fingerprint.ts
 * and standing.ts so they can be attacked offline by the eval.
 */

export type ProblemRow = {
  id: string;
  fingerprint: string;
  title: string;
  sample: string;
  created_by: string;
  created_at: number;
  seen_count: number;
  last_seen_at: number | null;
  /** Which fingerprint rule produced this key; lets a later rule recompute and merge. */
  fp_version: number;
  /** failure | question */
  kind: string;
  /** When the row was placed in the meaning index; null until then. */
  embedded_at: number | null;
};

export type SolutionRow = {
  id: string;
  problem_id: string;
  body: string;
  created_by: string;
  created_at: number;
  /** JSON array of PackageFact, resolved once at write time. */
  packages: string;
};

export type ReportRow = {
  id: string;
  solution_id: string;
  agent_id: string;
  worked: number;
  env: string;
  note: string;
  prompted: number;
  created_at: number;
  /** joined from agents: who is actually a distinct voice */
  reg_net_hash: string | null;
  agent_created_at: number;
};

export { storeDb };

/**
 * The problem a fingerprint names — directly, or through an alias left by an agent whose
 * differently-keyed text turned out to be the same failure.
 */
export async function problemByFingerprint(
  db: D1Database,
  fingerprint: string,
): Promise<ProblemRow | null> {
  const direct = await db
    .prepare("SELECT * FROM problems WHERE fingerprint = ?")
    .bind(fingerprint)
    .first<ProblemRow>();
  if (direct) return direct;
  return await db
    .prepare(
      "SELECT p.* FROM problem_aliases a JOIN problems p ON p.id = a.problem_id WHERE a.fingerprint = ?",
    )
    .bind(fingerprint)
    .first<ProblemRow>();
}

/** Point a fingerprint at an existing problem. Silently a no-op if the key is taken. */
export async function insertAlias(
  db: D1Database,
  a: { fingerprint: string; problemId: string; fpVersion: number; sample: string; createdBy: string; now: number },
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO problem_aliases (fingerprint, problem_id, fp_version, sample, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(a.fingerprint, a.problemId, a.fpVersion, a.sample, a.createdBy, a.now)
    .run();
}

export async function problemById(db: D1Database, id: string): Promise<ProblemRow | null> {
  return await db.prepare("SELECT * FROM problems WHERE id = ?").bind(id).first<ProblemRow>();
}

export async function insertProblem(
  db: D1Database,
  p: {
    id: string;
    fingerprint: string;
    title: string;
    sample: string;
    createdBy: string;
    fpVersion: number;
    kind: "failure" | "question";
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO problems (id, fingerprint, title, sample, created_by, created_at, seen_count, last_seen_at, fp_version, kind) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    )
    .bind(p.id, p.fingerprint, p.title, p.sample, p.createdBy, p.now, p.now, p.fpVersion, p.kind)
    .run();
}

/**
 * An ask that found its problem. Misses are counted separately, in `asks`, and fold in
 * here the moment a report creates the row — so seen_count really is every ask, hit or
 * miss, and not just the reads of failures that already had an answer.
 */
export async function touchProblem(db: D1Database, id: string, now: number): Promise<void> {
  await db
    .prepare("UPDATE problems SET seen_count = seen_count + 1, last_seen_at = ? WHERE id = ?")
    .bind(now, id)
    .run();
}

/* -- asks: what was asked and got nothing ----------------------------------- */

export type AskRow = {
  fingerprint: string;
  fp_version: number;
  headline: string;
  sample: string;
  /** JSON array of "name@version" strings. */
  environments: string;
  verdict: string;
  ask_count: number;
  first_asked_at: number;
  last_asked_at: number;
  /** failure | question */
  kind: string;
  embedded_at: number | null;
};

export async function markEmbedded(
  db: D1Database,
  table: "problems" | "asks",
  key: string,
  now: number,
): Promise<void> {
  const column = table === "problems" ? "id" : "fingerprint";
  await db.prepare(`UPDATE ${table} SET embedded_at = ? WHERE ${column} = ?`).bind(now, key).run();
}

/**
 * A recall that found nothing, kept — one row per fingerprint, counted. This is the
 * demand signal the store had no way to see: every ask that arrives before the first
 * answer exists. Returns the count including this ask.
 */
export async function recordAsk(
  db: D1Database,
  a: {
    fingerprint: string;
    fpVersion: number;
    headline: string;
    sample: string;
    environments: string[];
    verdict: "none" | "similar";
    kind: "failure" | "question";
    now: number;
  },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO asks (fingerprint, fp_version, headline, sample, environments, verdict, ask_count, first_asked_at, last_asked_at, kind)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         ask_count = asks.ask_count + 1,
         last_asked_at = excluded.last_asked_at,
         verdict = excluded.verdict,
         environments = CASE WHEN excluded.environments = '[]' THEN asks.environments ELSE excluded.environments END
       RETURNING ask_count`,
    )
    .bind(
      a.fingerprint,
      a.fpVersion,
      a.headline,
      a.sample,
      JSON.stringify(a.environments),
      a.verdict,
      a.now,
      a.now,
      a.kind,
    )
    .first<{ ask_count: number }>();
  return row?.ask_count ?? 1;
}

export async function askByFingerprint(db: D1Database, fingerprint: string): Promise<AskRow | null> {
  return await db.prepare("SELECT * FROM asks WHERE fingerprint = ?").bind(fingerprint).first<AskRow>();
}

/**
 * When a problem row finally appears for a fingerprint agents were already asking about,
 * the asks it collected become its seen_count and the ask row retires. Returns how many
 * asks were waiting.
 */
export async function foldAskIntoProblem(
  db: D1Database,
  fingerprint: string,
  problemId: string,
): Promise<number> {
  const ask = await askByFingerprint(db, fingerprint);
  if (!ask) return 0;
  await db.batch([
    db
      .prepare("UPDATE problems SET seen_count = seen_count + ? WHERE id = ?")
      .bind(ask.ask_count, problemId),
    db.prepare("DELETE FROM asks WHERE fingerprint = ?").bind(fingerprint),
  ]);
  return ask.ask_count;
}

/**
 * The queue proper: failures asked about that no report has ever answered, most asked
 * first. `minCount` lets the public page wait for a second ask before showing a headline,
 * while the maintainer's report sees everything.
 */
export async function wantedAsks(db: D1Database, limit: number, minCount: number): Promise<AskRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.* FROM asks a
        LEFT JOIN problems p ON p.fingerprint = a.fingerprint
        LEFT JOIN problem_aliases al ON al.fingerprint = a.fingerprint
        WHERE p.id IS NULL AND al.problem_id IS NULL AND a.ask_count >= ?
        ORDER BY a.ask_count DESC, a.last_asked_at DESC LIMIT ?`,
    )
    .bind(minCount, limit)
    .all<AskRow>();
  return results ?? [];
}

export async function unansweredAskCount(db: D1Database, minCount: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM asks a
        LEFT JOIN problems p ON p.fingerprint = a.fingerprint
        LEFT JOIN problem_aliases al ON al.fingerprint = a.fingerprint
        WHERE p.id IS NULL AND al.problem_id IS NULL AND a.ask_count >= ?`,
    )
    .bind(minCount)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The fallback path when no fingerprint matches. Exact fingerprints only find agents who
 * saw a near-identical string; this finds the ones who described the same wall differently.
 * Deliberately simple — LIKE over title and sample — because the caller re-ranks by term
 * overlap and shows the sample so the reader can judge for itself.
 */
export async function searchProblems(
  db: D1Database,
  terms: string[],
  limit: number,
): Promise<ProblemRow[]> {
  const useful = terms.filter((t) => t.length > 2).slice(0, 6);
  if (useful.length === 0) return [];
  // ESCAPE binds to the LIKE it follows, not to a parenthesised group: trailing it
  // after `(... OR ...)` is a syntax error, and it made every miss return 500 — the
  // most common call there is on a young store, and the one that records the miss.
  const clause = useful
    .map(() => "(title LIKE ? ESCAPE '\\' OR sample LIKE ? ESCAPE '\\')")
    .join(" OR ");
  const binds = useful.flatMap((t) => {
    const like = `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return [like, like];
  });
  const { results } = await db
    .prepare(`SELECT * FROM problems WHERE ${clause} ORDER BY seen_count DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<ProblemRow>();
  return results ?? [];
}

export async function solutionsFor(db: D1Database, problemId: string): Promise<SolutionRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM solutions WHERE problem_id = ? ORDER BY created_at")
    .bind(problemId)
    .all<SolutionRow>();
  return results ?? [];
}

export async function solutionById(db: D1Database, id: string): Promise<SolutionRow | null> {
  return await db.prepare("SELECT * FROM solutions WHERE id = ?").bind(id).first<SolutionRow>();
}

export async function insertSolution(
  db: D1Database,
  s: {
    id: string;
    problemId: string;
    body: string;
    createdBy: string;
    packages: string;
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO solutions (id, problem_id, body, created_by, created_at, packages) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(s.id, s.problemId, s.body, s.createdBy, s.now, s.packages)
    .run();
}

export async function reportsFor(
  db: D1Database,
  solutionIds: string[],
): Promise<Map<string, ReportRow[]>> {
  const bySolution = new Map<string, ReportRow[]>();
  if (solutionIds.length === 0) return bySolution;
  const placeholders = solutionIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT r.*, a.reg_net_hash, a.created_at AS agent_created_at
         FROM reports r JOIN agents a ON a.id = r.agent_id
        WHERE r.solution_id IN (${placeholders}) ORDER BY r.created_at`,
    )
    .bind(...solutionIds)
    .all<ReportRow>();
  for (const row of results ?? []) {
    const list = bySolution.get(row.solution_id) ?? [];
    list.push(row);
    bySolution.set(row.solution_id, list);
  }
  return bySolution;
}

/**
 * One standing report per agent per solution. An agent that changes its mind replaces its
 * own report; it never adds a second one, which is what keeps a count of "distinct agents"
 * meaning what it says.
 */
export async function upsertReport(
  db: D1Database,
  r: {
    id: string;
    solutionId: string;
    agentId: string;
    worked: boolean;
    env: string;
    note: string;
    prompted: boolean;
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO reports (id, solution_id, agent_id, worked, env, note, prompted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(solution_id, agent_id) DO UPDATE SET worked = excluded.worked, env = excluded.env, note = excluded.note, prompted = excluded.prompted, created_at = excluded.created_at",
    )
    .bind(
      r.id,
      r.solutionId,
      r.agentId,
      r.worked ? 1 : 0,
      r.env,
      r.note,
      r.prompted ? 1 : 0,
      r.now,
    )
    .run();
}

export async function reportsToday(db: D1Database, agentId: string, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM reports WHERE agent_id = ? AND created_at > ?")
    .bind(agentId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function solutionsToday(
  db: D1Database,
  agentId: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM solutions WHERE created_by = ? AND created_at > ?")
    .bind(agentId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export type XpVitals = {
  problems: number;
  solutions: number;
  reports: number;
  agents: number;
  unsolved: number;
};

export async function xpVitals(db: D1Database): Promise<XpVitals> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM problems) AS problems,
         (SELECT COUNT(*) FROM solutions) AS solutions,
         (SELECT COUNT(*) FROM reports) AS reports,
         (SELECT COUNT(DISTINCT agent_id) FROM reports) AS agents,
         (SELECT COUNT(*) FROM problems p WHERE NOT EXISTS
            (SELECT 1 FROM solutions s JOIN reports r ON r.solution_id = s.id
             WHERE s.problem_id = p.id AND r.worked = 1)) AS unsolved`,
    )
    .first<XpVitals>();
  return (
    row ?? { problems: 0, solutions: 0, reports: 0, agents: 0, unsolved: 0 }
  );
}

export async function recentProblems(db: D1Database, limit: number): Promise<ProblemRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM problems ORDER BY last_seen_at DESC NULLS LAST LIMIT ?")
    .bind(limit)
    .all<ProblemRow>();
  return results ?? [];
}

/** What agents keep asking about and nobody has solved: the queue, in one query. */
export async function wantedProblems(db: D1Database, limit: number): Promise<ProblemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM problems p WHERE NOT EXISTS
         (SELECT 1 FROM solutions s JOIN reports r ON r.solution_id = s.id
          WHERE s.problem_id = p.id AND r.worked = 1)
       ORDER BY seen_count DESC LIMIT ?`,
    )
    .bind(limit)
    .all<ProblemRow>();
  return results ?? [];
}

export type Contribution = {
  problem_id: string;
  problem_title: string;
  solution_id: string;
  body: string;
  worked: number;
  created_at: number;
};

/** What one agent has actually put into the store: its reports, newest first. */
export async function contributionsBy(
  db: D1Database,
  agentId: string,
  limit: number,
): Promise<Contribution[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id AS problem_id, p.title AS problem_title, s.id AS solution_id, s.body,
              r.worked, r.created_at
         FROM reports r
         JOIN solutions s ON s.id = r.solution_id
         JOIN problems p ON p.id = s.problem_id
        WHERE r.agent_id = ?
        ORDER BY r.created_at DESC LIMIT ?`,
    )
    .bind(agentId, limit)
    .all<Contribution>();
  return results ?? [];
}

export async function contributionCounts(
  db: D1Database,
  agentId: string,
): Promise<{ reports: number; authored: number; confirmed: number }> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM reports WHERE agent_id = ?1) AS reports,
              (SELECT COUNT(*) FROM solutions WHERE created_by = ?1) AS authored,
              (SELECT COUNT(*) FROM reports WHERE agent_id = ?1 AND worked = 1) AS confirmed`,
    )
    .bind(agentId)
    .first<{ reports: number; authored: number; confirmed: number }>();
  return { reports: row?.reports ?? 0, authored: row?.authored ?? 0, confirmed: row?.confirmed ?? 0 };
}

export type Showcase = {
  problem: ProblemRow;
  worked: SolutionRow | null;
  deadEnd: SolutionRow | null;
};

/**
 * A real record to put in front of someone deciding whether to wire this up. Prefers a
 * failure that has both an answer and a dead end, because the dead end is the half that
 * makes the case. Returns null rather than inventing one when the store cannot show it.
 */
export async function showcase(db: D1Database): Promise<Showcase | null> {
  const problem = await db
    .prepare(
      `SELECT p.* FROM problems p
        WHERE EXISTS (SELECT 1 FROM solutions s JOIN reports r ON r.solution_id = s.id
                       WHERE s.problem_id = p.id AND r.worked = 1)
          AND EXISTS (SELECT 1 FROM solutions s
                       WHERE s.problem_id = p.id
                         AND NOT EXISTS (SELECT 1 FROM reports r
                                          WHERE r.solution_id = s.id AND r.worked = 1))
        ORDER BY p.seen_count DESC LIMIT 1`,
    )
    .first<ProblemRow>();
  if (!problem) return null;

  const solutions = await solutionsFor(db, problem.id);
  const reports = await reportsFor(db, solutions.map((s) => s.id));
  const succeeded = (id: string) => (reports.get(id) ?? []).some((r) => r.worked === 1);

  return {
    problem,
    worked: solutions.find((s) => succeeded(s.id)) ?? null,
    deadEnd: solutions.find((s) => !succeeded(s.id)) ?? null,
  };
}

export type DirectoryRow = {
  id: string;
  display: string;
  created_at: number;
  last_seen_at: number | null;
  reports: number;
  worked: number;
  authored: number;
};

/**
 * Who is actually using this.
 *
 * Contributors only. A registered handle that has never written anything is not
 * adoption, and listing it pads a number on the one page whose job is to be honest
 * about how young this is. The silent ones are counted separately by idleHandles.
 */
export async function agentDirectory(db: D1Database, limit: number): Promise<DirectoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.display, a.created_at, a.last_seen_at,
              (SELECT COUNT(*) FROM reports r WHERE r.agent_id = a.id) AS reports,
              (SELECT COUNT(*) FROM reports r WHERE r.agent_id = a.id AND r.worked = 1) AS worked,
              (SELECT COUNT(*) FROM solutions s WHERE s.created_by = a.id) AS authored
         FROM agents a
        WHERE (SELECT COUNT(*) FROM reports r WHERE r.agent_id = a.id) > 0
        ORDER BY reports DESC, a.last_seen_at DESC NULLS LAST
        LIMIT ?`,
    )
    .bind(limit)
    .all<DirectoryRow>();
  return results ?? [];
}

export type ActivityRow = {
  agent_id: string;
  display: string;
  problem_id: string;
  problem_title: string;
  solution_id: string;
  body: string;
  worked: number;
  note: string;
  env: string;
  created_at: number;
};

/**
 * The write side of the traffic, in order: who decided what about which failure. Reads
 * are not itemised here — a recall leaves a count on the problem it matched, not a row,
 * because logging every question an agent asks is a surveillance product and this is not
 * one. `problems.seen_count` is the honest aggregate.
 */
export async function recentActivity(db: D1Database, limit: number): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.agent_id, a.display, p.id AS problem_id, p.title AS problem_title,
              s.id AS solution_id, s.body, r.worked, r.note, r.env, r.created_at
         FROM reports r
         JOIN agents a ON a.id = r.agent_id
         JOIN solutions s ON s.id = r.solution_id
         JOIN problems p ON p.id = s.problem_id
        ORDER BY r.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<ActivityRow>();
  return results ?? [];
}

/** What agents are asking about right now, whether or not anyone has answered. */
export async function mostAsked(db: D1Database, limit: number): Promise<ProblemRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM problems WHERE seen_count > 0 ORDER BY seen_count DESC LIMIT ?")
    .bind(limit)
    .all<ProblemRow>();
  return results ?? [];
}

export type Savings = {
  /** Times an agent asked about a failure that already had an answer. */
  answersServed: number;
  /** Attempts recorded as not working — turns the next agent does not spend. */
  deadEndsRecorded: number;
  /** Failures asked about more than once: the ones that were worth writing down. */
  repeated: number;
};

/**
 * The only numbers here that mean anything to a person: how often the store answered
 * instead of sending someone back to a search engine, and how many wrong turns it can
 * now warn about. Both are counted, never estimated.
 */
export async function savings(db: D1Database): Promise<Savings> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(seen_count), 0) FROM problems p
           WHERE EXISTS (SELECT 1 FROM solutions s JOIN reports r ON r.solution_id = s.id
                          WHERE s.problem_id = p.id AND r.worked = 1)) AS answersServed,
         (SELECT COUNT(*) FROM solutions s
           WHERE NOT EXISTS (SELECT 1 FROM reports r
                              WHERE r.solution_id = s.id AND r.worked = 1)) AS deadEndsRecorded,
         (SELECT COUNT(*) FROM problems WHERE seen_count > 1) AS repeated`,
    )
    .first<Savings>();
  return row ?? { answersServed: 0, deadEndsRecorded: 0, repeated: 0 };
}

export type DayCount = { day: string; reports: number };

/** Reports per day, oldest first, with empty days present so a chart does not lie. */
export async function reportsByDay(db: D1Database, days: number): Promise<DayCount[]> {
  const since = Date.now() - days * 86_400_000;
  const { results } = await db
    .prepare(
      `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS reports
         FROM reports WHERE created_at > ? GROUP BY day`,
    )
    .bind(since)
    .all<DayCount>();
  const seen = new Map((results ?? []).map((r) => [r.day, r.reports]));
  const out: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, reports: seen.get(day) ?? 0 });
  }
  return out;
}

/**
 * What the store actually knows about, taken from the environments agents reported
 * rather than from anything we decided it should cover.
 */
export async function coverage(db: D1Database, limit: number): Promise<{ name: string; n: number }[]> {
  const { results } = await db
    .prepare("SELECT env FROM reports WHERE env != '[]'")
    .all<{ env: string }>();
  const counts = new Map<string, number>();
  for (const row of results ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.env);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const at = entry.lastIndexOf("@");
      const name = at > 0 ? entry.slice(0, at) : entry;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
}

export type Discovery = {
  agent_id: string;
  display: string;
  problem_id: string;
  problem_title: string;
  body: string;
  worked: number;
  created_at: number;
};

/** The stream a person reads: who found out what, in order, in plain language. */
export async function discoveries(db: D1Database, limit: number): Promise<Discovery[]> {
  const { results } = await db
    .prepare(
      `SELECT r.agent_id, a.display, p.id AS problem_id, p.title AS problem_title,
              s.body, r.worked, r.created_at
         FROM reports r
         JOIN agents a ON a.id = r.agent_id
         JOIN solutions s ON s.id = r.solution_id
         JOIN problems p ON p.id = s.problem_id
        ORDER BY r.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Discovery>();
  return results ?? [];
}

/**
 * Withdrawing your own report, and anything it leaves behind that nobody else is using.
 *
 * An agent that reports the wrong thing has to be able to take it back — otherwise the
 * only way to correct the record is to contradict yourself, which leaves both statements
 * standing. Deletion is strictly limited to what the caller contributed: another agent's
 * report on the same solution keeps it alive, and a problem survives as long as it holds
 * anyone's work or anyone has asked about it more than once.
 */
export async function retract(
  db: D1Database,
  agentId: string,
  solutionId: string,
): Promise<{ report: boolean; solution: boolean; problem: boolean; problemId?: string }> {
  const solution = await solutionById(db, solutionId);
  if (!solution) return { report: false, solution: false, problem: false };

  const mine = await db
    .prepare("SELECT id FROM reports WHERE solution_id = ? AND agent_id = ?")
    .bind(solutionId, agentId)
    .first();
  if (!mine) return { report: false, solution: false, problem: false };

  await db
    .prepare("DELETE FROM reports WHERE solution_id = ? AND agent_id = ?")
    .bind(solutionId, agentId)
    .run();

  // The solution goes only if it was this agent's and nobody else has weighed in.
  const others = await db
    .prepare("SELECT COUNT(*) AS n FROM reports WHERE solution_id = ?")
    .bind(solutionId)
    .first<{ n: number }>();
  const dropSolution = solution.created_by === agentId && (others?.n ?? 0) === 0;
  if (dropSolution) {
    await db.prepare("DELETE FROM solutions WHERE id = ?").bind(solutionId).run();
  }

  // And the problem only if it is now empty and nobody kept asking about it.
  const remaining = await db
    .prepare("SELECT COUNT(*) AS n FROM solutions WHERE problem_id = ?")
    .bind(solution.problem_id)
    .first<{ n: number }>();
  const problem = await problemById(db, solution.problem_id);
  // An empty failure record still has value once OTHER agents are hitting it — that is
  // the wanted list. Below a handful of asks the count is almost certainly the caller's
  // own recalls, so the empty shell goes with the work it was holding; above it, the
  // record stays as a wanted entry even with nothing attempted against it.
  const ASKED_BY_OTHERS = 3;
  const dropProblem =
    (remaining?.n ?? 0) === 0 &&
    problem !== null &&
    problem.created_by === agentId &&
    problem.seen_count <= ASKED_BY_OTHERS;
  if (dropProblem) {
    await db.prepare("DELETE FROM problem_aliases WHERE problem_id = ?").bind(solution.problem_id).run();
    await db.prepare("DELETE FROM problems WHERE id = ?").bind(solution.problem_id).run();
  }

  return { report: true, solution: dropSolution, problem: dropProblem, problemId: solution.problem_id };
}

/** Handles claimed that have never written anything. Counted, not listed. */
export async function idleHandles(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM agents a
        WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.agent_id = a.id)`,
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Deleting an account, and everything only that account contributed.
 *
 * The right to walk away has to be real, or "your record is yours" is decoration. The
 * limit is other people's work: a solution another agent has reported on is partly
 * theirs now, so it stays and this refuses rather than destroying it silently. Retract
 * those individually first, or leave them — either is a choice the caller gets to make
 * knowingly.
 */
export async function forgetAgent(
  db: D1Database,
  agentId: string,
): Promise<{ ok: boolean; blockedBy?: number; removedProblems?: string[] }> {
  const shared = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM solutions s
        WHERE s.created_by = ?1
          AND EXISTS (SELECT 1 FROM reports r WHERE r.solution_id = s.id AND r.agent_id != ?1)`,
    )
    .bind(agentId)
    .first<{ n: number }>();
  if ((shared?.n ?? 0) > 0) return { ok: false, blockedBy: shared?.n ?? 0 };

  // Order matters: children before parents, or the foreign keys refuse.
  const owned = await db
    .prepare("SELECT id, problem_id FROM solutions WHERE created_by = ?")
    .bind(agentId)
    .all<{ id: string; problem_id: string }>();
  const ownProblems = await db
    .prepare("SELECT id FROM problems WHERE created_by = ?")
    .bind(agentId)
    .all<{ id: string }>();
  const candidates = new Set([
    ...(owned.results ?? []).map((s) => s.problem_id),
    ...(ownProblems.results ?? []).map((p) => p.id),
  ]);

  await db.prepare("DELETE FROM reports WHERE agent_id = ?").bind(agentId).run();
  // Alias links this agent left are its contribution too.
  await db.prepare("DELETE FROM problem_aliases WHERE created_by = ?").bind(agentId).run();
  for (const s of owned.results ?? []) {
    await db.prepare("DELETE FROM reports WHERE solution_id = ?").bind(s.id).run();
    await db.prepare("DELETE FROM solutions WHERE id = ?").bind(s.id).run();
  }
  for (const problemId of new Set((owned.results ?? []).map((s) => s.problem_id))) {
    await db
      .prepare(
        `DELETE FROM problem_aliases WHERE problem_id = ?1
           AND EXISTS (SELECT 1 FROM problems WHERE id = ?1 AND created_by = ?2)
           AND NOT EXISTS (SELECT 1 FROM solutions WHERE problem_id = ?1)`,
      )
      .bind(problemId, agentId)
      .run();
    await db
      .prepare(
        `DELETE FROM problems WHERE id = ?1 AND created_by = ?2
           AND NOT EXISTS (SELECT 1 FROM solutions WHERE problem_id = ?1)`,
      )
      .bind(problemId, agentId)
      .run();
  }
  await db
    .prepare(
      `DELETE FROM problem_aliases WHERE problem_id IN
         (SELECT id FROM problems WHERE created_by = ?1
            AND NOT EXISTS (SELECT 1 FROM solutions WHERE problem_id = problems.id))`,
    )
    .bind(agentId)
    .run();
  await db
    .prepare("DELETE FROM problems WHERE created_by = ?1 AND NOT EXISTS (SELECT 1 FROM solutions WHERE problem_id = problems.id)")
    .bind(agentId)
    .run();

  await db.prepare("DELETE FROM agents WHERE id = ?").bind(agentId).run();

  // Which of the problems this agent touched are gone now, so their vectors can go too.
  const removed: string[] = [];
  for (const id of candidates) {
    if (!(await problemById(db, id))) removed.push(id);
  }
  return { ok: true, removedProblems: removed };
}
