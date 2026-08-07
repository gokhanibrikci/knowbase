import { absoluteUrl, site } from "@/lib/site";
import { freshnessOf } from "./store";
import type { KnowledgeObject } from "./schema";

export const SCHEMA_VERSION = "1.0";

/**
 * The JSON body is the contract we expect agents to parse, so it carries a
 * version and derived fields the YAML source does not store.
 */
export function toJson(ko: KnowledgeObject, now: Date = new Date()) {
  const freshness = freshnessOf(ko, now);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: ko.slug,
    url: absoluteUrl(`/k/${ko.slug}`),
    title: ko.title,
    summary: ko.summary,
    domain: ko.domain,
    tags: ko.tags,
    error: ko.error,
    problem: ko.problem,
    rootCauses: ko.rootCauses,
    solution: ko.solution,
    appliesTo: ko.appliesTo,
    notApplicableTo: ko.notApplicableTo,
    evidence: ko.evidence,
    confidence: {
      level: ko.confidence,
      rationale: ko.confidenceRationale,
      primarySources: ko.evidence.filter((e) =>
        ["official-docs", "specification", "source-code"].includes(e.type),
      ).length,
      totalSources: ko.evidence.length,
    },
    freshness: {
      created: ko.freshness.created,
      updated: ko.freshness.updated,
      verifiedAt: freshness.verifiedAt,
      reviewIntervalDays: ko.freshness.reviewIntervalDays,
      staleAt: freshness.staleAt,
      ageDays: freshness.ageDays,
      status: freshness.status,
    },
    related: ko.related.map((slug) => ({ id: slug, url: absoluteUrl(`/k/${slug}`) })),
    license: "CC-BY-4.0",
    source: site.url,
  };
}

function fence(code: string, language?: string): string {
  return ["```" + (language ?? ""), code.trimEnd(), "```"].join("\n");
}

export function toMarkdown(ko: KnowledgeObject, now: Date = new Date()): string {
  const f = freshnessOf(ko, now);
  const out: string[] = [];

  out.push(`# ${ko.title}`, "", ko.summary, "");
  out.push(
    `> Confidence: ${ko.confidence} · Verified: ${f.verifiedAt} · Status: ${f.status} · Source: ${absoluteUrl(`/k/${ko.slug}`)}`,
    "",
  );

  out.push("## Error signature", "", fence(ko.error.signature), "");
  if (ko.error.codes.length > 0) out.push(`Codes: ${ko.error.codes.join(", ")}`, "");

  out.push("## Problem", "", ko.problem, "");

  out.push("## Root cause", "");
  for (const cause of ko.rootCauses) {
    out.push(`- **${cause.cause}** _(${cause.weight})_`);
    if (cause.detail) out.push(`  - ${cause.detail}`);
    if (cause.discriminator) out.push(`  - How to tell: ${cause.discriminator}`);
  }
  out.push("");

  out.push("## Solution", "");
  ko.solution.steps.forEach((step, i) => {
    out.push(`${i + 1}. ${step.instruction}`);
    if (step.command) out.push("", fence(step.command, "bash"), "");
    if (step.code) out.push("", fence(step.code, step.language), "");
    if (step.note) out.push(`   Note: ${step.note}`);
  });
  out.push("");
  if (ko.solution.verification) out.push(`**Verify:** ${ko.solution.verification}`, "");
  if (ko.solution.fallback) out.push(`**If that fails:** ${ko.solution.fallback}`, "");

  out.push("## Applies to", "");
  for (const tech of ko.appliesTo.technology) {
    out.push(`- ${tech.name}: ${tech.versions}${tech.note ? ` — ${tech.note}` : ""}`);
  }
  if (ko.appliesTo.runtimes?.length) out.push(`- Runtimes: ${ko.appliesTo.runtimes.join(", ")}`);
  if (ko.appliesTo.platforms?.length) out.push(`- Platforms: ${ko.appliesTo.platforms.join(", ")}`);
  out.push("");

  if (ko.notApplicableTo.length > 0) {
    out.push("## Not applicable to", "");
    for (const item of ko.notApplicableTo) out.push(`- ${item}`);
    out.push("");
  }

  out.push("## Evidence", "");
  ko.evidence.forEach((e, i) => {
    out.push(`${i + 1}. [${e.title}](${e.url}) — ${e.publisher} (${e.type}), read ${e.retrievedAt}`);
    out.push(`   Supports: ${e.supports}`);
    if (e.quote) out.push(`   > ${e.quote}`);
  });
  out.push("");

  out.push("## Confidence", "", `${ko.confidence} — ${ko.confidenceRationale}`, "");
  out.push(
    "---",
    "",
    `Retrieved from ${absoluteUrl(`/k/${ko.slug}`)} · ${site.name} · CC-BY-4.0`,
    "",
  );

  return out.join("\n");
}

export function toPlainText(ko: KnowledgeObject, now: Date = new Date()): string {
  const f = freshnessOf(ko, now);
  const rule = "-".repeat(72);
  const out: string[] = [];

  out.push(ko.title.toUpperCase(), rule, ko.summary, "");
  out.push(
    `CONFIDENCE : ${ko.confidence}`,
    `VERIFIED   : ${f.verifiedAt} (${f.status}, ${f.ageDays}d old)`,
    `URL        : ${absoluteUrl(`/k/${ko.slug}`)}`,
    "",
  );

  out.push("ERROR", rule, ko.error.signature, "");
  if (ko.error.codes.length > 0) out.push(`CODES: ${ko.error.codes.join(", ")}`, "");

  out.push("PROBLEM", rule, ko.problem, "");

  out.push("ROOT CAUSE", rule);
  ko.rootCauses.forEach((c, i) => {
    out.push(`${i + 1}. [${c.weight}] ${c.cause}`);
    if (c.detail) out.push(`   ${c.detail}`);
    if (c.discriminator) out.push(`   how to tell: ${c.discriminator}`);
  });
  out.push("");

  out.push("SOLUTION", rule);
  ko.solution.steps.forEach((step, i) => {
    out.push(`${i + 1}. ${step.instruction}`);
    if (step.command) out.push(`   $ ${step.command.split("\n").join("\n   ")}`);
    if (step.code) out.push(`   ${step.code.split("\n").join("\n   ")}`);
    if (step.note) out.push(`   note: ${step.note}`);
  });
  out.push("");
  if (ko.solution.verification) out.push(`VERIFY: ${ko.solution.verification}`, "");
  if (ko.solution.fallback) out.push(`FALLBACK: ${ko.solution.fallback}`, "");

  out.push("APPLIES TO", rule);
  for (const tech of ko.appliesTo.technology) {
    out.push(`  ${tech.name}: ${tech.versions}${tech.note ? ` (${tech.note})` : ""}`);
  }
  if (ko.appliesTo.runtimes?.length) out.push(`  runtimes: ${ko.appliesTo.runtimes.join(", ")}`);
  if (ko.appliesTo.platforms?.length) out.push(`  platforms: ${ko.appliesTo.platforms.join(", ")}`);
  out.push("");

  if (ko.notApplicableTo.length > 0) {
    out.push("NOT APPLICABLE TO", rule);
    for (const item of ko.notApplicableTo) out.push(`  - ${item}`);
    out.push("");
  }

  out.push("EVIDENCE", rule);
  ko.evidence.forEach((e, i) => {
    out.push(`${i + 1}. ${e.title}`);
    out.push(`   ${e.url}`);
    out.push(`   ${e.publisher} | ${e.type} | read ${e.retrievedAt}`);
    out.push(`   supports: ${e.supports}`);
  });
  out.push("");

  out.push("CONFIDENCE", rule, `${ko.confidence} — ${ko.confidenceRationale}`, "");
  out.push(rule, `${site.name} ${site.version} — CC-BY-4.0`, "");

  return out.join("\n");
}
