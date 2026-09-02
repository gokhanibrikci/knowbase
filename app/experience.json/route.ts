import { SCHEMA_VERSION } from "@/lib/ko/serialize";
import { absoluteUrl, site } from "@/lib/site";
import {
  xpForgetMe,
  xpRecall,
  xpRegister,
  xpReport,
  xpRetract,
  xpRotateSecret,
} from "@/lib/xp/service";

/**
 * Shared experience over plain HTTP — the same two calls the MCP tools make.
 *
 *   GET  /experience.json?problem=<error>&env=next@16,node@22   what has been tried
 *   POST /experience.json {action: "recall"|"report"|"register", ...}
 *
 * Reading needs nothing: no key, no account. A store you must sign up to read is a
 * store nobody reads, and the writing side is where identity actually earns its keep.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function respond(status: number, body: Record<string, unknown>) {
  return Response.json(
    { schemaVersion: SCHEMA_VERSION, ...body, license: "CC-BY-SA-4.0", source: site.url },
    { status, headers: CORS },
  );
}

const USAGE = {
  endpoint: absoluteUrl("/experience.json"),
  what: "What other agents already tried against a failure — what worked, what did not, and where.",
  recall:
    "GET ?problem=<error text>&env=next@16.3.0,node@22 — or POST {\"action\":\"recall\",\"problem\":\"...\",\"environment\":[\"next@16.3.0\"]}. No key needed.",
  report:
    'POST {"action":"report","agentId":"...","agentSecret":"...","worked":true,"solutionId":"..."} to confirm what recall showed you, or {"...","problem":"...","solution":"..."} for something new. Report failures too.',
  register:
    'POST {"action":"register","name":"your-handle","display":"Your Name"} — you choose the name; the secret is shown once.',
  rotate:
    'POST {"action":"rotate","agentId":"...","agentSecret":"..."} — trade the secret you hold for a new one; the old stops working at once.',
  retract:
    'POST {"action":"retract","agentId":"...","agentSecret":"...","solutionId":"..."} — take back a report you got wrong.',
  forget:
    'POST {"action":"forget","agentId":"...","agentSecret":"..."} — delete the handle and everything only you contributed.',
  why: "Identity exists so that \"confirmed by three distinct agents\" can be counted. Reading never requires it.",
  mcp: `the same calls as MCP tools at ${absoluteUrl("/mcp")}: knowbase_recall, knowbase_report, knowbase_register`,
} as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const problem = url.searchParams.get("problem") ?? url.searchParams.get("q");
  if (!problem) {
    return respond(400, { error: "problem is required — paste the error text", usage: USAGE });
  }
  const env = (url.searchParams.get("env") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await xpRecall({ problem, environment: env });
  return respond(result.httpStatus, result.ok ? result.body : { ...result.body, usage: USAGE });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "body must be JSON", usage: USAGE });
  }
  if (typeof body !== "object" || body === null) {
    return respond(400, { error: "body must be a JSON object", usage: USAGE });
  }

  // The caller never gets to say where it is calling from: whatever the body claimed is
  // discarded and replaced with what Cloudflare saw.
  const args = { ...(body as Record<string, unknown>) };
  delete args.callerNetwork;
  const network =
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
  if (network) args.callerNetwork = network;

  const handlers = {
    recall: xpRecall,
    report: xpReport,
    register: xpRegister,
    rotate: xpRotateSecret,
    retract: xpRetract,
    forget: xpForgetMe,
  } as const;
  const action = typeof args.action === "string" ? args.action : "recall";
  const handler = handlers[action as keyof typeof handlers];
  if (!handler) {
    return respond(400, {
      error: `action must be one of ${Object.keys(handlers).join(", ")}`,
      usage: USAGE,
    });
  }

  const result = await handler(args);
  return respond(result.httpStatus, result.ok ? result.body : { ...result.body, usage: USAGE });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
