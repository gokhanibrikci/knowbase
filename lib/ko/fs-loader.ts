/**
 * Filesystem access to the corpus — for tooling only.
 *
 * The site must never reach for the disk: it is compiled to a Worker where
 * `node:fs` does not exist, so `content/ko/*.yaml` is baked into a generated
 * module at build time (see scripts/build-content.ts). Everything in this file is
 * for the validator, the grounding gate, and the research pipeline, all of which
 * run in Node.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { checkDepthRules, checkEditorialRules, koSchema, type KnowledgeObject } from "./schema";

export const CONTENT_DIR = path.join(process.cwd(), "content", "ko");

/**
 * Where the research pipeline writes drafts. Kept inside content/ko/ so relative
 * tooling paths stay simple, but invisible to the loader: readdirSync returns the
 * directory entry `.staging`, which the `.yaml` filter drops. Drafts are promoted
 * into content/ko/ only once validate and verify:quotes both pass.
 */
export const STAGING_DIR = path.join(CONTENT_DIR, ".staging");

export class KnowledgeObjectError extends Error {
  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = "KnowledgeObjectError";
  }
}

export function parseFile(dir: string, file: string): KnowledgeObject {
  const raw = readFileSync(path.join(dir, file), "utf8");
  const data = parseYaml(raw);
  const result = koSchema.safeParse(data);

  if (!result.success) {
    throw new KnowledgeObjectError(file, `\n${z.prettifyError(result.error)}`);
  }

  const violations = [...checkEditorialRules(result.data), ...checkDepthRules(result.data)];
  if (violations.length > 0) {
    const detail = violations.map((v) => `  ✖ [${v.rule}] ${v.message}`).join("\n");
    throw new KnowledgeObjectError(file, `editorial rules failed\n${detail}`);
  }

  const expected = `${result.data.slug}.yaml`;
  if (file !== expected) {
    throw new KnowledgeObjectError(file, `filename must match slug (expected ${expected})`);
  }

  return result.data;
}

/** Checks that only make sense against the whole corpus, not one file. */
export function checkCorpus(objects: KnowledgeObject[]): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();

  for (const ko of objects) {
    if (slugs.has(ko.slug)) problems.push(`duplicate KO slug: ${ko.slug}`);
    slugs.add(ko.slug);
  }

  for (const ko of objects) {
    for (const rel of ko.related) {
      if (rel === ko.slug) problems.push(`${ko.slug}.yaml: a KO cannot relate to itself`);
      else if (!slugs.has(rel)) {
        problems.push(`${ko.slug}.yaml: related slug does not exist: ${rel}`);
      }
    }
  }

  return problems;
}

export function yamlFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
}

/** Strict load: throws on the first problem. This is the gate the build depends on. */
export function loadFromDisk(dir: string = CONTENT_DIR): KnowledgeObject[] {
  const objects = yamlFilesIn(dir).map((f) => parseFile(dir, f));

  const problems = checkCorpus(objects);
  if (problems.length > 0) throw new Error(problems.join("\n"));

  return objects.sort((a, b) => a.title.localeCompare(b.title));
}

export type LoadFailure = { file: string; error: string };

/**
 * Loads every KO it can and reports the rest instead of throwing.
 *
 * The strict loader is right for the build: a corpus that fails its own rules must
 * not ship. It is wrong for the pipeline, where a run killed mid-write would
 * otherwise take every tool down with it.
 */
export function loadAllTolerant(dir: string = CONTENT_DIR): {
  ok: KnowledgeObject[];
  failed: LoadFailure[];
  corpusProblems: string[];
} {
  let files: string[];
  try {
    files = yamlFilesIn(dir);
  } catch {
    return { ok: [], failed: [], corpusProblems: [] };
  }

  const ok: KnowledgeObject[] = [];
  const failed: LoadFailure[] = [];

  for (const file of files) {
    try {
      ok.push(parseFile(dir, file));
    } catch (error) {
      failed.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    ok: ok.sort((a, b) => a.title.localeCompare(b.title)),
    failed,
    corpusProblems: checkCorpus(ok),
  };
}
