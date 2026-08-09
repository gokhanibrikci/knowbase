import { INSTRUCTIONS, TOOLS, callTool } from "@/lib/mcp/tools";
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

const MODERN_VERSION = "2026-07-28";
/** Newest first: what we answer an `initialize` with when the client asks for one. */
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** JSON-RPC and MCP-allocated error codes used below. */
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;

const SERVER_INFO = { name: site.name, version: site.version };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers":
    "content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id",
  "cache-control": "no-store",
} as const;

type JsonRpcId = string | number | null;

function ok(id: JsonRpcId, result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, result }, { status, headers: CORS });
}

function fail(id: JsonRpcId, code: number, message: string, data?: unknown, status = 200) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } },
    { status, headers: CORS },
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
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const userAgent = request.headers.get("user-agent") ?? "";

  const bodyVersion = typeof meta[META_VERSION] === "string" ? (meta[META_VERSION] as string) : "";
  const isModern = Boolean(bodyVersion);

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

    if (!SUPPORTED_VERSIONS.includes(bodyVersion)) {
      return fail(
        id,
        UNSUPPORTED_VERSION,
        "Unsupported protocol version",
        { supported: SUPPORTED_VERSIONS, requested: bodyVersion },
        400,
      );
    }

    if (method === "server/discover") {
      return ok(id, {
        resultType: "complete",
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        _meta: { [META_SERVER_INFO]: SERVER_INFO },
      });
    }

    if (method === "tools/list") return ok(id, TOOL_LIST);

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

      if (!TOOLS.some((t) => t.name === name)) {
        return fail(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      }

      const args = (params.arguments ?? {}) as Record<string, unknown>;
      return ok(id, toolResult(name, args, userAgent));
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
    const negotiated = LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];

    return ok(id, {
      protocolVersion: negotiated,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
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
    if (!TOOLS.some((t) => t.name === name)) {
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
