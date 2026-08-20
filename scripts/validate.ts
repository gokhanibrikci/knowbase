/**
 * Build gate for the knowledge base.
 *
 * A KO that fails schema or editorial rules must never reach the site, because the
 * whole proposition is that anything published here is checkable. Run via
 * `npm run validate`; `npm run build` depends on it.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import { loadFromDisk } from "../lib/ko/fs-loader";
import { freshnessOf } from "../lib/ko/freshness";
import { checkDepthRules, checkEditorialRules } from "../lib/ko/schema";
import {
  AGENT_ENDPOINTS,
  AGENT_INTERFACE_DEFINITIONS,
  MCP_PROTOCOL,
  MCP_SUPPORTED_VERSIONS,
  TOOLS,
  buildAgentsCard,
  buildMcpServerCard,
  serializeDiscoveryDocument,
} from "../lib/mcp/contract";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function handlerNamesFromSource(): string[] {
  const filename = path.join(process.cwd(), "lib", "mcp", "tools.ts");
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let handlers: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "TOOL_HANDLERS" &&
      node.initializer
    ) {
      const expression = ts.isSatisfiesExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isObjectLiteralExpression(expression)) handlers = expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (!handlers) return [];
  return handlers.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const name = property.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return [name.text];
    }
    return [];
  });
}

function exportedRouteMethods(filename: string): Set<string> {
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const methods = new Set<string>();
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    Boolean(
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
      methods.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) methods.add(declaration.name.text);
      }
    }
  }

  return methods;
}

function checkAgentContract(): string[] {
  const violations: string[] = [];
  const root = process.cwd();
  const expectedMcp = serializeDiscoveryDocument(buildMcpServerCard());
  const expectedAgents = serializeDiscoveryDocument(buildAgentsCard());
  const discoveryFiles = [
    [path.join(root, "public", ".well-known", "mcp"), expectedMcp],
    [path.join(root, "public", ".well-known", "mcp.json"), expectedMcp],
    [path.join(root, "public", ".well-known", "agents.json"), expectedAgents],
  ] as const;

  for (const [filename, expected] of discoveryFiles) {
    let actual: string;
    try {
      actual = readFileSync(filename, "utf8");
    } catch {
      violations.push(`${path.relative(root, filename)} is missing`);
      continue;
    }
    if (actual !== expected) {
      violations.push(`${path.relative(root, filename)} drifted; run npm run content`);
    }
  }

  if (
    MCP_PROTOCOL.transports.length !== 1 ||
    MCP_PROTOCOL.transports[0] !== "streamable-http"
  ) {
    violations.push("MCP transport must match the POST-only /mcp route: streamable-http");
  }

  const versions = [...MCP_SUPPORTED_VERSIONS];
  if (
    versions[0] !== MCP_PROTOCOL.modernVersion ||
    versions.slice(1).join("\0") !== MCP_PROTOCOL.legacyVersions.join("\0") ||
    new Set(versions).size !== versions.length
  ) {
    violations.push("MCP supported versions must be modern first, followed by unique legacy versions");
  }

  const toolNames = TOOLS.map((tool) => tool.name);
  if (new Set(toolNames).size !== toolNames.length) {
    violations.push("MCP tool names must be unique");
  }

  const handlerNames = handlerNamesFromSource();
  if (toolNames.join("\0") !== handlerNames.join("\0")) {
    violations.push(
      `MCP tool definitions and handlers differ: definitions=[${toolNames.join(", ")}], handlers=[${handlerNames.join(", ")}]`,
    );
  }

  for (const endpoint of AGENT_INTERFACE_DEFINITIONS) {
    const routeFile = path.join(root, "app", endpoint.path.slice(1), "route.ts");
    if (!existsSync(routeFile)) {
      violations.push(`${endpoint.method} ${endpoint.path} has no route.ts implementation`);
    } else if (!exportedRouteMethods(routeFile).has(endpoint.method)) {
      violations.push(`${endpoint.path}/route.ts does not export ${endpoint.method}`);
    }
  }

  const mcpRoute = path.join(root, "app", AGENT_ENDPOINTS.mcp.path.slice(1), "route.ts");
  if (!existsSync(mcpRoute)) {
    violations.push(`${AGENT_ENDPOINTS.mcp.method} ${AGENT_ENDPOINTS.mcp.path} has no route.ts implementation`);
  } else if (!exportedRouteMethods(mcpRoute).has(AGENT_ENDPOINTS.mcp.method)) {
    violations.push(
      `${AGENT_ENDPOINTS.mcp.path}/route.ts does not export ${AGENT_ENDPOINTS.mcp.method}`,
    );
  }

  return violations;
}

function normaliseScopePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/**
 * An alias is positive identity. Repeating it verbatim in negative scope makes the
 * same query both applicable and inapplicable; the matcher cannot resolve that tie.
 * Semantic near-misses remain allowed — only phrase containment is structurally
 * knowable here, while retrieval evals cover the more nuanced cases.
 */
function aliasScopeConflicts(
  aliases: string[],
  notApplicableTo: string[],
): Array<{ alias: string; exclusion: string }> {
  const conflicts: Array<{ alias: string; exclusion: string }> = [];

  for (const alias of aliases) {
    const normalisedAlias = normaliseScopePhrase(alias);
    if (normalisedAlias.length < 6) continue;

    for (const exclusion of notApplicableTo) {
      const normalisedExclusion = normaliseScopePhrase(exclusion);
      if (normalisedExclusion.includes(normalisedAlias)) {
        conflicts.push({ alias, exclusion });
      }
    }
  }

  return conflicts;
}

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

  const agentContractViolations = checkAgentContract();
  if (agentContractViolations.length > 0) {
    failed++;
    console.error(`${RED}✖ agent interface contract${RESET}`);
    for (const message of agentContractViolations) console.error(`  ${message}`);
  } else {
    console.log(`${GREEN}✓${RESET} agent interface contract`);
  }

  for (const ko of objects) {
    const violations = [...checkEditorialRules(ko), ...checkDepthRules(ko)];
    for (const conflict of aliasScopeConflicts(ko.error.aliases, ko.notApplicableTo)) {
      violations.push({
        rule: "alias-negative-scope-conflict",
        message: `alias '${conflict.alias}' is also declared not applicable: '${conflict.exclusion}'`,
      });
    }
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
    console.error(`\n${RED}${failed} validation group(s) failed${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}all knowledge objects valid${RESET}`);
}

main();
