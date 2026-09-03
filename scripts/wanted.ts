/**
 * The queue: what agents asked that nobody has answered.
 *
 *   npm run wanted             unanswered asks, and problems with no working fix
 *   npm run wanted -- --all    also the answered problems, by how often they are asked
 *
 * `npm run misses` reads the library's lookup log; this reads the store. Until the `asks`
 * table existed the store's queue could only hold failures somebody had already reported,
 * which is to say it held supply and called it demand. These rows are the asks that
 * arrived before any answer did — the strongest case a failure can make for being worked
 * on, and the one thing nobody had to guess at.
 *
 * Reads D1 through the account API with the token wrangler already holds; nothing here
 * writes.
 */
import { CYAN, DIM, GREEN, RESET, YELLOW, d1Query, readToken, resolveZone } from "./lib/cloudflare";

type AskRow = {
  fingerprint: string;
  headline: string;
  ask_count: number;
  last_asked_at: number;
  environments: string;
  verdict: string;
};

type ProblemRow = { id: string; title: string; seen_count: number; last_seen_at: number | null };

function ago(ts: number | null): string {
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  return days === 0 ? "today" : `${days}d ago`;
}

async function main() {
  const all = process.argv.includes("--all");
  const token = readToken();
  const { accountId } = await resolveZone(token);

  const asks = await d1Query<AskRow>(
    accountId,
    token,
    `SELECT a.fingerprint, a.headline, a.ask_count, a.last_asked_at, a.environments, a.verdict
       FROM asks a LEFT JOIN problems p ON p.fingerprint = a.fingerprint
      WHERE p.id IS NULL
      ORDER BY a.ask_count DESC, a.last_asked_at DESC LIMIT 100`,
  );

  const unsolved = await d1Query<ProblemRow>(
    accountId,
    token,
    `SELECT p.id, p.title, p.seen_count, p.last_seen_at FROM problems p
      WHERE NOT EXISTS (SELECT 1 FROM solutions s JOIN reports r ON r.solution_id = s.id
                         WHERE s.problem_id = p.id AND r.worked = 1)
      ORDER BY p.seen_count DESC LIMIT 50`,
  );

  console.log(`${CYAN}asked, never answered${RESET} — ${asks.length} failure(s)\n`);
  if (asks.length === 0) {
    console.log(`${DIM}No unanswered asks. Either every recall found something, or nobody has asked yet.${RESET}`);
  }
  for (const a of asks) {
    console.log(`${YELLOW}${String(a.ask_count).padStart(4)}×${RESET} ${a.headline}`);
    const env = (() => {
      try {
        return (JSON.parse(a.environments) as string[]).join(", ");
      } catch {
        return "";
      }
    })();
    console.log(
      `${DIM}       ${a.fingerprint} · last ${ago(a.last_asked_at)} · told "${a.verdict}"${env ? ` · ${env}` : ""}${RESET}`,
    );
  }

  console.log(`\n${CYAN}reported, nothing works yet${RESET} — ${unsolved.length} failure(s)\n`);
  for (const p of unsolved) {
    console.log(`${YELLOW}${String(p.seen_count).padStart(4)}×${RESET} ${p.title}  ${DIM}/p/${p.id} · last ${ago(p.last_seen_at)}${RESET}`);
  }

  if (all) {
    const answered = await d1Query<ProblemRow>(
      accountId,
      token,
      `SELECT p.id, p.title, p.seen_count, p.last_seen_at FROM problems p
        WHERE EXISTS (SELECT 1 FROM solutions s JOIN reports r ON r.solution_id = s.id
                       WHERE s.problem_id = p.id AND r.worked = 1)
        ORDER BY p.seen_count DESC LIMIT 50`,
    );
    console.log(`\n${CYAN}answered${RESET} — ${answered.length} failure(s)\n`);
    for (const p of answered) {
      console.log(`${GREEN}${String(p.seen_count).padStart(4)}×${RESET} ${p.title}  ${DIM}/p/${p.id}${RESET}`);
    }
  }

  console.log(
    `\n${DIM}An unanswered ask with a count above one is the next failure to write an answer for: solve it, then knowbase_report it, and everyone who asked gets it.${RESET}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
