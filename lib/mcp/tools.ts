import { diagnose } from "@/lib/ko/diagnose";
import { matchKnowledgeObjects } from "@/lib/ko/match";
import { freshnessOf, getAllKnowledgeObjects, getKnowledgeObject } from "@/lib/ko/store";
import { logQuery, logReport, newLookupId } from "@/lib/query-log";
import { absoluteUrl } from "@/lib/site";

/**
 * The three tools, and what they return.
 *
 * A thin wrapper over the same functions /search.json, /diagnose.json and
 * /outcome.json call — deliberately, so the two surfaces cannot drift into
 * disagreeing about what the corpus says.
 *
 * The output is prose rather than a JSON dump. A tool result is read by a model,
 * and a model reads "3 of 5 causes ruled out, here is the check for each" better
 * than it reads a nested object it has to hold in its head. Machine-shaped copies
 * of everything here stay one fetch away at the .json URLs.
 */

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Descriptions carry the workflow, because nothing else will. A client sees these
 * strings and nothing about how the three relate, so each one names what comes
 * next — this is the only place the loop can be explained to the caller.
 */
export const TOOLS: ToolDefinition[] = [
  {
    name: "knowbase_lookup",
    title: "Look up a verified fix for an error",
    description:
      "Find verified, source-backed entries for a concrete technical error. Paste the error message, error code, or the whole stack trace — boilerplate is discounted automatically, so it does not need cleaning first. Returns a match verdict of strong, partial or none; on none it returns nothing rather than the nearest entry, which means this corpus genuinely does not cover that failure and you should not treat anything from it as the answer. Each result lists the possible root causes with a cheap check that tells them apart. After running those checks, call knowbase_diagnose to narrow to one.",
    inputSchema: {
      type: "object",
      properties: {
        error: {
          type: "string",
          description: "The error message, code, or pasted stack trace.",
        },
        limit: {
          type: "integer",
          description: "Maximum entries to return. 1-10, default 3.",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["error"],
    },
  },
  {
    name: "knowbase_diagnose",
    title: "Narrow an entry to the one cause you have",
    description:
      "Given what the discriminator checks from knowbase_lookup actually returned, identify which of an entry's root causes is the one present, and which are ruled out and why. Call this once you have run the checks — it is the only way to tell several plausible causes apart, and the answer includes the fix steps. If the observations do not separate the causes it says so rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The entry id from knowbase_lookup, e.g. kubernetes-imagepullbackoff.",
        },
        observations: {
          type: "string",
          description:
            "What the discriminator checks returned — log lines, event text, command output.",
        },
        lookupId: {
          type: "string",
          description: "The lookupId from the knowbase_lookup result, if you have it.",
        },
      },
      required: ["slug", "observations"],
    },
  },
  {
    name: "knowbase_report_outcome",
    title: "Report whether the fix worked",
    description:
      "Optional. Report whether the fix held after you applied it. This cannot change what an entry claims — confidence here is gated on evidence, not on use — but a fix reported as failing puts the entry in the queue to be re-checked against its sources, which is how stale entries get found. Include a note when something differed, such as a version the steps did not cover.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The entry you applied." },
        worked: { type: "boolean", description: "Did the fix resolve the failure?" },
        note: {
          type: "string",
          description: "What differed — a version, a platform, a step that did not apply.",
        },
        lookupId: { type: "string", description: "The lookupId, if you have it." },
      },
      required: ["slug", "worked"],
    },
  },
];

export type ToolOutcome = { text: string; isError?: boolean };

function lookup(args: Record<string, unknown>, userAgent: string): ToolOutcome {
  const error = typeof args.error === "string" ? args.error : "";
  if (!error.trim()) return { text: "The 'error' argument is required.", isError: true };

  const limit = Math.min(10, Math.max(1, Number(args.limit) || 3));
  const all = getAllKnowledgeObjects();
  const report = matchKnowledgeObjects(all, error);
  const lookupId = newLookupId();

  logQuery(error, report, userAgent, lookupId);

  if (report.verdict === "none") {
    const gap = report.unmatchedTerms.length
      ? ` Nothing here mentions: ${report.unmatchedTerms.slice(0, 8).join(", ")}.`
      : "";
    return {
      text:
        `No entry in knowbase covers this error (${all.length} entries searched).${gap}\n\n` +
        "Do not treat anything from this corpus as the answer to it. This was recorded as a gap.",
    };
  }

  const lines: string[] = [];
  lines.push(`match: ${report.verdict}   lookupId: ${lookupId}`);
  lines.push(
    report.verdict === "strong"
      ? "One entry clearly covers this. Check notApplicableTo before applying it."
      : "No entry clearly covers this. Treat these as leads to verify, not as the answer.",
  );

  for (const { ko, score } of report.results.slice(0, limit)) {
    const fresh = freshnessOf(ko);
    lines.push("");
    lines.push(`## ${ko.title}`);
    lines.push(`slug: ${ko.slug}   fit: ${score.toFixed(2)}   url: ${absoluteUrl(`/k/${ko.slug}`)}`);
    lines.push(
      `confidence: ${ko.confidence} (${ko.evidence.length} sources)   verified: ${fresh.verifiedAt} (${fresh.status})`,
    );
    lines.push(ko.summary);
    lines.push(`applies to: ${ko.appliesTo.technology.map((t) => `${t.name} ${t.versions}`).join("; ")}`);

    lines.push("");
    lines.push("possible causes — run these checks, then call knowbase_diagnose:");
    for (const cause of ko.rootCauses) {
      lines.push(`  [${cause.weight}] ${cause.cause}`);
      lines.push(`      check: ${cause.discriminator}`);
    }

    if (ko.notApplicableTo.length) {
      lines.push("");
      lines.push("NOT this entry if the failure is:");
      for (const item of ko.notApplicableTo) lines.push(`  - ${item}`);
    }
  }

  return { text: lines.join("\n") };
}

function runDiagnosis(args: Record<string, unknown>, userAgent: string): ToolOutcome {
  const slug = typeof args.slug === "string" ? args.slug : "";
  const observations = typeof args.observations === "string" ? args.observations : "";

  if (!slug) return { text: "The 'slug' argument is required.", isError: true };
  if (!observations.trim()) {
    return { text: "The 'observations' argument is required.", isError: true };
  }

  const ko = getKnowledgeObject(slug);
  if (!ko) return { text: `No entry with id '${slug}'.`, isError: true };

  const result = diagnose(ko, observations);

  logReport(
    {
      kind: "diagnosis",
      lookupId: typeof args.lookupId === "string" ? args.lookupId.slice(0, 32) : "",
      slug: ko.slug,
      cause: result.identified?.cause.cause ?? "",
      lead: result.identified ? result.identified.score - (result.ranked[1]?.score ?? 0) : 0,
      observations,
    },
    userAgent,
  );

  const lines: string[] = [`# ${ko.title}`, ""];

  if (result.identified) {
    const c = result.identified.cause;
    lines.push(`CAUSE IDENTIFIED (${c.weight}): ${c.cause}`);
    if (c.detail) lines.push(c.detail);
    lines.push(`matched on: ${result.identified.matchedTerms.join(", ")}`);
  } else if (result.ranked[0]?.score > 0) {
    lines.push("NOT IDENTIFIED — these observations do not separate the causes.");
    lines.push("Run the checks below and call again with what they return.");
  } else {
    lines.push("NOT IDENTIFIED — nothing in these observations matches any check for this entry.");
    lines.push("This may be the wrong entry; re-read its notApplicableTo list.");
  }

  const rest = result.ranked.slice(result.identified ? 1 : 0);
  if (rest.length) {
    lines.push("");
    lines.push(result.identified ? "Ruled out:" : "Candidates, best fit first:");
    for (const r of rest) {
      lines.push(`  [${r.cause.weight}] ${r.cause.cause}  (fit ${r.score.toFixed(2)})`);
      lines.push(`      check: ${r.cause.discriminator}`);
    }
  }

  lines.push("", "## Fix", "");
  ko.solution.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.instruction}`);
    if (step.command) lines.push(`   $ ${step.command.split("\n").join("\n   ")}`);
    if (step.code) lines.push(`   ${step.code.split("\n").join("\n   ")}`);
    if (step.note) lines.push(`   note: ${step.note}`);
  });

  lines.push("", `verify: ${ko.solution.verification}`);
  if (ko.solution.fallback) lines.push(`if that fails: ${ko.solution.fallback}`);

  lines.push("", `source: ${absoluteUrl(`/k/${ko.slug}`)} (CC-BY-4.0)`);
  lines.push("Once you know whether it held, knowbase_report_outcome records it.");

  return { text: lines.join("\n") };
}

function reportOutcome(args: Record<string, unknown>, userAgent: string): ToolOutcome {
  const slug = typeof args.slug === "string" ? args.slug : "";
  if (!slug) return { text: "The 'slug' argument is required.", isError: true };
  if (typeof args.worked !== "boolean") {
    return { text: "The 'worked' argument must be a boolean.", isError: true };
  }

  const ko = getKnowledgeObject(slug);
  if (!ko) return { text: `No entry with id '${slug}'.`, isError: true };

  logReport(
    {
      kind: "outcome",
      lookupId: typeof args.lookupId === "string" ? args.lookupId.slice(0, 32) : "",
      slug: ko.slug,
      worked: args.worked,
      note: typeof args.note === "string" ? args.note.slice(0, 2000) : "",
    },
    userAgent,
  );

  return {
    text: args.worked
      ? `Recorded for ${ko.slug}. This does not raise the entry's confidence — that is gated on evidence, not on use.`
      : `Recorded for ${ko.slug}, and queued for re-verification against its sources.`,
  };
}

export function callTool(
  name: string,
  args: Record<string, unknown>,
  userAgent: string,
): ToolOutcome {
  switch (name) {
    case "knowbase_lookup":
      return lookup(args, userAgent);
    case "knowbase_diagnose":
      return runDiagnosis(args, userAgent);
    case "knowbase_report_outcome":
      return reportOutcome(args, userAgent);
    default:
      return { text: `Unknown tool: ${name}`, isError: true };
  }
}

export const INSTRUCTIONS =
  "knowbase holds verified, source-backed answers to concrete engineering failures. " +
  "Every entry cites primary sources, states which versions it applies to, names what it " +
  "does NOT apply to, and carries the date it was last checked. " +
  "Use knowbase_lookup when you hold a specific error and want an answer that is backed by " +
  "something rather than recalled. It answers 'none' when the corpus does not cover a failure — " +
  "trust that answer; it is the point of the service. " +
  "Then run the discriminator checks it returns and call knowbase_diagnose to narrow to a single cause.";
