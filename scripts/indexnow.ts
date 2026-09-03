/**
 * Submits URLs to IndexNow.
 *
 *   npm run indexnow            every canonical URL on the site
 *   npm run indexnow -- <slug>  one entry, plus its machine-readable renditions
 *
 * Run it after publishing or re-verifying an entry. The pipeline will call
 * submitToIndexNow() directly for the same reason.
 */
import { INDEXNOW_KEY, submitToIndexNow } from "../lib/indexnow";
import { loadFromDisk } from "../lib/ko/fs-loader";
import { absoluteUrl, site } from "../lib/site";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";

/**
 * The recorded failures, read out of the live sitemap rather than out of D1.
 *
 * This script runs from a laptop or from CI, where there is no Workers binding — but
 * the sitemap already lists exactly these pages and is one fetch away. Submitting a URL
 * the sitemap does not claim would be the wrong thing to submit anyway.
 */
async function recordedFailures(): Promise<string[]> {
  try {
    const res = await fetch(absoluteUrl("/sitemap.xml"));
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<loc>([^<]*\/p\/[^<]*)<\/loc>/g)]
      .flatMap((m) => [m[1], `${m[1]}.md`])
      .slice(0, 2_000);
  } catch {
    return [];
  }
}

async function main() {
  if (process.env.PRIVATE === "1") {
    console.log("private deployment: nothing is submitted to search engines");
    return;
  }
  const slug = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const objects = loadFromDisk();

  let urls: string[];

  if (slug) {
    const ko = objects.find((k) => k.slug === slug);
    if (!ko) {
      console.error(`${RED}no knowledge object with slug "${slug}"${RESET}`);
      process.exit(1);
    }
    urls = [
      absoluteUrl(`/k/${ko.slug}`),
      absoluteUrl(`/k/${ko.slug}.json`),
      absoluteUrl(`/k/${ko.slug}.md`),
      absoluteUrl(`/k/${ko.slug}.txt`),
      absoluteUrl(`/d/${ko.domain}`),
      site.url,
      absoluteUrl("/llms.txt"),
    ];
  } else {
    const domains = [...new Set(objects.map((ko) => ko.domain))];
    urls = [
      site.url,
      absoluteUrl("/about"),
      absoluteUrl("/experience"),
      absoluteUrl("/agents"),
      absoluteUrl("/rules"),
      absoluteUrl("/llms.txt"),
      absoluteUrl("/llms-full.txt"),
      ...(await recordedFailures()),
      ...domains.map((d) => absoluteUrl(`/d/${d}`)),
      ...objects.flatMap((ko) => [
        absoluteUrl(`/k/${ko.slug}`),
        absoluteUrl(`/k/${ko.slug}.json`),
        absoluteUrl(`/k/${ko.slug}.md`),
        absoluteUrl(`/k/${ko.slug}.txt`),
      ]),
    ];
  }

  // A rejected key is the usual failure, and it is silent from the API's side, so
  // confirm the key file is actually being served before claiming success.
  const keyUrl = `${site.url}/${INDEXNOW_KEY}.txt`;
  const keyRes = await fetch(keyUrl).catch(() => null);
  const keyBody = keyRes && keyRes.ok ? (await keyRes.text()).trim() : null;

  if (keyBody !== INDEXNOW_KEY) {
    console.error(`${RED}✖ key file not serving correctly at ${keyUrl}${RESET}`);
    console.error(`  expected ${INDEXNOW_KEY}, got ${keyBody ?? `HTTP ${keyRes?.status ?? "error"}`}`);
    console.error("  deploy first — IndexNow will reject the submission with 403.");
    process.exit(1);
  }
  console.log(`${GREEN}✓${RESET} key file verified at ${DIM}${keyUrl}${RESET}`);

  const result = await submitToIndexNow(urls);
  const mark = result.ok ? `${GREEN}✓${RESET}` : `${RED}✖${RESET}`;
  console.log(`${mark} ${result.submitted} URL(s) → HTTP ${result.status}: ${result.message}`);

  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
