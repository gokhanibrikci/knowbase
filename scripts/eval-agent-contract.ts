/**
 * Runtime acceptance gate for the public agent contract.
 *
 * Retrieval scoring has its own golden set. This file pins the boundary around it:
 * HTML's machine twin, MCP's modern/legacy wire shapes, and the rule that only a
 * strong match may advance to diagnosis. It calls route handlers directly, so the
 * checks stay fast and need neither a dev server nor network access.
 */
import assert from "node:assert/strict";

import { POST as mcpPost, GET as mcpGet } from "../app/mcp/route";
import { GET as searchGet } from "../app/search.json/route";
import { matchKnowledgeObjects, presentableMatchResults } from "../lib/ko/match";
import { getAllKnowledgeObjects } from "../lib/ko/store";
import {
  AGENT_INPUT_LIMITS,
  MCP_CACHE_HINT,
  MCP_META_KEYS,
  MCP_PROTOCOL,
  MCP_SERVER_INFO,
  MCP_SUPPORTED_VERSIONS,
  TOOLS,
} from "../lib/mcp/contract";

type JsonObject = Record<string, unknown>;

const MODERN_META = {
  [MCP_META_KEYS.protocolVersion]: MCP_PROTOCOL.modernVersion,
  [MCP_META_KEYS.clientCapabilities]: {},
};

function modernRequest(
  method: string,
  params: JsonObject = {},
  options: { name?: string; meta?: JsonObject; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "mcp-protocol-version": MCP_PROTOCOL.modernVersion,
    "mcp-method": method,
    ...options.headers,
  });
  if (options.name) headers.set("mcp-name", options.name);

  return new Request("https://knowbase.sh/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: options.meta ?? MODERN_META },
    }),
  });
}

function legacyRequest(method: string, params: JsonObject = {}): Request {
  return new Request("https://knowbase.sh/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function body(response: Response): Promise<JsonObject> {
  return (await response.json()) as JsonObject;
}

async function search(query: string): Promise<JsonObject> {
  const request = new Request(`https://knowbase.sh/search.json?q=${encodeURIComponent(query)}`);
  const response = await searchGet(request);
  assert.equal(response.status, 200);
  return body(response);
}

function resultOf(payload: JsonObject): JsonObject {
  assert.ok(payload.result && typeof payload.result === "object");
  return payload.result as JsonObject;
}

async function main() {
  const strong = await search("deadlock detected");
  assert.equal(strong.match, "strong");
  assert.ok(Array.isArray(strong.results) && strong.results.length === 1);
  assert.ok(strong.nextStep && typeof strong.nextStep === "object");
  const strongResult = (strong.results as JsonObject[])[0];
  assert.equal(strongResult.matchScore, strongResult.score);
  assert.equal(strongResult.evidenceConfidence, strongResult.confidence);
  assert.equal(strongResult.evidenceSourceCount, strongResult.sources);

  const partial = await search("429 Too Many Requests");
  assert.equal(partial.match, "partial");
  assert.ok(Array.isArray(partial.results) && partial.results.length > 0);
  assert.equal(partial.nextStep, null);
  const partialReport = matchKnowledgeObjects(
    getAllKnowledgeObjects(),
    "429 Too Many Requests",
  );
  const allPresentablePartial = presentableMatchResults(partialReport);
  const expectedPartial = presentableMatchResults(
    partialReport,
    AGENT_INPUT_LIMITS.lookupResults.http.default,
  );
  assert.deepEqual(
    (partial.results as JsonObject[]).map((result) => result.id),
    expectedPartial.map((result) => result.ko.slug),
  );
  assert.equal(partial.totalMatches, allPresentablePartial.length);
  for (const result of allPresentablePartial) {
    assert.ok(
      result.exactIdentityMatch ||
        result.identityAnchors.length >= 2 ||
        result.disclaimedTerms.length > 0 ||
        Boolean(result.disclaimedBy),
      `partial result lacks a semantic anchor: ${result.ko.slug}`,
    );
  }

  const none = await search("terraform state lock could not be acquired");
  assert.equal(none.match, "none");
  assert.deepEqual(none.results, []);
  assert.equal(none.totalMatches, 0);
  assert.equal(none.nextStep, null);

  // clientInfo is optional in 2026-07-28; clientCapabilities is not.
  const discoverResponse = await mcpPost(modernRequest("server/discover"));
  assert.equal(discoverResponse.status, 200);
  const discover = resultOf(await body(discoverResponse));
  assert.equal(discover.resultType, "complete");
  assert.deepEqual(discover.supportedVersions, [...MCP_SUPPORTED_VERSIONS]);
  assert.equal(discover.ttlMs, MCP_CACHE_HINT.ttlMs);
  assert.equal(discover.cacheScope, MCP_CACHE_HINT.cacheScope);

  const listResponse = await mcpPost(modernRequest("tools/list"));
  const list = resultOf(await body(listResponse));
  assert.equal(list.resultType, "complete");
  assert.equal(list.ttlMs, MCP_CACHE_HINT.ttlMs);
  assert.equal(list.cacheScope, MCP_CACHE_HINT.cacheScope);
  assert.deepEqual(
    ((list._meta as JsonObject)[MCP_META_KEYS.serverInfo] as JsonObject),
    MCP_SERVER_INFO,
  );
  assert.deepEqual(
    (list.tools as JsonObject[]).map((tool) => tool.name),
    TOOLS.map((tool) => tool.name),
  );

  const callResponse = await mcpPost(
    modernRequest(
      "tools/call",
      { name: "knowbase_lookup", arguments: { error: "terraform state lock could not be acquired" } },
      { name: "knowbase_lookup" },
    ),
  );
  const call = resultOf(await body(callResponse));
  assert.equal(call.resultType, "complete");
  assert.ok(Array.isArray(call.content));
  assert.match(((call.content as JsonObject[])[0].text as string), /No entry in knowbase covers/);

  const strongCallResponse = await mcpPost(
    modernRequest(
      "tools/call",
      { name: "knowbase_lookup", arguments: { error: "deadlock detected", limit: 10 } },
      { name: "knowbase_lookup" },
    ),
  );
  const strongCall = resultOf(await body(strongCallResponse));
  const strongText = (strongCall.content as JsonObject[])[0].text as string;
  assert.equal(strongText.match(/^## /gm)?.length ?? 0, 1);

  const legacyResponse = await mcpPost(
    legacyRequest("initialize", {
      protocolVersion: MCP_PROTOCOL.legacyVersions[1],
      capabilities: {},
      clientInfo: { name: "contract-eval", version: "1.0.0" },
    }),
  );
  const legacy = resultOf(await body(legacyResponse));
  assert.equal(legacy.protocolVersion, MCP_PROTOCOL.legacyVersions[1]);
  assert.equal("resultType" in legacy, false);
  assert.equal("ttlMs" in legacy, false);

  const unsupportedResponse = await mcpPost(
    modernRequest("tools/list", {}, {
      meta: {
        [MCP_META_KEYS.protocolVersion]: MCP_PROTOCOL.legacyVersions[0],
        [MCP_META_KEYS.clientCapabilities]: {},
      },
    }),
  );
  assert.equal(unsupportedResponse.status, 400);
  const unsupported = await body(unsupportedResponse);
  assert.equal((unsupported.error as JsonObject).code, -32022);

  const missingCapabilitiesResponse = await mcpPost(
    modernRequest("tools/list", {}, {
      meta: { [MCP_META_KEYS.protocolVersion]: MCP_PROTOCOL.modernVersion },
    }),
  );
  assert.equal(missingCapabilitiesResponse.status, 400);
  const missingCapabilities = await body(missingCapabilitiesResponse);
  assert.equal((missingCapabilities.error as JsonObject).code, -32602);

  const mismatchResponse = await mcpPost(
    modernRequest("tools/list", {}, { headers: { "mcp-method": "tools/call" } }),
  );
  assert.equal(mismatchResponse.status, 400);
  const mismatch = await body(mismatchResponse);
  assert.equal((mismatch.error as JsonObject).code, -32020);

  const unknownResponse = await mcpPost(modernRequest("unknown/method"));
  assert.equal(unknownResponse.status, 404);
  const unknown = await body(unknownResponse);
  assert.equal((unknown.error as JsonObject).code, -32601);

  const getResponse = mcpGet(
    new Request("https://knowbase.sh/mcp", { headers: { accept: "application/json" } }),
  );
  assert.equal(getResponse.status, 405);

  console.log("agent contract: strong/partial/none surfaces and modern/legacy MCP wire passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
