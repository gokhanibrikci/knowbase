/**
 * Who is actually reading this site, and in which format.
 *
 *   npm run crawlers              last 24 hours
 *   npm run crawlers -- --hours 6
 *
 * Server logs are the only honest measure of whether agents find us. The question
 * that matters most is not the request count but the *format split*: this site
 * publishes every entry four ways, and if crawlers only ever take the HTML then the
 * machine-readable surface is decoration. That number is printed below.
 *
 * Reads the Cloudflare OAuth token that `wrangler login` already stored, or
 * CLOUDFLARE_API_TOKEN if set. The token value is never printed.
 */
import {
  CYAN,
  DIM,
  GREEN,
  RESET,
  YELLOW,
  ZONE_NAME,
  cf,
  readToken,
  resolveZone,
} from "./lib/cloudflare";

/**
 * The distinction that actually matters.
 *
 * An index crawler saying "this page exists, noted" is not the goal — it is the
 * precondition. The goal is a model fetching a page *because a person asked it
 * something*, which these user-agents represent. Until this count is non-zero, the
 * site is discovered but not used.
 */
const USER_TRIGGERED = /ChatGPT-User|Claude-User|Perplexity-User|OAI-SearchBot|Claude-SearchBot|DuckAssistBot/i;

/** Bots that identify themselves. Anything pretending to be a browser is counted separately. */
const BOT_PATTERNS: [string, RegExp][] = [
  ["OpenAI", /GPTBot|OAI-SearchBot|ChatGPT-User/i],
  ["Anthropic", /ClaudeBot|Claude-User|Claude-SearchBot|anthropic/i],
  ["Perplexity", /PerplexityBot|Perplexity-User/i],
  ["Google", /Googlebot|Google-Extended|GoogleOther/i],
  ["Bing", /bingbot|BingPreview|msnbot/i],
  ["Apple", /Applebot/i],
  ["Meta", /meta-externalagent|facebookexternalhit/i],
  ["ByteDance", /Bytespider/i],
  ["Common Crawl", /CCBot/i],
  ["Amazon", /Amazonbot/i],
  ["Yandex", /YandexBot|YandexRenderResourcesBot/i],
  ["DuckDuckGo", /DuckDuckBot|DuckAssistBot/i],
  ["SEO tools", /SemrushBot|AhrefsBot|MJ12bot|DotBot/i],
];

type Row = { count: number; dimensions: { userAgent: string; clientRequestPath: string } };

/** Which rendition a path represents — the split this whole site is a bet on. */
function formatOf(p: string): "html" | "json" | "markdown" | "text" | "llms" | "meta" | "asset" {
  if (p.startsWith("/_next/") || p.startsWith("/cdn-cgi/") || p.endsWith(".svg")) return "asset";
  if (p === "/llms.txt" || p === "/llms-full.txt") return "llms";
  if (p === "/sitemap.xml" || p === "/robots.txt") return "meta";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".txt")) return "text";
  return "html";
}

function operatorOf(ua: string): string | null {
  for (const [name, re] of BOT_PATTERNS) if (re.test(ua)) return name;
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const hoursAt = args.indexOf("--hours");
  const hours = Math.min(24, Math.max(1, hoursAt >= 0 ? Number(args[hoursAt + 1]) : 24));

  const token = readToken();
  const { zoneId } = await resolveZone(token);

  // The adaptive dataset caps queries at 24h, which is also a sensible reporting window.
  const since = new Date(Date.now() - hours * 3600_000 + 60_000).toISOString();

  const query = `{ viewer { zones(filter:{zoneTag:"${zoneId}"}) {
    httpRequestsAdaptiveGroups(limit:5000, filter:{datetime_geq:"${since}"}, orderBy:[count_DESC]) {
      count dimensions { userAgent clientRequestPath }
    } } } }`;

  const res = await cf<{
    data?: { viewer: { zones: { httpRequestsAdaptiveGroups: Row[] }[] } };
    errors?: { message: string }[];
  }>("https://api.cloudflare.com/client/v4/graphql", token, {
    method: "POST",
    body: JSON.stringify({ query }),
  });

  if (res.errors?.length) throw new Error(res.errors[0].message);
  const rows = res.data?.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];

  const total = rows.reduce((n, r) => n + r.count, 0);
  console.log(`${CYAN}${ZONE_NAME}${RESET} — last ${hours}h · ${total} requests\n`);

  // Per operator: how many requests, and which renditions they took.
  const byOperator = new Map<string, { count: number; formats: Map<string, number>; paths: Map<string, number> }>();
  const userTriggered = new Map<string, number>();
  let browserLike = 0;
  let selfTest = 0;

  for (const row of rows) {
    const ua = row.dimensions.userAgent;
    const op = operatorOf(ua);

    if (!op) {
      if (/curl|wget|node-fetch|python-requests|knowbase-/i.test(ua)) selfTest += row.count;
      else browserLike += row.count;
      continue;
    }

    const triggered = ua.match(USER_TRIGGERED)?.[0];
    if (triggered) userTriggered.set(triggered, (userTriggered.get(triggered) ?? 0) + row.count);

    const entry = byOperator.get(op) ?? { count: 0, formats: new Map(), paths: new Map() };
    entry.count += row.count;
    const f = formatOf(row.dimensions.clientRequestPath);
    entry.formats.set(f, (entry.formats.get(f) ?? 0) + row.count);
    entry.paths.set(
      row.dimensions.clientRequestPath,
      (entry.paths.get(row.dimensions.clientRequestPath) ?? 0) + row.count,
    );
    byOperator.set(op, entry);
  }

  if (byOperator.size === 0) {
    console.log(`${YELLOW}No identified crawler has visited yet.${RESET}`);
    console.log(`${DIM}Discovery normally takes days. Check again tomorrow.${RESET}\n`);
  } else {
    console.log(`${GREEN}Identified crawlers${RESET}`);
    for (const [op, e] of [...byOperator.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const formats = [...e.formats.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${f}:${n}`)
        .join(" ");
      console.log(`  ${op.padEnd(14)} ${String(e.count).padStart(5)}  ${DIM}${formats}${RESET}`);

      const top = [...e.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      for (const [p, n] of top) console.log(`  ${DIM}${" ".repeat(14)} ${String(n).padStart(5)}  ${p}${RESET}`);
    }
    console.log();
  }

  // The headline number: of everything crawlers took, how much was machine-readable?
  const agg = new Map<string, number>();
  for (const e of byOperator.values()) {
    for (const [f, n] of e.formats) agg.set(f, (agg.get(f) ?? 0) + n);
  }
  const content = ["html", "json", "markdown", "text", "llms"].reduce(
    (n, f) => n + (agg.get(f) ?? 0),
    0,
  );
  const machine = ["json", "markdown", "text", "llms"].reduce((n, f) => n + (agg.get(f) ?? 0), 0);

  if (content > 0) {
    const pct = ((machine / content) * 100).toFixed(0);
    console.log(
      `${CYAN}Machine-readable share${RESET}: ${machine}/${content} content fetches (${pct}%)`,
    );
    console.log(
      `${DIM}html:${agg.get("html") ?? 0} json:${agg.get("json") ?? 0} md:${agg.get("markdown") ?? 0} txt:${agg.get("text") ?? 0} llms:${agg.get("llms") ?? 0}${RESET}`,
    );
  }

  // The headline the rest of the report exists to support.
  const triggeredTotal = [...userTriggered.values()].reduce((a, b) => a + b, 0);
  console.log();
  if (triggeredTotal === 0) {
    console.log(
      `${YELLOW}Agent fetches on behalf of a user: 0${RESET} ${DIM}— discovered, not yet used${RESET}`,
    );
    console.log(
      `${DIM}Index crawlers noting the site exist is the precondition. The goal is`,
    );
    console.log(`${DIM}ChatGPT-User / Claude-User / Perplexity-User appearing here.${RESET}`);
  } else {
    console.log(`${GREEN}Agent fetches on behalf of a user: ${triggeredTotal}${RESET}`);
    for (const [ua, n] of [...userTriggered.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ua.padEnd(20)} ${n}`);
    }
  }

  console.log(
    `\n${DIM}unidentified browser-like UA: ${browserLike} · own tooling: ${selfTest}${RESET}`,
  );
  console.log(
    `${DIM}Richer per-crawler breakdowns: Cloudflare dashboard → AI Crawl Control${RESET}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
