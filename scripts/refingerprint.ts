/**
 * Recompute every fingerprint after the rule that produces them changes.
 *
 *   npm run refingerprint              dry run: what would move, what would merge
 *   npm run refingerprint -- --apply   write it
 *
 * The rule in lib/xp/fingerprint.ts is versioned for exactly this moment. Each problem
 * and each ask keeps the version that keyed it and the (redacted) sample it was keyed
 * from, so a later rule can recompute the key instead of leaving the store with a seam
 * that no future recall can cross: everything filed under the old rule would otherwise
 * be invisible to agents pasting the same error tomorrow.
 *
 * Merging is the delicate part. Two rows whose new keys coincide were one failure that
 * the old rule split; the older row survives, the other's solutions move to it, and
 * their ask counts add. Nothing is deleted that is not first moved. Rows whose sample no
 * longer yields a usable key — a truncated traceback whose error line fell outside the
 * stored sample — are reported and left alone.
 */
import { FINGERPRINT_VERSION, fingerprint, insufficientSignal } from "../lib/xp/fingerprint";
import { CYAN, DIM, GREEN, RESET, YELLOW, d1Query, readToken, resolveZone } from "./lib/cloudflare";

type ProblemRow = {
  id: string;
  fingerprint: string;
  sample: string;
  created_at: number;
  seen_count: number;
  fp_version: number;
};

type AskRow = {
  fingerprint: string;
  sample: string;
  ask_count: number;
  first_asked_at: number;
  fp_version: number;
};

type AliasRow = { fingerprint: string; problem_id: string; sample: string; fp_version: number };

async function main() {
  const apply = process.argv.includes("--apply");
  const token = readToken();
  const { accountId } = await resolveZone(token);
  const q = <T>(sql: string, params: unknown[] = []) => d1Query<T>(accountId, token, sql, params);

  const problems = await q<ProblemRow>(
    "SELECT id, fingerprint, sample, created_at, seen_count, fp_version FROM problems ORDER BY created_at",
  );
  const asks = await q<AskRow>(
    "SELECT fingerprint, sample, ask_count, first_asked_at, fp_version FROM asks ORDER BY first_asked_at",
  );
  const aliases = await q<AliasRow>(
    "SELECT fingerprint, problem_id, sample, fp_version FROM problem_aliases ORDER BY created_at",
  );

  console.log(
    `${CYAN}refingerprint${RESET} → v${FINGERPRINT_VERSION} · ${problems.length} problem(s), ${asks.length} ask(s) · ${apply ? "APPLY" : "dry run"}\n`,
  );

  // Where every problem ends up under the new rule, oldest first so the survivor of a
  // merge is always the row that has been there longest.
  const byNewKey = new Map<string, ProblemRow>();
  const statements: { sql: string; params: unknown[]; note: string }[] = [];
  let unchanged = 0;

  for (const p of problems) {
    const why = insufficientSignal(p.sample);
    if (why) {
      console.log(`${YELLOW}skip${RESET} problem ${p.id}: sample no longer keys — ${why}`);
      continue;
    }
    const next = await fingerprint(p.sample);
    const survivor = byNewKey.get(next);
    if (survivor && survivor.id !== p.id) {
      console.log(`${YELLOW}merge${RESET} problem ${p.id} → ${survivor.id} (both key to ${next})`);
      statements.push(
        { sql: "UPDATE solutions SET problem_id = ? WHERE problem_id = ?", params: [survivor.id, p.id], note: "move solutions" },
        { sql: "UPDATE problems SET seen_count = seen_count + ? WHERE id = ?", params: [p.seen_count, survivor.id], note: "sum asks" },
        { sql: "DELETE FROM problems WHERE id = ?", params: [p.id], note: "retire duplicate" },
      );
      continue;
    }
    byNewKey.set(next, p);
    if (next === p.fingerprint && p.fp_version === FINGERPRINT_VERSION) {
      unchanged++;
      continue;
    }
    console.log(`${GREEN}rekey${RESET} problem ${p.id}: ${p.fingerprint} → ${next}`);
    statements.push({
      sql: "UPDATE problems SET fingerprint = ?, fp_version = ? WHERE id = ?",
      params: [next, FINGERPRINT_VERSION, p.id],
      note: "rekey problem",
    });
  }

  // Aliases: rekeyed from their sample; one that now keys straight to a problem is
  // redundant and goes, and one with no sample cannot be rekeyed and is left alone.
  for (const al of aliases) {
    if (!al.sample) {
      console.log(`${YELLOW}skip${RESET} alias ${al.fingerprint}: no sample to rekey from`);
      continue;
    }
    const next = await fingerprint(al.sample);
    if (byNewKey.has(next)) {
      console.log(`${YELLOW}drop${RESET} alias ${al.fingerprint}: its text now keys straight to a problem`);
      statements.push({ sql: "DELETE FROM problem_aliases WHERE fingerprint = ?", params: [al.fingerprint], note: "drop redundant alias" });
      continue;
    }
    if (next === al.fingerprint && al.fp_version === FINGERPRINT_VERSION) {
      unchanged++;
      continue;
    }
    console.log(`${GREEN}rekey${RESET} alias ${al.fingerprint} → ${next}`);
    statements.push({
      sql: "UPDATE OR IGNORE problem_aliases SET fingerprint = ?, fp_version = ? WHERE fingerprint = ?",
      params: [next, FINGERPRINT_VERSION, al.fingerprint],
      note: "rekey alias",
    });
  }

  // Asks: same idea, and an ask whose new key now lands on a problem folds into it.
  const askByNewKey = new Map<string, AskRow>();
  for (const a of asks) {
    const why = insufficientSignal(a.sample);
    if (why) {
      console.log(`${YELLOW}skip${RESET} ask ${a.fingerprint}: sample no longer keys — ${why}`);
      continue;
    }
    const next = await fingerprint(a.sample);
    const problem = byNewKey.get(next);
    if (problem) {
      console.log(`${YELLOW}fold${RESET} ask ${a.fingerprint} → problem ${problem.id} (${a.ask_count} ask(s))`);
      statements.push(
        { sql: "UPDATE problems SET seen_count = seen_count + ? WHERE id = ?", params: [a.ask_count, problem.id], note: "fold asks" },
        { sql: "DELETE FROM asks WHERE fingerprint = ?", params: [a.fingerprint], note: "retire ask" },
      );
      continue;
    }
    const other = askByNewKey.get(next);
    if (other && other.fingerprint !== a.fingerprint) {
      console.log(`${YELLOW}merge${RESET} ask ${a.fingerprint} → ${other.fingerprint}`);
      statements.push(
        { sql: "UPDATE asks SET ask_count = ask_count + ? WHERE fingerprint = ?", params: [a.ask_count, other.fingerprint], note: "sum asks" },
        { sql: "DELETE FROM asks WHERE fingerprint = ?", params: [a.fingerprint], note: "retire duplicate ask" },
      );
      continue;
    }
    askByNewKey.set(next, a);
    if (next === a.fingerprint && a.fp_version === FINGERPRINT_VERSION) {
      unchanged++;
      continue;
    }
    console.log(`${GREEN}rekey${RESET} ask ${a.fingerprint} → ${next}`);
    statements.push({
      sql: "UPDATE asks SET fingerprint = ?, fp_version = ? WHERE fingerprint = ?",
      params: [next, FINGERPRINT_VERSION, a.fingerprint],
      note: "rekey ask",
    });
  }

  console.log(`\n${DIM}${unchanged} row(s) already current · ${statements.length} statement(s) ${apply ? "to run" : "would run"}${RESET}`);
  if (!apply || statements.length === 0) {
    if (!apply && statements.length > 0) console.log(`${DIM}Re-run with --apply to write.${RESET}`);
    return;
  }
  // Rekeys before merges would collide on the UNIQUE fingerprint; the order above already
  // emits a merge's moves before its delete and never rekeys onto an occupied key, so the
  // statements run as listed.
  for (const s of statements) {
    await q(s.sql, s.params);
    console.log(`${GREEN}done${RESET} ${s.note}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
