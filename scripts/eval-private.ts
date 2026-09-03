/**
 * A private deployment publishes nothing — held to account offline.
 *
 * PRIVATE=1 is the one switch that turns knowbase into one organisation's own store. If any
 * publication surface survived the switch, a fintech's failures would be indexed by the
 * morning, so every surface is asserted here with the switch on, and the public shape is
 * asserted with it off, so neither can drift.
 */
export {};

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`${GREEN}✓${RESET} ${name}`);
  else {
    failed++;
    console.log(`${RED}✖ ${name}${RESET}${detail ? `\n  ${detail}` : ""}`);
  }
}

async function main() {
  process.env.PRIVATE = "1";
  process.env.KNOWBASE_ORG = "Acme Bank";
  process.env.NEXT_PUBLIC_SITE_URL = "https://kb.acme.internal";

  const { isPrivate, orgName } = await import("../lib/site");
  check("PRIVATE=1 is read", isPrivate() === true);
  check("the organisation name is read", orgName() === "Acme Bank");

  const robots = (await import("../app/robots")).default();
  const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
  check(
    "robots: everything disallowed, no sitemap",
    rules.length === 1 && rules[0].disallow === "/" && robots.sitemap === undefined,
    JSON.stringify(robots),
  );

  const sitemap = await (await import("../app/sitemap")).default();
  check("sitemap: empty", sitemap.length === 0, `${sitemap.length} entries`);

  // The site is not browsable until the operator says an identity proxy stands in front.
  const { siteVisible } = await import("../lib/site");
  const { allowRequest, isMachinePath } = await import("../lib/gate");
  check("the human site is closed until PRIVATE_SITE=1", siteVisible() === false);
  for (const page of ["/", "/p/abc123", "/activity", "/a/someone", "/experience", "/stats", "/search", "/library"]) {
    check(`page is 404 while the site is closed: ${page}`, allowRequest(page, true, false) === false);
  }
  for (const machine of ["/experience.json", "/mcp", "/stats.json", "/rule.md", "/connect.mjs", "/p/abc123/md"]) {
    check(`machine surface stays reachable: ${machine}`, isMachinePath(machine) && allowRequest(machine, true, false));
  }
  check("opening the site is deliberate", allowRequest("/p/abc123", true, true) === true);
  check("a public deployment is never gated", allowRequest("/p/abc123", false, false) === true);

  // The gate is only worth what the file that enforces it does, so the proxy itself is
  // exercised here: Next 16 calls the export named `proxy`, and a wrong name would fail
  // open with every page served.
  process.env.PRIVATE_SITE = "";
  const { proxy } = await import("../proxy");
  const { NextRequest } = await import("next/server");
  const through = (url: string) => proxy(new NextRequest(new Request(url)));
  const page = through("https://kb.acme.internal/p/abc123");
  check("proxy: a page is 404 on a private deployment", page.status === 404, `HTTP ${page.status}`);
  check(
    "proxy: and says nothing about what this deployment is",
    !(page.headers.get("content-type") ?? "").includes("html") && page.headers.get("cache-control") === "no-store",
  );
  const machine = through("https://kb.acme.internal/experience.json");
  check("proxy: the machine surfaces are let through", machine.status !== 404, `HTTP ${machine.status}`);

  const { ruleMarkdown } = await import("../lib/rule");
  const privateRule = ruleMarkdown(true, "Acme Bank", "https://kb.acme.internal");
  check(
    "rule: says where a report stays, never that it is published",
    privateRule.includes("stays inside Acme Bank") &&
      !privateRule.includes("licensed for model training") &&
      !/everything here is\s+published/.test(privateRule) &&
      privateRule.includes("everyone in Acme Bank"),
  );
  check(
    "rule: never sends a private deployment's errors to the public store",
    !privateRule.includes("knowbase.sh") && privateRule.includes("POST https://kb.acme.internal/experience.json"),
    privateRule.split("\n").find((l) => l.includes("experience.json")),
  );
  check(
    "rule: does not promise that reading needs no key",
    !privateRule.includes("needs no key") && !privateRule.includes("Reading needs no identity"),
  );
  const publicRule = ruleMarkdown(false, "", "https://knowbase.sh");
  check("rule: the public deployment still says it publishes", publicRule.includes("licensed for model training"));
  check("rule: both carry the no-translate clause", privateRule.includes("never") && publicRule.includes("never"));
  check("rule: no unresolved template slot", !privateRule.includes("${") && !publicRule.includes("${"));

  const { toolDefinitions, instructionsFor, publicationNote } = await import("../lib/mcp/contract");
  const recall = toolDefinitions(true).find((t) => t.name === "knowbase_recall");
  const problemDoc = JSON.stringify(recall?.inputSchema ?? {});
  check(
    "tool description: private sentence, no publication grant",
    problemDoc.includes("never published") && !problemDoc.includes("PUBLISHED") && !problemDoc.includes("__PUBLICATION__"),
    problemDoc.slice(0, 200),
  );
  const publicDoc = JSON.stringify(toolDefinitions(false).find((t) => t.name === "knowbase_recall")?.inputSchema ?? {});
  check("tool description: public sentence on the public deployment", publicDoc.includes("PUBLISHED") && !publicDoc.includes("__PUBLICATION__"));
  check("instructions: private deployments say so", instructionsFor(true).includes("private to Acme Bank"));
  check(
    "instructions and tools point at this deployment, never the public one",
    !instructionsFor(true).includes("knowbase.sh") &&
      instructionsFor(true).includes("kb.acme.internal") &&
      !JSON.stringify(toolDefinitions(true)).includes("knowbase.sh"),
    instructionsFor(true).split(" ").filter((w) => w.includes("knowbase.sh")).join(" "),
  );
  check("publication note names the organisation", publicationNote(true).includes("Acme Bank"));

  const { GET } = await import("../app/experience.json/route");
  const res = await GET(new Request("https://knowbase.example/experience.json?problem=Error%3A%20connect%20ECONNREFUSED%20127.0.0.1%3A5432"));
  const body = (await res.json()) as Record<string, unknown>;
  check("reading without the secret is refused", res.status === 401, `HTTP ${res.status}`);
  check("and the reply carries no licence grant", !("license" in body) && body.scope === "private", JSON.stringify(body).slice(0, 160));

  // Registration is the door beside the read gate: it used to hand out its own key.
  const { POST } = await import("../app/experience.json/route");
  const register = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    POST(
      new Request("https://kb.acme.internal/experience.json", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ action: "register", name: `probe-${Math.random().toString(36).slice(2, 8)}`, ...extra }),
      }),
    );
  delete process.env.KNOWBASE_ENROL;
  const noToken = await register();
  check(
    "with no enrolment token configured, nobody is enrolled",
    noToken.status === 403,
    `HTTP ${noToken.status} ${JSON.stringify(await noToken.clone().json()).slice(0, 140)}`,
  );
  process.env.KNOWBASE_ENROL = "acme-enrolment-token";
  const wrongToken = await register({ enrol: "guess" });
  check("a wrong enrolment token is refused", wrongToken.status === 403, `HTTP ${wrongToken.status}`);
  const anonymous = await register();
  check("registering with no token at all is refused", anonymous.status === 403, `HTTP ${anonymous.status}`);
  const rightToken = await register({}, { "x-knowbase-enrol": "acme-enrolment-token" });
  check(
    "the organisation's own token gets through the gate",
    rightToken.status !== 403,
    `HTTP ${rightToken.status} (503 here: this offline eval has no store binding)`,
  );
  delete process.env.KNOWBASE_ENROL;

  console.log(
    failed === 0
      ? `\n${GREEN}private: nothing is published, the site is closed, reading and enrolling need the organisation's secret${RESET}`
      : `\n${RED}${failed} private-mode check(s) failed${RESET}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
