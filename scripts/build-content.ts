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

const OUT = path.join(process.cwd(), "lib", "ko", "content.generated.ts");

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

  const bytes = Buffer.byteLength(body, "utf8");
  console.log(
    `content bundle: ${objects.length} knowledge objects → lib/ko/content.generated.ts (${(bytes / 1024).toFixed(1)} kB)`,
  );
}

main();
