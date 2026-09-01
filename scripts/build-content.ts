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
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadFromDisk } from "../lib/ko/fs-loader";
import {
  buildServerCard,
  buildAgentsCard,
  buildMcpServerCard,
  serializeDiscoveryDocument,
} from "../lib/mcp/contract";

const OUT = path.join(process.cwd(), "lib", "ko", "content.generated.ts");
const MCP_CARD_OUT = path.join(process.cwd(), "public", ".well-known", "mcp.json");
const AGENTS_CARD_OUT = path.join(process.cwd(), "public", ".well-known", "agents.json");
const SERVER_CARD_OUT = path.join(
  process.cwd(),
  "public",
  ".well-known",
  "mcp",
  "server-card.json",
);

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
  // The bare /.well-known/mcp spelling is a rewrite onto mcp.json rather than a second
  // file, because the name has to be a directory: /.well-known/mcp/server-card.json is
  // the path remote-server directories document scanning.
  const mcpCard = serializeDiscoveryDocument(buildMcpServerCard());
  const agentsCard = serializeDiscoveryDocument(buildAgentsCard());
  mkdirSync(path.dirname(SERVER_CARD_OUT), { recursive: true });
  writeFileSync(MCP_CARD_OUT, mcpCard, "utf8");
  writeFileSync(AGENTS_CARD_OUT, agentsCard, "utf8");
  writeFileSync(SERVER_CARD_OUT, serializeDiscoveryDocument(buildServerCard()), "utf8");

  const bytes = Buffer.byteLength(body, "utf8");
  console.log(
    `content bundle: ${objects.length} knowledge objects → lib/ko/content.generated.ts (${(bytes / 1024).toFixed(1)} kB)`,
  );
  console.log("agent discovery: mcp, mcp.json, agents.json and the server card refreshed from contract");
}

main();
