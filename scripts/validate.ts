/**
 * Build gate for the knowledge base.
 *
 * A KO that fails schema or editorial rules must never reach the site, because the
 * whole proposition is that anything published here is checkable. Run via
 * `npm run validate`; `npm run build` depends on it.
 */
import { loadFromDisk } from "../lib/ko/fs-loader";
import { freshnessOf } from "../lib/ko/freshness";
import { checkDepthRules, checkEditorialRules } from "../lib/ko/schema";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function main() {
  let objects;
  try {
    objects = loadFromDisk();
  } catch (error) {
    console.error(`${RED}✖ content failed to load${RESET}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const warnings: string[] = [];
  let failed = 0;

  for (const ko of objects) {
    const violations = [...checkEditorialRules(ko), ...checkDepthRules(ko)];
    const freshness = freshnessOf(ko);

    if (violations.length > 0) {
      failed++;
      console.error(`${RED}✖ ${ko.slug}${RESET}`);
      for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
      continue;
    }

    if (freshness.status !== "fresh") {
      warnings.push(
        `${ko.slug} is ${freshness.status} — verified ${freshness.ageDays}d ago, review interval ${ko.freshness.reviewIntervalDays}d`,
      );
    }

    const primary = ko.evidence.filter((e) =>
      ["official-docs", "specification", "source-code"].includes(e.type),
    ).length;

    console.log(
      `${GREEN}✓${RESET} ${ko.slug.padEnd(44)} ${DIM}${ko.confidence.padEnd(6)} ${ko.evidence.length} sources (${primary} primary)  ${freshness.status}${RESET}`,
    );
  }

  if (warnings.length > 0) {
    console.log(`\n${YELLOW}⚠ freshness warnings${RESET}`);
    for (const w of warnings) console.log(`  ${w}`);
  }

  const byDomain = objects.reduce<Record<string, number>>((acc, ko) => {
    acc[ko.domain] = (acc[ko.domain] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `\n${objects.length} knowledge objects · ${Object.entries(byDomain)
      .map(([d, n]) => `${d}:${n}`)
      .join(" ")}`,
  );

  if (failed > 0) {
    console.error(`\n${RED}${failed} knowledge object(s) failed validation${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}all knowledge objects valid${RESET}`);
}

main();
