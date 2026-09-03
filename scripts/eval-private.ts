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

  const { ruleMarkdown } = await import("../lib/rule");
  const privateRule = ruleMarkdown(true, "Acme Bank");
  check(
    "rule: says where a report stays, never that it is published",
    privateRule.includes("stays inside Acme Bank") &&
      !privateRule.includes("licensed for model training") &&
      !/everything here is\s+published/.test(privateRule) &&
      privateRule.includes("everyone in Acme Bank"),
  );
  const publicRule = ruleMarkdown(false, "");
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
  check("publication note names the organisation", publicationNote(true).includes("Acme Bank"));

  const { GET } = await import("../app/experience.json/route");
  const res = await GET(new Request("https://knowbase.example/experience.json?problem=Error%3A%20connect%20ECONNREFUSED%20127.0.0.1%3A5432"));
  const body = (await res.json()) as Record<string, unknown>;
  check("reading without the secret is refused", res.status === 401, `HTTP ${res.status}`);
  check("and the reply carries no licence grant", !("license" in body) && body.scope === "private", JSON.stringify(body).slice(0, 160));

  console.log(
    failed === 0
      ? `\n${GREEN}private: nothing is published, reading needs the secret, the rule says where data stays${RESET}`
      : `\n${RED}${failed} private-mode check(s) failed${RESET}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
