/**
 * Compiles content/ko/*.yaml into a TypeScript module the site can import.
 *
 * The site runs as a Cloudflare Worker, where `node:fs` does not exist — a page
 * that reads YAML at request time 500s. Baking the corpus into a module also makes
 * every route genuinely static: no disk access, no parse cost, no per-request work.
 *
 * Runs automatically before dev and build (npm `pre*` hooks) so the generated file
 * can never drift from the YAML.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { loadFromDisk } from "../lib/ko/fs-loader";
import {
  buildAgentsCard,
  buildMcpServerCard,
  serializeDiscoveryDocument,
} from "../lib/mcp/contract";

const OUT = path.join(process.cwd(), "lib", "ko", "content.generated.ts");
const MCP_CARD_OUT = path.join(process.cwd(), "public", ".well-known", "mcp.json");
const MCP_CARD_ALIAS_OUT = path.join(process.cwd(), "public", ".well-known", "mcp");
const AGENTS_CARD_OUT = path.join(process.cwd(), "public", ".well-known", "agents.json");

function main() {
  const objects = loadFromDisk();

  const body = [
    "// GENERATED FILE — do not edit.",
    "// Produced from content/ko/*.yaml by scripts/build-content.ts.",
    "// Regenerate with `npm run content`; it also runs before dev and build.",
    "",
    'import type { KnowledgeObject } from "./schema";',
    "",
    `export const GENERATED_AT = ${JSON.stringify(new Date().toISOString())};`,
    "",
    `export const KNOWLEDGE_OBJECTS: KnowledgeObject[] = ${JSON.stringify(objects, null, 2)};`,
    "",
  ].join("\n");

  writeFileSync(OUT, body, "utf8");

  // Discovery is generated from the same declarative contract as the runtime.
  // Both MCP paths intentionally receive the exact same bytes because clients probe
  // both spellings while the server-card convention settles.
  const mcpCard = serializeDiscoveryDocument(buildMcpServerCard());
  const agentsCard = serializeDiscoveryDocument(buildAgentsCard());
  writeFileSync(MCP_CARD_OUT, mcpCard, "utf8");
  writeFileSync(MCP_CARD_ALIAS_OUT, mcpCard, "utf8");
  writeFileSync(AGENTS_CARD_OUT, agentsCard, "utf8");

  const bytes = Buffer.byteLength(body, "utf8");
  console.log(
    `content bundle: ${objects.length} knowledge objects → lib/ko/content.generated.ts (${(bytes / 1024).toFixed(1)} kB)`,
  );
  console.log("agent discovery: mcp, mcp.json and agents.json refreshed from contract");
}

main();
