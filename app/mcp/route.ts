import {
  INSTRUCTIONS,
  MCP_CACHE_HINT,
  MCP_META_KEYS,
  MCP_PROTOCOL,
  MCP_SERVER_CAPABILITIES,
  MCP_SERVER_INFO,
  MCP_SUPPORTED_VERSIONS,
  TOOLS,
  isToolName,
} from "@/lib/mcp/contract";
import { callTool } from "@/lib/mcp/tools";
import { site } from "@/lib/site";

/**
 * MCP over Streamable HTTP, speaking both eras of the protocol.
 *
 * Revision 2026-07-28 removed the `initialize` handshake and protocol-level
 * sessions: a modern client carries its version, identity and capabilities in
 * `_meta` on every request, so the server is stateless. Most clients in the field
 * still open with `initialize`. Supporting only the modern shape would mean nothing
 * connects today; supporting only the legacy shape would mean building on something
 * already superseded. The specification blesses doing both on one endpoint, and a
 * dual-era server picks its behaviour from how the client opens.
 *
 * Everything here is a thin wrapper over lib/mcp/tools.ts, which is the same code
 * path /search.json and /diagnose.json take. The two surfaces cannot drift into
 * disagreeing about what the corpus says, because there is only one of them.
 */

/** JSON-RPC and MCP-allocated error codes used below. */
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers":
    "content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
  "cache-control": "no-store",
} as const;

type JsonRpcId = string | number | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ok(id: JsonRpcId, result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, result }, { status, headers: CORS });
}

function fail(id: JsonRpcId, code: number, message: string, data?: unknown, status = 200) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } },
    { status, headers: CORS },
  );
}

/** 2026-07-28 discriminates every successful result on the wire. */
function modernOk(id: JsonRpcId, result: Record<string, unknown>, status = 200) {
  const resultMeta = isRecord(result._meta) ? result._meta : {};
  return ok(
    id,
    {
      resultType: "complete",
      ...result,
      _meta: { ...resultMeta, [MCP_META_KEYS.serverInfo]: MCP_SERVER_INFO },
    },
    status,
  );
}

/**
 * Header values that cannot be expressed in ASCII arrive Base64-wrapped in a
 * sentinel. Decoding before comparison is required — otherwise a tool name with a
 * non-ASCII character would look like a mismatch and be rejected.
 */
function decodeHeaderValue(raw: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(raw);
  if (!match) return raw;
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)),
    );
  } catch {
    return raw;
  }
}

function toolResult(name: string, args: Record<string, unknown>, userAgent: string) {
  const outcome = callTool(name, args, userAgent);
  return {
    content: [{ type: "text", text: outcome.text }],
    ...(outcome.isError ? { isError: true } : {}),
  };
}

const TOOL_LIST = {
  tools: TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
};

export async function POST(request: Request) {
  let message: {
    jsonrpc?: string;
    id?: JsonRpcId;
    method?: string;
    params?: Record<string, unknown>;
  };

  try {
    message = await request.json();
  } catch {
    return fail(null, -32700, "Parse error: body must be JSON", undefined, 400);
  }

  const id = message.id ?? null;
  const method = message.method ?? "";
  const params = (message.params ?? {}) as Record<string, unknown>;
  const meta = isRecord(params._meta) ? params._meta : {};
  const userAgent = request.headers.get("user-agent") ?? "";

  const hasBodyVersion = Object.prototype.hasOwnProperty.call(
    meta,
    MCP_META_KEYS.protocolVersion,
  );
  const rawBodyVersion = meta[MCP_META_KEYS.protocolVersion];

  if (hasBodyVersion && typeof rawBodyVersion !== "string") {
    return fail(
      id,
      INVALID_PARAMS,
      `${MCP_META_KEYS.protocolVersion} must be a string`,
      undefined,
      400,
    );
  }

  const bodyVersion = typeof rawBodyVersion === "string" ? rawBodyVersion : "";

  // Per-request protocol metadata belongs only to the modern era. Legacy revisions
  // are still supported, but they negotiate through initialize instead.
  if (hasBodyVersion && bodyVersion !== MCP_PROTOCOL.modernVersion) {
    return fail(
      id,
      UNSUPPORTED_VERSION,
      "Unsupported per-request protocol version",
      {
        requested: bodyVersion,
        supported: MCP_SUPPORTED_VERSIONS,
        legacyViaInitialize: MCP_PROTOCOL.legacyVersions,
      },
      400,
    );
  }

  if (method === "server/discover" && !hasBodyVersion) {
    return fail(
      id,
      INVALID_PARAMS,
      `server/discover requires params._meta.${MCP_META_KEYS.protocolVersion}`,
      undefined,
      400,
    );
  }

  const isModern = bodyVersion === MCP_PROTOCOL.modernVersion;

  // A notification has no id and expects no body back, only an acknowledgement.
  const isNotification = message.id === undefined || message.id === null;

  if (isModern) {
    const headerVersion = request.headers.get("mcp-protocol-version");
    const headerMethod = request.headers.get("mcp-method");

    // The body is the source of truth; the headers exist so intermediaries can route
    // without parsing it. Where they disagree, something between us rewrote one of
    // them, and acting on either would be guessing which.
    if (!headerVersion || headerVersion !== bodyVersion) {
      return fail(
        id,
        HEADER_MISMATCH,
        `MCP-Protocol-Version header ${headerVersion ? `'${headerVersion}' does not match body value` : "is missing"} '${bodyVersion}'`,
        undefined,
        400,
      );
    }

    if (!headerMethod || headerMethod !== method) {
      return fail(
        id,
        HEADER_MISMATCH,
        `Mcp-Method header ${headerMethod ? `'${headerMethod}' does not match body method` : "is missing"} '${method}'`,
        undefined,
        400,
      );
    }

    const clientInfo = meta[MCP_META_KEYS.clientInfo];
    if (
      clientInfo !== undefined &&
      (!isRecord(clientInfo) ||
        typeof clientInfo.name !== "string" ||
        !clientInfo.name ||
        typeof clientInfo.version !== "string" ||
        !clientInfo.version)
    ) {
      return fail(
        id,
        INVALID_PARAMS,
        `When present, params._meta.${MCP_META_KEYS.clientInfo} requires string name and version`,
        undefined,
        400,
      );
    }

    if (!isRecord(meta[MCP_META_KEYS.clientCapabilities])) {
      return fail(
        id,
        INVALID_PARAMS,
        `Modern MCP requests require params._meta.${MCP_META_KEYS.clientCapabilities}`,
        undefined,
        400,
      );
    }

    if (method === "server/discover") {
      return modernOk(id, {
        supportedVersions: MCP_SUPPORTED_VERSIONS,
        capabilities: MCP_SERVER_CAPABILITIES,
        instructions: INSTRUCTIONS,
        ...MCP_CACHE_HINT,
        _meta: { [MCP_META_KEYS.serverInfo]: MCP_SERVER_INFO },
      });
    }

    if (method === "ping") return modernOk(id, {});

    if (method === "tools/list") {
      return modernOk(id, { ...TOOL_LIST, ...MCP_CACHE_HINT });
    }

    if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      const headerName = request.headers.get("mcp-name");

      if (!headerName || decodeHeaderValue(headerName) !== name) {
        return fail(
          id,
          HEADER_MISMATCH,
          `Mcp-Name header ${headerName ? `'${decodeHeaderValue(headerName)}' does not match body value` : "is missing"} '${name}'`,
          undefined,
          400,
        );
      }

      if (!isToolName(name)) {
        return fail(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      }

      const args = (params.arguments ?? {}) as Record<string, unknown>;
      return modernOk(id, toolResult(name, args, userAgent));
    }

    // 404 rather than 200: the status is what lets a client tell an unimplemented
    // method apart from an endpoint that is not an MCP endpoint at all.
    return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`, undefined, 404);
  }

  // ---- Legacy era: the initialize handshake and everything scoped to it. ----

  if (method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    // Echo the client's version when we speak it, otherwise name our newest legacy
    // one; a legacy client has no way to fall forward, so it needs a usable answer.
    const negotiated = MCP_PROTOCOL.legacyVersions.includes(
      requested as (typeof MCP_PROTOCOL.legacyVersions)[number],
    )
      ? requested
      : MCP_PROTOCOL.legacyVersions[0];

    return ok(id, {
      protocolVersion: negotiated,
      capabilities: MCP_SERVER_CAPABILITIES,
      serverInfo: MCP_SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }

  if (method === "notifications/initialized" || isNotification) {
    return new Response(null, { status: 202, headers: CORS });
  }

  if (method === "ping") return ok(id, {});

  if (method === "tools/list") return ok(id, TOOL_LIST);

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (!isToolName(name)) {
      return fail(id, INVALID_PARAMS, `Unknown tool: ${name}`);
    }
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    return ok(id, toolResult(name, args, userAgent));
  }

  return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`, undefined, 404);
}

/**
 * The 2026-07-28 revision has no GET stream, so an MCP client gets 405. A person
 * who pasted the connector URL into a browser gets the page explaining what it is,
 * which is the only reason this handler does anything other than refuse.
 */
export function GET(request: Request) {
  const accept = request.headers.get("accept") ?? "";

  if (accept.includes("text/html")) {
    return Response.redirect(`${site.url}/agents#mcp`, 302);
  }

  return fail(
    null,
    METHOD_NOT_FOUND,
    "This MCP endpoint accepts POST. The GET stream was removed in protocol revision 2026-07-28.",
    undefined,
    405,
  );
}

export function DELETE() {
  return fail(
    null,
    METHOD_NOT_FOUND,
    "Protocol-level sessions were removed in revision 2026-07-28; there is nothing to terminate.",
    undefined,
    405,
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
