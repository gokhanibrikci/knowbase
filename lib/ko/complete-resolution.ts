import { createHash } from "node:crypto";

import { getKnowledgeObject } from "@/lib/ko/store";
import { AGENT_INPUT_LIMITS } from "@/lib/mcp/contract";
import { logReport } from "@/lib/query-log";
import { absoluteUrl } from "@/lib/site";

/**
 * The value exchange at the end of a resolution.
 *
 * The caller is not asked to file feedback for knowbase's benefit. It submits the
 * checks it already had to run, and gets either a paste-ready incident summary plus
 * a deterministic receipt, or the failed/missing check and a concrete next action.
 *
 * Trust boundary: knowbase validates the current KO revision, recipe ids and report
 * completeness. It cannot inspect the caller's environment or prove ownership of a
 * lookup id. A resolved receipt is therefore `agent_observed`, never independently
 * or "knowbase" verified.
 */

export const CRITERION_STATUSES = ["met", "not_met", "unknown", "not_run"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export type CompleteResolutionResult = {
  ok: boolean;
  httpStatus: number;
  body: Record<string, unknown>;
  /** Existing MCP copy for the deprecated outcome tool. */
  toolText?: string;
};

type SubmittedCriterion = {
  id: string;
  status: CriterionStatus;
  observation: string;
  exitCode?: number;
};

const STATUS_SET = new Set<string>(CRITERION_STATUSES);
const LOOKUP_ID = /^[a-f0-9]{16}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function failure(
  httpStatus: number,
  status: string,
  error: string,
  extra: Record<string, unknown> = {},
): CompleteResolutionResult {
  return { ok: false, httpStatus, body: { status, error, ...extra } };
}

function legacyOutcome(
  input: Record<string, unknown>,
  userAgent: string,
): CompleteResolutionResult {
  const slug = typeof input.slug === "string" ? input.slug : "";
  if (!slug) {
    return {
      ...failure(400, "invalid_request", "missing required field: slug"),
      toolText: "The 'slug' argument is required.",
    };
  }
  if (typeof input.worked !== "boolean") {
    return {
      ...failure(400, "invalid_request", "field 'worked' must be a boolean"),
      toolText: "The 'worked' argument must be a boolean.",
    };
  }

  const ko = getKnowledgeObject(slug);
  if (!ko) {
    return {
      ...failure(404, "not_found", `no entry with id: ${slug}`),
      toolText: `No entry with id '${slug}'.`,
    };
  }

  const lookupId =
    typeof input.lookupId === "string"
      ? input.lookupId.slice(0, AGENT_INPUT_LIMITS.lookupIdCharacters)
      : "";
  const note =
    typeof input.note === "string"
      ? input.note.slice(0, AGENT_INPUT_LIMITS.noteCharacters)
      : "";

  const telemetryAccepted = logReport(
    { kind: "outcome", lookupId, slug: ko.slug, worked: input.worked, note },
    userAgent,
  );

  const toolText = input.worked
    ? `Recorded for ${ko.slug}. This does not raise the entry's confidence — that is gated on evidence, not on use.`
    : `Recorded for ${ko.slug}, and queued for re-verification against its sources.`;

  return {
    ok: true,
    httpStatus: 200,
    toolText,
    body: {
      status: "recorded",
      verificationLevel: "claimed",
      recorded: true,
      telemetryAccepted,
      id: ko.slug,
      effect: input.worked
        ? "Recorded. This does not raise the entry's confidence — that is gated on evidence, not on use."
        : "Recorded, and queued for re-verification against its sources.",
      resolutionReceipt: null,
      nextAction: null,
    },
  };
}

function parseSubmittedCriteria(
  raw: unknown[],
): { criteria: SubmittedCriterion[] } | { error: string } {
  if (raw.length > AGENT_INPUT_LIMITS.completionCriteriaMaximum) {
    return {
      error: `criteria may contain at most ${AGENT_INPUT_LIMITS.completionCriteriaMaximum} items`,
    };
  }

  const criteria: SubmittedCriterion[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!isRecord(item)) return { error: "each criterion must be an object" };
    if (typeof item.id !== "string" || !item.id) {
      return { error: "each criterion requires a string id" };
    }
    if (seen.has(item.id)) return { error: `duplicate criterion id: ${item.id}` };
    seen.add(item.id);

    if (typeof item.status !== "string" || !STATUS_SET.has(item.status)) {
      return {
        error: `criterion '${item.id}' has invalid status; use ${CRITERION_STATUSES.join("| ")}`,
      };
    }

    if (item.observation !== undefined && typeof item.observation !== "string") {
      return { error: `criterion '${item.id}' observation must be a string` };
    }
    const observation =
      typeof item.observation === "string" ? item.observation.replace(/\r\n/g, "\n").trim() : "";
    if (observation.length > AGENT_INPUT_LIMITS.criterionObservationCharacters) {
      return {
        error: `criterion '${item.id}' observation exceeds ${AGENT_INPUT_LIMITS.criterionObservationCharacters} characters`,
      };
    }

    if (
      item.exitCode !== undefined &&
      (!Number.isInteger(item.exitCode) ||
        (item.exitCode as number) < -2_147_483_648 ||
        (item.exitCode as number) > 2_147_483_647)
    ) {
      return { error: `criterion '${item.id}' exitCode must be a 32-bit integer` };
    }

    if (
      (item.status === "met" || item.status === "not_met") &&
      !observation &&
      item.exitCode === undefined
    ) {
      return {
        error: `criterion '${item.id}' requires an observation or exitCode for status '${item.status}'`,
      };
    }

    criteria.push({
      id: item.id,
      status: item.status as CriterionStatus,
      observation,
      ...(item.exitCode !== undefined ? { exitCode: item.exitCode as number } : {}),
    });
  }

  return { criteria };
}

function structuredCompletion(
  input: Record<string, unknown>,
  userAgent: string,
  now: Date,
): CompleteResolutionResult {
  const slug = typeof input.slug === "string" ? input.slug : "";
  const lookupId = typeof input.lookupId === "string" ? input.lookupId : "";
  const koRevision = typeof input.koRevision === "string" ? input.koRevision : "";
  const causeId = typeof input.causeId === "string" ? input.causeId : "";
  const resolutionId = typeof input.resolutionId === "string" ? input.resolutionId : "";

  if (!slug) return failure(400, "invalid_request", "missing required field: slug");
  if (!LOOKUP_ID.test(lookupId)) {
    return failure(
      400,
      "invalid_request",
      "lookupId must be the 16-character id returned by a strong lookup",
    );
  }
  if (!koRevision) {
    return failure(400, "invalid_request", "missing required field: koRevision");
  }
  if (!causeId) return failure(400, "invalid_request", "missing required field: causeId");
  if (!resolutionId) {
    return failure(400, "invalid_request", "missing required field: resolutionId");
  }
  if (!Array.isArray(input.appliedStepIds)) {
    return failure(400, "invalid_request", "appliedStepIds must be an array");
  }
  if (!Array.isArray(input.criteria)) {
    return failure(400, "invalid_request", "criteria must be an array");
  }

  const ko = getKnowledgeObject(slug);
  if (!ko) return failure(404, "not_found", `no entry with id: ${slug}`);

  if (ko.freshness.updated !== koRevision) {
    return failure(409, "revision_conflict", "the entry changed after diagnosis", {
      expectedRevision: ko.freshness.updated,
      receivedRevision: koRevision,
      nextAction: {
        type: "re_diagnose",
        endpoint: absoluteUrl("/diagnose.json"),
        method: "POST",
        body: { lookupId, slug: ko.slug, observations: "<run the current discriminators>" },
      },
    });
  }

  const cause = ko.rootCauses.find((item) => item.id === causeId);
  if (!cause) return failure(400, "invalid_request", `unknown causeId: ${causeId}`);

  const resolution = cause.resolution;
  if (!resolution) {
    return failure(
      409,
      "verification_unavailable",
      "this cause has not yet been migrated to a structured resolution recipe",
      {
        nextAction: {
          type: "legacy_outcome",
          endpoint: absoluteUrl("/outcome.json"),
          method: "POST",
          body: { lookupId, slug: ko.slug, worked: "<true|false>" },
          note: "Legacy outcome recording cannot return a resolved receipt.",
        },
      },
    );
  }
  if (resolution.id !== resolutionId) {
    return failure(409, "resolution_conflict", "the requested cause resolution is not current", {
      expectedResolutionId: resolution.id,
      receivedResolutionId: resolutionId,
      nextAction: {
        type: "re_diagnose",
        endpoint: absoluteUrl("/diagnose.json"),
        method: "POST",
        body: { lookupId, slug: ko.slug, observations: "<run the current discriminators>" },
      },
    });
  }
  const definitions = resolution.verificationCriteria;

  const appliedStepIds = input.appliedStepIds;
  if (appliedStepIds.some((id) => typeof id !== "string" || !id)) {
    return failure(400, "invalid_request", "appliedStepIds must contain non-empty strings");
  }
  if (new Set(appliedStepIds).size !== appliedStepIds.length) {
    return failure(400, "invalid_request", "appliedStepIds must not contain duplicates");
  }
  if (appliedStepIds.length === 0) {
    return failure(400, "invalid_request", "at least one appliedStepId is required");
  }

  const stepById = new Map(ko.solution.steps.map((step) => [step.id, step]));
  for (const id of appliedStepIds as string[]) {
    if (!resolution.stepIds.includes(id)) {
      return failure(
        400,
        "invalid_request",
        `appliedStepId '${id}' is not part of resolution '${resolution.id}'`,
      );
    }
  }
  const missingStepIds = resolution.stepIds.filter(
    (id) => !(appliedStepIds as string[]).includes(id),
  );
  if (missingStepIds.length > 0) {
    return failure(
      400,
      "invalid_request",
      `required resolution steps were not reported as applied: ${missingStepIds.join(", ")}`,
    );
  }
  const orderedStepIds = [...resolution.stepIds];

  const parsed = parseSubmittedCriteria(input.criteria);
  if ("error" in parsed) return failure(400, "invalid_request", parsed.error);

  const definitionIds = new Set(definitions.map((criterion) => criterion.id));
  for (const criterion of parsed.criteria) {
    if (!definitionIds.has(criterion.id)) {
      return failure(400, "invalid_request", `unknown criterion id: ${criterion.id}`);
    }
  }

  const submittedById = new Map(parsed.criteria.map((criterion) => [criterion.id, criterion]));
  const criteria = definitions.map((definition) => {
    const submitted = submittedById.get(definition.id);
    return {
      id: definition.id,
      check: definition.check,
      expected: definition.expected,
      required: definition.required,
      status: submitted?.status ?? ("not_run" as const),
      ...(submitted?.exitCode !== undefined ? { exitCode: submitted.exitCode } : {}),
    };
  });

  const failedCriteria = criteria.filter((criterion) => criterion.status === "not_met");
  const inconclusiveCriteria = criteria.filter(
    (criterion) =>
      criterion.required &&
      (criterion.status === "unknown" || criterion.status === "not_run"),
  );
  const status =
    failedCriteria.length > 0
      ? "unresolved"
      : inconclusiveCriteria.length > 0
        ? "verification_inconclusive"
        : "resolved";

  const observationDigest = `sha256:${digest(
    definitions.map((definition) => {
      const submitted = submittedById.get(definition.id);
      return {
        id: definition.id,
        status: submitted?.status ?? "not_run",
        observation: submitted?.observation ?? "",
        exitCode: submitted?.exitCode ?? null,
      };
    }),
  )}`;
  const outcomeHash = digest({
    lookupId,
    slug: ko.slug,
    koRevision,
    causeId,
    resolutionId,
    appliedStepIds: orderedStepIds,
    criteria: criteria.map(({ id, status, exitCode }) => ({ id, status, exitCode: exitCode ?? null })),
    observationDigest,
  });
  const outcomeId = `${status === "resolved" ? "rr" : "ra"}_${outcomeHash.slice(0, 24)}`;
  const reportedAt = now.toISOString();
  const sourceUrl = absoluteUrl(`/k/${ko.slug}`);
  const commonReport = {
    id: outcomeId,
    verificationLevel: "agent_observed",
    lookupLink: "self_reported",
    persistence: "caller_held",
    attestation:
      "Knowbase validated the current recipe and required statuses; it did not inspect the environment or authenticate the lookup id.",
    lookupId,
    ko: {
      id: ko.slug,
      updatedAt: ko.freshness.updated,
      verifiedAt: ko.freshness.verifiedAt,
    },
    causeId,
    resolutionId,
    appliedStepIds: orderedStepIds,
    criteria,
    observationDigest,
    sourceUrl,
  };

  const nextAction =
    status === "resolved"
      ? null
      : status === "unresolved"
        ? resolution.fallback
          ? {
              type: "apply_fallback",
              instruction: resolution.fallback,
              then: "Run the required verification criteria again and repeat this completion call.",
            }
          : {
              type: "re_diagnose",
              endpoint: absoluteUrl("/diagnose.json"),
              method: "POST",
              body: { lookupId, slug: ko.slug, observations: "<new discriminator results>" },
            }
        : {
            type: "run_verification",
            criteria: inconclusiveCriteria.map(({ id, check, expected }) => ({
              id,
              check,
              expected,
            })),
            then: "Repeat this completion call with a met or not_met status for each required criterion.",
          };

  const metRequired = criteria.filter(
    (criterion) => criterion.required && criterion.status === "met",
  ).length;
  const requiredCount = criteria.filter((criterion) => criterion.required).length;
  const appliedSteps = orderedStepIds.map((id) => stepById.get(id)!.instruction);
  const finalReport =
    status === "resolved"
      ? [
          `Resolved: ${ko.title}`,
          `Cause: ${cause.cause} (${causeId})`,
          `Resolution: ${resolutionId}`,
          `Applied steps: ${appliedSteps.join("; ")}`,
          `Verification: the calling agent reported ${metRequired}/${requiredCount} required criteria met.`,
          `Evidence level: agent_observed; Knowbase did not independently inspect the environment.`,
          `Receipt: ${outcomeId}`,
          `Source: ${sourceUrl}`,
        ].join("\n")
      : status === "unresolved"
        ? [
            `Attempt remains unresolved: ${ko.title}`,
            `Cause used: ${cause.cause} (${causeId})`,
            `Resolution used: ${resolutionId}`,
            `Failed criteria: ${failedCriteria.map((criterion) => criterion.id).join(", ")}`,
            `Attempt report: ${outcomeId}`,
            `Source: ${sourceUrl}`,
          ].join("\n")
        : [
            `Verification is inconclusive for: ${ko.title}`,
            `Cause used: ${cause.cause} (${causeId})`,
            `Resolution used: ${resolutionId}`,
            `Still required: ${inconclusiveCriteria.map((criterion) => criterion.id).join(", ")}`,
            `Attempt report: ${outcomeId}`,
            `Source: ${sourceUrl}`,
          ].join("\n");

  const telemetryAccepted = logReport(
    {
      kind: "completion",
      lookupId,
      slug: ko.slug,
      causeId,
      resolutionId,
      outcomeId,
      status,
      koRevision,
      criteriaMet: metRequired,
      criteriaTotal: requiredCount,
    },
    userAgent,
  );

  return {
    ok: true,
    httpStatus: 200,
    body: {
      status,
      verificationLevel: "agent_observed",
      finalReport,
      failedCriteria,
      nextAction,
      resolutionReceipt:
        status === "resolved"
          ? { ...commonReport, status: "resolved", completedAt: reportedAt }
          : null,
      attemptReport:
        status === "resolved"
          ? null
          : { ...commonReport, status, reportedAt },
      telemetryAccepted,
    },
  };
}

export function completeResolution(
  rawInput: unknown,
  userAgent = "",
  now = new Date(),
): CompleteResolutionResult {
  if (!isRecord(rawInput)) return failure(400, "invalid_request", "body must be an object");

  const hasWorked = Object.prototype.hasOwnProperty.call(rawInput, "worked");
  const hasCriteria = Object.prototype.hasOwnProperty.call(rawInput, "criteria");
  if (hasWorked && hasCriteria) {
    return failure(
      400,
      "invalid_request",
      "send structured criteria or legacy worked, not both",
    );
  }

  return hasWorked
    ? legacyOutcome(rawInput, userAgent)
    : structuredCompletion(rawInput, userAgent, now);
}
