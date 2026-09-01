import { worldDb } from "@/lib/world/store";

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
};

export type SolutionRow = {
  id: string;
  problem_id: string;
  body: string;
  created_by: string;
  created_at: number;
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
  agent_status: string;
  agent_created_at: number;
};

export { worldDb };

export async function problemByFingerprint(
  db: D1Database,
  fingerprint: string,
): Promise<ProblemRow | null> {
  return await db
    .prepare("SELECT * FROM problems WHERE fingerprint = ?")
    .bind(fingerprint)
    .first<ProblemRow>();
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
    now: number;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO problems (id, fingerprint, title, sample, created_by, created_at, seen_count, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
    .bind(p.id, p.fingerprint, p.title, p.sample, p.createdBy, p.now, p.now)
    .run();
}

/** Every ask counts, hit or miss: the count is the authoring queue. */
export async function touchProblem(db: D1Database, id: string, now: number): Promise<void> {
  await db
    .prepare("UPDATE problems SET seen_count = seen_count + 1, last_seen_at = ? WHERE id = ?")
    .bind(now, id)
    .run();
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
  const clause = useful.map(() => "(title LIKE ? OR sample LIKE ?)").join(" OR ");
  const binds = useful.flatMap((t) => {
    const like = `%${t.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    return [like, like];
  });
  const { results } = await db
    .prepare(
      `SELECT * FROM problems WHERE ${clause} ESCAPE '\\' ORDER BY seen_count DESC LIMIT ?`,
    )
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
  s: { id: string; problemId: string; body: string; createdBy: string; now: number },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO solutions (id, problem_id, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(s.id, s.problemId, s.body, s.createdBy, s.now)
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
      `SELECT r.*, a.reg_net_hash, a.status AS agent_status, a.created_at AS agent_created_at
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
