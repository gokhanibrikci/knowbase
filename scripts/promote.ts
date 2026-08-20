/**
 * Promotion gate: content/ko/.staging → content/ko.
 *
 * The pipeline writes drafts into .staging, where the site loader cannot see them.
 * This is the only sanctioned way out. Each draft is held against the full schema,
 * the editorial rules and the depth floors *individually*, so one bad draft cannot
 * block the good ones — and nothing reaches the corpus that the build would then
 * reject wholesale.
 *
 *   npm run promote            dry run: report which drafts would pass
 *   npm run promote -- --apply move the passing drafts into the corpus
 *
 * Quote grounding is deliberately NOT checked here — it needs the network and it is
 * the next command in the pipeline: run `npm run verify:quotes` after applying, and
 * demote anything it rejects before deploying.
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";

import { CONTENT_DIR, STAGING_DIR, loadAllTolerant, loadFromDisk, parseFile } from "../lib/ko/fs-loader";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function main() {
  const apply = process.argv.includes("--apply");

  if (!existsSync(STAGING_DIR)) {
    console.log("nothing staged — content/ko/.staging does not exist");
    return;
  }

  const staged = loadAllTolerant(STAGING_DIR);
  const published = loadFromDisk();
  const publishedSlugs = new Set(published.map((ko) => ko.slug));

  if (staged.ok.length === 0 && staged.failed.length === 0) {
    console.log("nothing staged");
    return;
  }

  let passed = 0;

  for (const failure of staged.failed) {
    console.log(`${RED}✖ ${failure.file}${RESET}`);
    console.log(`  ${failure.error.split("\n").slice(0, 6).join("\n  ")}`);
  }

  const promotable: string[] = [];

  for (const ko of staged.ok) {
    // Cross-corpus checks the per-file parse cannot see: a draft colliding with a
    // published slug, or pointing `related` at something that is not published.
    // Staged drafts may not reference each other — promotion order would then
    // decide validity, and order is not a property an entry should have.
    const problems: string[] = [];
    if (publishedSlugs.has(ko.slug)) problems.push(`slug already published: ${ko.slug}`);
    for (const rel of ko.related) {
      if (!publishedSlugs.has(rel)) problems.push(`related points at unpublished slug: ${rel}`);
    }

    if (problems.length > 0) {
      console.log(`${RED}✖ ${ko.slug}${RESET}`);
      for (const p of problems) console.log(`  ${p}`);
      continue;
    }

    passed++;
    promotable.push(ko.slug);
    console.log(
      `${GREEN}✓${RESET} ${ko.slug.padEnd(46)} ${DIM}${ko.confidence} · ${ko.evidence.length} sources · ${ko.rootCauses.length} causes · ${ko.solution.steps.length} steps${RESET}`,
    );
  }

  console.log(
    `\n${passed} promotable · ${staged.ok.length - passed + staged.failed.length} rejected`,
  );

  if (!apply) {
    if (passed > 0) console.log(`${DIM}dry run — pass --apply to move them into the corpus${RESET}`);
    return;
  }

  mkdirSync(CONTENT_DIR, { recursive: true });
  for (const slug of promotable) {
    // Re-parse at the moment of the move so a file edited between report and apply
    // cannot slip through on a stale verdict.
    const file = `${slug}.yaml`;
    parseFile(STAGING_DIR, file);
    renameSync(path.join(STAGING_DIR, file), path.join(CONTENT_DIR, file));
    console.log(`${GREEN}→${RESET} ${file} promoted`);
  }

  if (promotable.length > 0) {
    console.log(
      `\n${YELLOW}next:${RESET} npm run verify:quotes — and demote anything it rejects before deploying`,
    );
  }
}

main();
