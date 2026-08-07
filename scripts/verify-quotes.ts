/**
 * Quote-grounding gate.
 *
 * verify-links proves a URL resolves. It cannot tell a real citation from a
 * fabricated one, because a hallucinated URL that happens to exist still returns
 * 200. This checks the stronger property: that the words a KO attributes to a
 * source actually appear on that page.
 *
 * The difficulty is normalisation, not matching. A naive substring search over raw
 * HTML false-negatives on four of the five hand-written seed quotes, so each page
 * is compared in three renderings:
 *
 *   1. tags -> " "  correct for prose, where <p>/<li>/inline <code> break sentences
 *   2. tags -> ""   correct for highlighted code, where the highlighter wraps the
 *                   colon in its own span and rendering 1 yields "exitCode : 137"
 *   3. whitespace stripped  last resort for wrapped or re-indented code
 *
 * Plus entity unescaping, NFKC, and smart-quote/dash/NBSP folding applied to both
 * sides, and ellipsis-aware ordered segment matching so an author may elide with
 * "...". Exits non-zero if any quote is ungrounded.
 */
import { loadAllTolerant } from "../lib/ko/fs-loader";
import { anchorPresent, fetchPage, groundQuote } from "../lib/ko/text";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

const CONCURRENCY = 4;

type Row = {
  slug: string;
  url: string;
  status: "grounded" | "ungrounded" | "no-quote" | "fetch-error";
  how?: string;
  detail?: string;
  anchorMissing?: boolean;
};

async function main() {
  const { ok, failed } = loadAllTolerant();

  if (failed.length > 0) {
    console.error(`${RED}${failed.length} file(s) could not be parsed:${RESET}`);
    for (const f of failed) console.error(`  ${f.file}: ${f.error.split("\n")[0]}`);
    console.error("");
  }

  const jobs: { slug: string; url: string; quote?: string }[] = ok.flatMap((ko) =>
    ko.evidence.map((e) => ({ slug: ko.slug, url: e.url, quote: e.quote })),
  );

  console.log(
    `grounding ${jobs.length} evidence item(s) across ${ok.length} knowledge object(s)\n`,
  );

  const pages = new Map<string, Promise<string>>();
  const rows: Row[] = [];
  const queue = [...jobs];

  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (!job.quote) {
        rows.push({ slug: job.slug, url: job.url, status: "no-quote" });
        continue;
      }

      let html: string;
      try {
        if (!pages.has(job.url)) pages.set(job.url, fetchPage(job.url));
        html = await pages.get(job.url)!;
      } catch (error) {
        rows.push({
          slug: job.slug,
          url: job.url,
          status: "fetch-error",
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const how = groundQuote(html, job.quote);
      rows.push({
        slug: job.slug,
        url: job.url,
        status: how ? "grounded" : "ungrounded",
        how: how ?? undefined,
        detail: how ? undefined : job.quote,
        anchorMissing: anchorPresent(html, job.url) === false,
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  rows.sort((a, b) => a.slug.localeCompare(b.slug) || a.url.localeCompare(b.url));

  for (const row of rows) {
    if (row.status === "grounded") {
      const anchor = row.anchorMissing ? ` ${YELLOW}(anchor missing)${RESET}` : "";
      console.log(`${GREEN}✓${RESET} ${row.slug.padEnd(42)} ${DIM}${row.how}${RESET}${anchor}`);
    } else if (row.status === "no-quote") {
      console.log(`${YELLOW}⚠${RESET} ${row.slug.padEnd(42)} ${DIM}no quote — ungroundable${RESET}`);
      console.log(`  ${DIM}${row.url}${RESET}`);
    } else if (row.status === "fetch-error") {
      console.log(`${RED}✖${RESET} ${row.slug.padEnd(42)} fetch failed: ${row.detail}`);
      console.log(`  ${DIM}${row.url}${RESET}`);
    } else {
      console.log(`${RED}✖${RESET} ${row.slug.padEnd(42)} quote NOT found in source`);
      console.log(`  ${DIM}${row.url}${RESET}`);
      console.log(`  ${RED}"${row.detail}"${RESET}`);
    }
  }

  const grounded = rows.filter((r) => r.status === "grounded").length;
  const missing = rows.filter((r) => r.status === "no-quote").length;
  const bad = rows.filter((r) => r.status === "ungrounded" || r.status === "fetch-error").length;
  const anchors = rows.filter((r) => r.anchorMissing).length;

  console.log(
    `\n${grounded} grounded · ${missing} without a quote · ${bad} failed` +
      (anchors > 0 ? ` · ${anchors} with a missing anchor` : ""),
  );

  if (bad > 0 || failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
