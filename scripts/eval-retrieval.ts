/**
 * Golden-query regression gate for retrieval.
 *
 * Coverage is allowed to grow; an incorrect `strong` is not. These cases pin the
 * difference between a covered error, a related lead and an honest abstention so a
 * corpus or scoring change cannot silently turn a technology-name overlap into an
 * answer.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { loadFromDisk } from "../lib/ko/fs-loader";
import { matchKnowledgeObjects, type MatchVerdict } from "../lib/ko/match";

type RetrievalCase = {
  name: string;
  query: string;
  expectedVerdict: MatchVerdict;
  expectedTop?: string;
  forbiddenTop?: string[];
};

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";

function main() {
  const corpus = loadFromDisk();
  const file = path.join(process.cwd(), "evals", "retrieval.json");
  const cases = JSON.parse(readFileSync(file, "utf8")) as RetrievalCase[];
  let failed = 0;

  for (const test of cases) {
    const report = matchKnowledgeObjects(corpus, test.query);
    const top = report.results[0];
    const problems: string[] = [];

    if (report.verdict !== test.expectedVerdict) {
      problems.push(`expected ${test.expectedVerdict}, got ${report.verdict}`);
    }
    if (test.expectedTop && top?.ko.slug !== test.expectedTop) {
      problems.push(`expected top ${test.expectedTop}, got ${top?.ko.slug ?? "<none>"}`);
    }
    if (report.verdict !== "none" && top && test.forbiddenTop?.includes(top.ko.slug)) {
      problems.push(`forbidden top result: ${top.ko.slug}`);
    }

    if (problems.length === 0) {
      console.log(
        `${GREEN}✓${RESET} ${test.name.padEnd(48)} ${DIM}${report.verdict.padEnd(7)} ${(top?.score ?? 0).toFixed(3)} ${top?.ko.slug ?? "<none>"}${RESET}`,
      );
      continue;
    }

    failed++;
    console.error(`${RED}✖ ${test.name}${RESET}`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      `  top=${top?.ko.slug ?? "<none>"} score=${top?.score.toFixed(3) ?? "0"} matched=[${top?.matchedTerms.join(", ") ?? ""}] unmatched=[${report.unmatchedTerms.join(", ")}]`,
    );
  }

  let invariantChecks = 0;
  for (const ko of corpus) {
    // A signature plus its declared technology is the canonical positive query. The
    // context term is intentional: bare 429/502/413-style signatures are generic.
    const technology = ko.appliesTo.technology[0].name;
    const positiveQuery = `${technology} ${ko.error.signature}`;
    const positive = matchKnowledgeObjects(corpus, positiveQuery);
    invariantChecks++;
    if (positive.verdict !== "strong" || positive.results[0]?.ko.slug !== ko.slug) {
      failed++;
      console.error(`${RED}✖ contextual signature invariant: ${ko.slug}${RESET}`);
      console.error(
        `  query=${JSON.stringify(positiveQuery)} verdict=${positive.verdict} top=${positive.results[0]?.ko.slug ?? "<none>"}`,
      );
    }

    // Negative scope may be returned as a partial explanatory lead, but never as
    // the accepted answer for the very failure it excludes.
    for (const exclusion of ko.notApplicableTo) {
      const negative = matchKnowledgeObjects(corpus, exclusion);
      invariantChecks++;
      if (negative.verdict === "strong" && negative.results[0]?.ko.slug === ko.slug) {
        failed++;
        console.error(`${RED}✖ negative-scope invariant: ${ko.slug}${RESET}`);
        console.error(`  exclusion=${JSON.stringify(exclusion)}`);
      }
    }
  }

  console.log(
    `\n${cases.length} retrieval cases + ${invariantChecks} corpus invariants · ${failed} failed`,
  );
  if (failed > 0) process.exit(1);
  console.log(`${GREEN}retrieval eval passed${RESET}`);
}

main();
