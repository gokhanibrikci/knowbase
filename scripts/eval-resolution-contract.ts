/** Acceptance gate for the diagnose -> complete value exchange. */
import assert from "node:assert/strict";

import { POST as diagnosePost } from "../app/diagnose.json/route";
import { POST as mcpPost } from "../app/mcp/route";
import { POST as outcomePost } from "../app/outcome.json/route";
import { GET as searchGet } from "../app/search.json/route";
import { completeResolution } from "../lib/ko/complete-resolution";
import { getKnowledgeObject } from "../lib/ko/store";
import {
  INSTRUCTIONS,
  MCP_META_KEYS,
  MCP_PROTOCOL,
  TOOLS,
} from "../lib/mcp/contract";

type JsonObject = Record<string, unknown>;

const slug = "kubernetes-imagepullbackoff";
const secret = "authorization=sk_test_this_must_not_be_echoed";

function modernToolRequest(name: string, args: JsonObject): Request {
  return new Request("https://knowbase.sh/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL.modernVersion,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          [MCP_META_KEYS.protocolVersion]: MCP_PROTOCOL.modernVersion,
          [MCP_META_KEYS.clientCapabilities]: {},
        },
      },
    }),
  });
}

async function json(response: Response): Promise<JsonObject> {
  return (await response.json()) as JsonObject;
}

async function postOutcome(input: JsonObject): Promise<{ response: Response; body: JsonObject }> {
  const response = await outcomePost(
    new Request("https://knowbase.sh/outcome.json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return { response, body: await json(response) };
}

function receiptId(body: JsonObject): string {
  const receipt = body.resolutionReceipt as JsonObject;
  assert.ok(receipt);
  assert.equal(typeof receipt.id, "string");
  return receipt.id as string;
}

async function main() {
  const ko = getKnowledgeObject(slug);
  assert.ok(ko, "pilot KO must exist in generated content");
  const confidenceBefore = ko.confidence;

  const lookupResponse = await searchGet(
    new Request(
      "https://knowbase.sh/search.json?q=Kubernetes+ImagePullBackOff+401+Unauthorized+pull+access+denied",
    ),
  );
  const lookup = await json(lookupResponse);
  assert.equal(lookup.match, "strong");
  const lookupId = lookup.lookupId;
  assert.equal(typeof lookupId, "string");

  const diagnosisResponse = await diagnosePost(
    new Request("https://knowbase.sh/diagnose.json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lookupId,
        slug,
        observations: "Events show 401 Unauthorized, authentication required and pull access denied",
      }),
    }),
  );
  const diagnosis = await json(diagnosisResponse);
  assert.equal((diagnosis.identified as JsonObject).causeId, "private-registry-credentials");
  const identifiedResolution = diagnosis.identifiedResolution as JsonObject;
  assert.equal(identifiedResolution.resolutionId, "configure-image-pull-secret-v1");
  assert.ok(diagnosis.completeResolution, "diagnosis must return the completion call it unlocks");

  const input = {
    lookupId: lookupId as string,
    slug,
    koRevision: ko.freshness.updated,
    causeId: "private-registry-credentials",
    resolutionId: "configure-image-pull-secret-v1",
    appliedStepIds: [
      "inspect-events",
      "create-pull-secret",
      "attach-pull-secret",
      "restart-workload",
    ],
    criteria: [
      {
        id: "image-pulled",
        status: "met",
        observation: `Successfully pulled image; ${secret}`,
        exitCode: 0,
      },
      { id: "pod-running", status: "met", observation: "Pod phase is Running" },
      { id: "restarts-stable", status: "met", observation: "RESTARTS stayed at 0" },
    ],
  } satisfies JsonObject;

  // All required checks met -> an agent-observed receipt, never an independent claim.
  const resolved = await postOutcome(input);
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.status, "resolved");
  assert.equal(resolved.body.verificationLevel, "agent_observed");
  assert.equal(resolved.body.nextAction, null);
  assert.equal(resolved.body.attemptReport, null);
  assert.ok(resolved.body.resolutionReceipt);
  assert.equal((resolved.body.resolutionReceipt as JsonObject).status, "resolved");
  assert.equal((resolved.body.resolutionReceipt as JsonObject).persistence, "caller_held");
  assert.match(receiptId(resolved.body), /^rr_[a-f0-9]{24}$/);
  const resolvedText = JSON.stringify(resolved.body);
  assert.ok(!resolvedText.includes(secret), "raw observations and secrets must not be echoed");
  assert.match(resolvedText, /sha256:[a-f0-9]{64}/);

  // Retries are one logical outcome: time may differ, identity does not.
  const repeated = await postOutcome(input);
  assert.equal(receiptId(repeated.body), receiptId(resolved.body));

  // A failed required criterion keeps the incident open and returns the next move.
  const failed = completeResolution({
    ...input,
    criteria: input.criteria.map((criterion) =>
      criterion.id === "pod-running"
        ? { ...criterion, status: "not_met", observation: "Pod remains Pending" }
        : criterion,
    ),
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.body.status, "unresolved");
  assert.equal(failed.body.resolutionReceipt, null);
  assert.ok(failed.body.attemptReport);
  assert.equal((failed.body.nextAction as JsonObject).type, "re_diagnose");
  assert.doesNotMatch(String(failed.body.finalReport), /^Resolved:/m);

  // Unknown or omitted required checks are explicitly inconclusive.
  const unknown = completeResolution({
    ...input,
    criteria: input.criteria.map((criterion) =>
      criterion.id === "restarts-stable"
        ? { ...criterion, status: "unknown", observation: "Window not long enough" }
        : criterion,
    ),
  });
  assert.equal(unknown.body.status, "verification_inconclusive");
  assert.equal((unknown.body.nextAction as JsonObject).type, "run_verification");
  assert.doesNotMatch(String(unknown.body.finalReport), /^Resolved:/m);

  const missing = completeResolution({ ...input, criteria: input.criteria.slice(0, 2) });
  assert.equal(missing.body.status, "verification_inconclusive");
  assert.equal(missing.body.resolutionReceipt, null);

  // Invented ids, stale recipes and incomplete step chains cannot mint a receipt.
  const invented = completeResolution({
    ...input,
    criteria: [...input.criteria, { id: "made-up", status: "met" }],
  });
  assert.equal(invented.httpStatus, 400);
  assert.equal(invented.ok, false);

  const stale = completeResolution({ ...input, koRevision: "2000-01-01" });
  assert.equal(stale.httpStatus, 409);
  assert.equal(stale.body.status, "revision_conflict");

  const skippedStep = completeResolution({
    ...input,
    appliedStepIds: input.appliedStepIds.slice(1),
  });
  assert.equal(skippedStep.httpStatus, 400);

  // HTTP and MCP are adapters over the same domain result.
  const mcpResponse = await mcpPost(modernToolRequest("knowbase_complete_resolution", input));
  assert.equal(mcpResponse.status, 200);
  const envelope = await json(mcpResponse);
  const result = envelope.result as JsonObject;
  const content = result.content as JsonObject[];
  assert.ok(content?.[0]);
  const mcpBody = JSON.parse(String(content[0].text)) as JsonObject;
  assert.equal(mcpBody.status, resolved.body.status);
  assert.equal(receiptId(mcpBody), receiptId(resolved.body));
  assert.deepEqual(mcpBody.nextAction, resolved.body.nextAction);

  const completeTool = TOOLS.find((tool) => tool.name === "knowbase_complete_resolution");
  assert.ok(completeTool);
  assert.doesNotMatch(completeTool.description, /optional|report whether/i);
  assert.match(INSTRUCTIONS, /do not claim.*resolved/i);

  // No outcome path is allowed to mutate evidence confidence.
  assert.equal(getKnowledgeObject(slug)?.confidence, confidenceBefore);

  console.log("resolution contract: resolved/unresolved/inconclusive and HTTP/MCP parity passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
