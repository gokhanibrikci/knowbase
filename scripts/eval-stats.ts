/**
 * The outcome numbers must add up, must never claim time nobody clocked, and must never
 * count one person's single failure twice.
 */
import { CAP_MS, type CaughtProblem, type Totals, credible, summarise } from "../lib/xp/stats";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "✔" : `${RED}✖${RESET}`} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

const min = (n: number) => n * 60_000;
const NONE: Totals = {
  recalls: 0,
  misses: 0,
  questionsAnswered: 0,
  hitsWithoutFix: 0,
  reports: 0,
  deadEndsRecorded: 0,
  fixesConfirmedFromMemory: 0,
};
const problem = (over: Partial<CaughtProblem> = {}): CaughtProblem => ({
  problemId: "p1",
  title: "ECONNREFUSED 5432",
  occasions: 1,
  solvedMs: min(30),
  ...over,
});

// 1. three occasions on a 30-minute problem: 3 caught, 90 minutes, all measured
{
  const o = summarise(30, NONE, [problem({ occasions: 3 })], [min(30)]);
  check(
    "three occasions on a 30-minute problem are 3 caught and 90 minutes",
    o.repeatFailuresCaught === 3 && o.engineerMinutes.saved === 90 && o.engineerMinutes.measured === 3,
    JSON.stringify(o.engineerMinutes),
  );
}
// 2. an unclocked problem borrows the median of the clocked ones and says so
{
  const o = summarise(30, NONE, [problem({ problemId: "p2", solvedMs: null })], [min(10), min(50), min(20)]);
  check(
    "an unclocked problem borrows the median (20 min) and is counted as borrowed",
    o.engineerMinutes.saved === 20 &&
      o.engineerMinutes.borrowed === 1 &&
      o.engineerMinutes.measured === 0 &&
      o.engineerMinutes.medianMinutes === 20,
    JSON.stringify(o.engineerMinutes),
  );
}
// 3. nothing clocked anywhere: no minutes are claimed at all
{
  const o = summarise(30, NONE, [problem({ solvedMs: null })], []);
  check(
    "with nothing clocked, no minutes are claimed",
    o.engineerMinutes.saved === 0 &&
      o.engineerMinutes.unvalued === 1 &&
      o.engineerMinutes.medianMinutes === null &&
      o.repeatFailuresCaught === 1,
  );
}
// 4. a clock left running for a week is not a measurement of a solve
{
  const week = 7 * 86_400_000;
  check("an interval past the cap is not credible", credible(week) === null && credible(min(30)) === min(30));
  const o = summarise(30, NONE, [problem({ solvedMs: week }), problem({ problemId: "p3", solvedMs: min(20) })], [week, min(20)]);
  check(
    "a week-long clock is valued at the median, counted as capped, and kept out of the median",
    o.engineerMinutes.medianMinutes === 20 &&
      o.engineerMinutes.capped === 1 &&
      o.engineerMinutes.measured === 1 &&
      o.engineerMinutes.saved === 40,
    JSON.stringify(o.engineerMinutes),
  );
  check(
    "the cap is never used as a value in its own right",
    !JSON.stringify(o.engineerMinutes).includes(String(CAP_MS / 60_000)) || o.engineerMinutes.capMinutes === 240,
  );
}
// 5. a five-second clock is a retry, and counts as the floor
{
  const o = summarise(30, NONE, [problem({ solvedMs: 5_000 })], [5_000]);
  check("a five-second clock counts as the one-minute floor", o.engineerMinutes.saved === 1 && o.engineerMinutes.measured === 1);
}
// 6. the totals are carried through untouched
{
  const totals: Totals = {
    recalls: 40,
    misses: 12,
    questionsAnswered: 5,
    hitsWithoutFix: 3,
    reports: 9,
    deadEndsRecorded: 4,
    fixesConfirmedFromMemory: 2,
  };
  const o = summarise(30, totals, [], []);
  check(
    "misses, questions, hits without a fix and report counts are reported as counted",
    o.misses === 12 && o.questionsAnswered === 5 && o.hitsWithoutFix === 3 && o.deadEndsRecorded === 4 && o.fixesConfirmedFromMemory === 2 && o.repeatFailuresCaught === 0,
  );
}
// 7. the table ranks by occasions and carries each problem's total minutes
{
  const o = summarise(
    30,
    NONE,
    [problem({ problemId: "a", title: "A", occasions: 1 }), problem({ problemId: "b", title: "B", occasions: 2 })],
    [min(30)],
  );
  check(
    "the top list is ranked by occasions and sums each problem's minutes",
    o.top[0]?.problemId === "b" && o.top[0].hits === 2 && o.top[0].minutes === 60 && o.top[1]?.minutes === 30,
  );
}
// 8. the method travels with the numbers, and says what it throws away
{
  const o = summarise(30, NONE, [], []);
  check(
    "the method states the occasion rule, the cap and the refusal to claim",
    o.method.includes("within an hour") && o.method.includes("clock left running") && o.method.includes("no time is claimed"),
  );
}

if (failed) {
  console.error(`\n${RED}outcomes: ${failed} check(s) failed${RESET}`);
  process.exit(1);
}
console.log(`\n${GREEN}outcomes: occasions are people, not calls, and no unclocked time is claimed${RESET}`);
