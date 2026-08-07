/**
 * Checks that every cited source is still reachable.
 *
 * This does not verify that a source still *says* what a KO claims — only a human or
 * the research pipeline can do that. It catches the cheaper failure: evidence that has
 * rotted away, which silently turns a verified claim back into an assertion.
 *
 * Kept out of `npm run build` on purpose: the network is not a build dependency. Run it
 * on a schedule and in CI.
 */
import { loadFromDisk } from "../lib/ko/fs-loader";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
// The `Mozilla/5.0 (compatible; ...)` shape is the conventional identifiable-bot form.
// A bare product token gets silently stalled by several of the hosts we cite.
const UA = "Mozilla/5.0 (compatible; knowbase-link-checker/0.1; +https://knowbase.sh)";

type Check = {
  url: string;
  citedBy: string[];
  status: number | null;
  note: string;
  verdict: "ok" | "warn" | "dead";
};

async function request(url: string, method: "HEAD" | "GET"): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*",
        ...(method === "GET" ? { range: "bytes=0-2047" } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probe(url: string): Promise<{ status: number | null; note: string }> {
  // HEAD is cheap but unevenly supported — GitHub stalls it, some hosts 405 it.
  // A GET is the authoritative answer either way, so fall through on any HEAD failure.
  try {
    const res = await request(url, "HEAD");
    if (res.status < 400) {
      return { status: res.status, note: res.url !== url ? `→ ${res.url}` : "" };
    }
  } catch {
    // fall through to GET
  }

  try {
    const res = await request(url, "GET");
    return { status: res.status, note: res.url !== url ? `→ ${res.url}` : "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: null, note: /abort/i.test(message) ? "timeout" : message };
  }
}

function verdictFor(status: number | null): Check["verdict"] {
  if (status === null) return "dead";
  if (status >= 200 && status < 400) return "ok";
  // Bot protection is not the same as a dead link, so it is surfaced without failing.
  if (status === 403 || status === 429) return "warn";
  return "dead";
}

async function main() {
  const objects = loadFromDisk();

  const byUrl = new Map<string, string[]>();
  for (const ko of objects) {
    for (const e of ko.evidence) {
      byUrl.set(e.url, [...(byUrl.get(e.url) ?? []), ko.slug]);
    }
  }

  const urls = [...byUrl.keys()];
  console.log(`checking ${urls.length} cited sources across ${objects.length} knowledge objects\n`);

  const results: Check[] = [];
  const queue = [...urls];

  async function worker() {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const { status, note } = await probe(url);
      const verdict = verdictFor(status);
      const check: Check = { url, citedBy: byUrl.get(url) ?? [], status, note, verdict };
      results.push(check);

      const colour = verdict === "ok" ? GREEN : verdict === "warn" ? YELLOW : RED;
      const mark = verdict === "ok" ? "✓" : verdict === "warn" ? "⚠" : "✖";
      console.log(
        `${colour}${mark} ${String(status ?? "ERR").padEnd(4)}${RESET} ${url} ${DIM}${note}${RESET}`,
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));

  const dead = results.filter((r) => r.verdict === "dead");
  const warn = results.filter((r) => r.verdict === "warn");

  console.log(
    `\n${results.length - dead.length - warn.length} reachable · ${warn.length} blocked · ${dead.length} dead`,
  );

  if (dead.length > 0) {
    console.error(`\n${RED}dead evidence — these KOs now cite something unreachable:${RESET}`);
    for (const d of dead) {
      console.error(`  ${d.url}\n    cited by: ${d.citedBy.join(", ")}\n    ${d.note}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
