import { diagnose } from "@/lib/ko/diagnose";
import { completeResolution } from "@/lib/ko/complete-resolution";
import {
  isPlaceholderQuery,
  matchKnowledgeObjects,
  presentableMatchResults,
} from "@/lib/ko/match";
import { freshnessOf, getAllKnowledgeObjects, getKnowledgeObject } from "@/lib/ko/store";
import {
  AGENT_INPUT_LIMITS,
  isToolName,
  type ToolName,
} from "@/lib/mcp/contract";
import { logQuery, logReport, newLookupId } from "@/lib/query-log";
import { absoluteUrl } from "@/lib/site";
import {
  xpForgetMe,
  xpRecall,
  xpRegister,
  xpReport,
  xpRetract,
  xpRotateSecret,
} from "@/lib/xp/service";

export { INSTRUCTIONS, TOOLS, type ToolDefinition } from "@/lib/mcp/contract";

/**
 * The library's workflow actions, and what they return.
 *
 * A thin wrapper over the same functions /search.json, /diagnose.json and
 * /outcome.json call — deliberately, so the two surfaces cannot drift into
 * disagreeing about what the corpus says.
 *
 * Lookup and diagnosis stay concise prose because a model reads "3 of 5 causes
 * ruled out" better than a nested dump. Structured completion returns JSON because
 * its receipt and nextAction are a machine contract.
 */

export type ToolOutcome = { text: string; isError?: boolean };

function lookup(args: Record<string, unknown>, userAgent: string): ToolOutcome {
  const error =
    typeof args.error === "string"
      ? args.error.slice(0, AGENT_INPUT_LIMITS.queryCharacters)
      : "";
  if (!error.trim()) return { text: "The 'error' argument is required.", isError: true };

  if (isPlaceholderQuery(error)) {
    return {
      text: `'${error.trim()}' is a placeholder, not an error. Pass the actual error text.`,
      isError: true,
    };
  }

  const limit = Math.min(
    AGENT_INPUT_LIMITS.lookupResults.mcp.maximum,
    Math.max(
      1,
      Number(args.limit) || AGENT_INPUT_LIMITS.lookupResults.mcp.default,
    ),
  );
  const all = getAllKnowledgeObjects();
  const report = matchKnowledgeObjects(all, error);
  const results = presentableMatchResults(report, limit);
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
      : "No entry clearly covers this. These are related leads, not answers; do not diagnose or apply them without an independent match.",
  );

  for (const { ko, score } of results) {
    const fresh = freshnessOf(ko);
    lines.push("");
    lines.push(`## ${ko.title}`);
    lines.push(`slug: ${ko.slug}   fit: ${score.toFixed(2)}   url: ${absoluteUrl(`/k/${ko.slug}`)}`);
    lines.push(
      `match score: ${score.toFixed(2)} (ranking, not probability)   evidence confidence: ${ko.confidence} (${ko.evidence.length} sources)`,
    );
    lines.push(`verified: ${fresh.verifiedAt} (${fresh.status})`);
    lines.push(ko.summary);
    lines.push(`applies to: ${ko.appliesTo.technology.map((t) => `${t.name} ${t.versions}`).join("; ")}`);

    if (report.verdict === "strong") {
      lines.push("");
      lines.push("possible causes — run these checks, then call knowbase_diagnose:");
      for (const cause of ko.rootCauses) {
        lines.push(`  [${cause.weight}] ${cause.cause}`);
        lines.push(`      check: ${cause.discriminator}`);
      }
    } else {
      lines.push("");
      lines.push("RELATED LEAD ONLY — do not call knowbase_diagnose from this result.");
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
  const observations =
    typeof args.observations === "string"
      ? args.observations.slice(0, AGENT_INPUT_LIMITS.observationsCharacters)
      : "";

  if (!slug) return { text: "The 'slug' argument is required.", isError: true };
  if (!observations.trim()) {
    return { text: "The 'observations' argument is required.", isError: true };
  }

  const ko = getKnowledgeObject(slug);
  if (!ko) return { text: `No entry with id '${slug}'.`, isError: true };

  const result = diagnose(ko, observations);
  const linkedLookupId =
    typeof args.lookupId === "string"
      ? args.lookupId.slice(0, AGENT_INPUT_LIMITS.lookupIdCharacters)
      : "";

  logReport(
    {
      kind: "diagnosis",
      lookupId: linkedLookupId,
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
    lines.push(`koRevision: ${ko.freshness.updated}`);
    lines.push(`causeId: ${c.id ?? "unavailable"}`);
    lines.push(`resolutionId: ${c.resolution?.id ?? "unavailable"}`);
    lines.push(`stepIds: ${JSON.stringify(c.resolution?.stepIds ?? [])}`);
    lines.push("criteria:");
    if (c.resolution) {
      for (const criterion of c.resolution.verificationCriteria) {
        lines.push(`  - id: ${criterion.id}`);
        lines.push(`    required: ${criterion.required}`);
        lines.push(`    check: ${criterion.check}`);
        lines.push(`    expected: ${criterion.expected}`);
        if (criterion.command) lines.push(`    command: ${criterion.command}`);
      }
    } else {
      lines.push("  []");
    }
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

  const identifiedCause = result.identified?.cause;
  const resolution = identifiedCause?.resolution;
  const stepsToShow = resolution
    ? resolution.stepIds
        .map((id) => ko.solution.steps.find((step) => step.id === id))
        .filter((step): step is NonNullable<typeof step> => Boolean(step))
    : ko.solution.steps;

  lines.push("", resolution ? "## Cause-specific fix" : "## Fix", "");
  stepsToShow.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.instruction}`);
    if (step.command) lines.push(`   $ ${step.command.split("\n").join("\n   ")}`);
    if (step.code) lines.push(`   ${step.code.split("\n").join("\n   ")}`);
    if (step.note) lines.push(`   note: ${step.note}`);
  });

  if (!resolution) lines.push("", `verify: ${ko.solution.verification}`);
  const fallback = resolution?.fallback ?? (!resolution ? ko.solution.fallback : undefined);
  if (fallback) lines.push(`if that fails: ${fallback}`);

  if (identifiedCause?.id && resolution) {
    lines.push("", "## Complete resolution", "");
    lines.push(
      "After applying every listed step, run every verification criterion and call knowbase_complete_resolution with this shape:",
    );
    lines.push(
      JSON.stringify(
        {
          lookupId: linkedLookupId || "<16-character lookupId from the strong lookup>",
          slug: ko.slug,
          koRevision: ko.freshness.updated,
          causeId: identifiedCause.id,
          resolutionId: resolution.id,
          appliedStepIds: resolution.stepIds,
          criteria: resolution.verificationCriteria.map((criterion) => ({
            id: criterion.id,
            status: "<met|not_met|unknown|not_run>",
            observation: "<what the check showed>",
          })),
        },
        null,
        2,
      ),
    );
    lines.push(
      "Only claim the task resolved when the response status is 'resolved'; otherwise follow nextAction and call it again.",
    );
  } else if (result.identified) {
    lines.push("", "Structured completion is unavailable for this cause.");
    lines.push(
      "Record what you did and whether it worked with knowbase_report, so the next agent to hit this failure sees it.",
    );
  }

  lines.push("", `source: ${absoluteUrl(`/k/${ko.slug}`)} (CC-BY-SA-4.0)`);

  return { text: lines.join("\n") };
}

function completeResolutionTool(
  args: Record<string, unknown>,
  userAgent: string,
): ToolOutcome {
  const result = completeResolution(args, userAgent);
  return {
    text: JSON.stringify(result.body, null, 2),
    ...(result.ok ? {} : { isError: true }),
  };
}

type ToolHandler = (
  args: Record<string, unknown>,
  userAgent: string,
) => ToolOutcome | Promise<ToolOutcome>;

const TOOL_HANDLERS = {
  knowbase_recall: storeTool(xpRecall),
  knowbase_report: storeTool(xpReport),
  knowbase_retract: storeTool(xpRetract),
  knowbase_forget_me: storeTool(xpForgetMe),
  knowbase_rotate_secret: storeTool(xpRotateSecret),
  knowbase_register: storeTool(xpRegister),
  knowbase_lookup: lookup,
  knowbase_diagnose: runDiagnosis,
  knowbase_complete_resolution: completeResolutionTool,
} satisfies Record<ToolName, ToolHandler>;

/** Store services return {ok, body}; on the tool wire that is text + isError. */
function storeTool(
  fn: (args: Record<string, unknown>) => Promise<{ ok: boolean; body: Record<string, unknown> }>,
): ToolHandler {
  return async (args) => {
    const result = await fn(args);
    return { text: JSON.stringify(result.body, null, 2), ...(result.ok ? {} : { isError: true }) };
  };
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  userAgent: string,
): Promise<ToolOutcome> {
  if (!isToolName(name)) return { text: `Unknown tool: ${name}`, isError: true };
  return await TOOL_HANDLERS[name](args, userAgent);
}
