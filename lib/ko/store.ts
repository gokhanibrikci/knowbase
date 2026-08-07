/**
 * The corpus, as the site sees it.
 *
 * Reads from a module generated at build time rather than from disk, because the
 * site is compiled to a Cloudflare Worker with no filesystem. Tooling that does
 * need the disk — the validator, the grounding gate, the pipeline — uses
 * lib/ko/fs-loader.ts instead.
 */
import { KNOWLEDGE_OBJECTS } from "./content.generated";
import type { KnowledgeObject } from "./schema";

export { freshnessOf, type Freshness } from "./freshness";

export function getAllKnowledgeObjects(): KnowledgeObject[] {
  return KNOWLEDGE_OBJECTS;
}

export function getKnowledgeObject(slug: string): KnowledgeObject | undefined {
  return KNOWLEDGE_OBJECTS.find((ko) => ko.slug === slug);
}

export function getRelated(ko: KnowledgeObject): KnowledgeObject[] {
  return ko.related
    .map((slug) => getKnowledgeObject(slug))
    .filter((x): x is KnowledgeObject => Boolean(x));
}
