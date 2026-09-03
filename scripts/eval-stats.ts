/**
 * The outcome numbers must add up, and must never claim time nobody clocked.
 */
import { CAP_MS, FLOOR_MS, type RecallFact, type ReportFact, summarise } from "../lib/xp/stats";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "✔" : `${RED}✖${RESET}`} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

const min = (n: number) => n * 60_000;
const hit = (over: Partial<RecallFact> = {}): RecallFact => ({
  verdict: "exact",
  kind: "failure",
  answered: true,
  problemId: "p1",
  title: "ECONNREFUSED 5432",
  solvedMs: min(30),
  ...over,
});
const none: ReportFact[] = [];

// 1. one clocked problem, hit three times → 3 caught, 90 minutes, all measured
{
  const o = summarise(30, [hit(), hit(), hit()], none, [min(30)]);
  check("three hits on a 30-minute problem are 3 caught and 90 minutes", o.repeatFailuresCaught === 3 && o.engineerMinutes.saved === 90 && o.engineerMinutes.measured === 3, JSON.stringify(o.engineerMinutes));
}
// 2. unclocked problem borrows the median of clocked ones, and says so
{
  const o = summarise(30, [hit({ problemId: "p2", solvedMs: null })], none, [min(10), min(50), min(20)]);
  check("an unclocked problem borrows the median (20 min) and is counted as borrowed", o.engineerMinutes.saved === 20 && o.engineerMinutes.borrowed === 1 && o.engineerMinutes.measured === 0 && o.engineerMinutes.medianMinutes === 20);
}
// 3. nothing clocked anywhere → no minutes claimed, hit is unvalued
{
  const o = summarise(30, [hit({ solvedMs: null })], none, []);
  check("with nothing clocked, no minutes are claimed", o.engineerMinutes.saved === 0 && o.engineerMinutes.unvalued === 1 && o.engineerMinutes.medianMinutes === null && o.repeatFailuresCaught === 1);
}
// 4. clamp: a clock left running for a week is worth the cap; a 5-second retry is worth the floor
{
  const o = summarise(30, [hit({ solvedMs: 7 * 86_400_000 }), hit({ problemId: "p3", solvedMs: 5_000 })], none, [min(30)]);
  check("a week-long clock counts as the 4-hour cap and a 5-second one as the 1-minute floor", o.engineerMinutes.saved === (CAP_MS + FLOOR_MS) / 60_000);
}
// 5. hits without a working fix are not caught failures; questions are counted apart
{
  const o = summarise(30, [hit({ answered: false }), hit({ kind: "question" })], none, [min(30)]);
  check("a hit on dead ends and an answered question are not repeat failures caught", o.repeatFailuresCaught === 0 && o.hitsWithoutFix === 1 && o.questionsAnswered === 1 && o.engineerMinutes.saved === 0);
}
// 6. misses are misses
{
  const o = summarise(30, [hit({ verdict: "none" }), hit({ verdict: "similar" })], none, []);
  check("none and similar are misses", o.misses === 2 && o.repeatFailuresCaught === 0);
}
// 7. only prompted + worked reports are fixes confirmed from memory
{
  const reports: ReportFact[] = [
    { worked: true, prompted: true },
    { worked: true, prompted: false },
    { worked: false, prompted: true },
  ];
  const o = summarise(30, [], reports, []);
  check("a confirmed fix from memory is a report that was prompted and worked", o.fixesConfirmedFromMemory === 1 && o.deadEndsRecorded === 1 && o.reports === 3);
}
// 8. the table ranks by hits and carries the problem's minutes
{
  const o = summarise(30, [hit({ problemId: "a", title: "A" }), hit({ problemId: "b", title: "B" }), hit({ problemId: "b", title: "B" })], none, [min(30)]);
  check("the top list is ranked by hits and sums each problem's minutes", o.top[0]?.problemId === "b" && o.top[0].hits === 2 && o.top[0].minutes === 60 && o.top[1]?.minutes === 30);
}
// 9. the method is stated with the numbers
{
  const o = summarise(30, [], none, []);
  check("the method travels with the numbers", o.method.includes("clocked") && o.method.includes("no time is claimed"));
}

if (failed) {
  console.error(`\n${RED}outcomes: ${failed} check(s) failed${RESET}`);
  process.exit(1);
}
console.log(`\n${GREEN}outcomes: the numbers add up and no unclocked time is claimed${RESET}`);
