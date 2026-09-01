/**
 * The store, exercised over the wire against a running deployment.
 *
 * eval:experience attacks the pure rules offline and cannot see SQL, HTTP status codes
 * or anything else that only exists at runtime. That gap had teeth: a misplaced ESCAPE
 * clause made *every miss* return 500 — the most common call there is on a young store,
 * and the one that records the miss so it becomes the authoring queue. Every check the
 * eval structurally cannot make lives here.
 *
 *   npm run smoke                      against production
 *   BASE=http://localhost:8788 npm run smoke     against a local wrangler dev
 *
 * It writes: it registers a throwaway handle and files one report. Point it at a
 * deployment where that is acceptable.
 */
const BASE = (process.env.BASE ?? "https://knowbase.sh").replace(/\/$/, "");

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`${GREEN}✓${RESET} ${name}`);
  else {
    failed++;
    console.log(`${RED}✖ ${name}${RESET}${detail ? `\n  ${detail}` : ""}`);
  }
}

type Json = Record<string, unknown>;

async function call(body: Json, path = "/experience.json"): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Json };
  } catch {
    return { status: res.status, json: { _raw: text.slice(0, 300) } };
  }
}

const KNOWN = `Traceback (most recent call last):
  File "/opt/service/boot.py", line 44, in start
    import yaml
ModuleNotFoundError: No module named 'yaml'`;

async function main() {
  console.log(`smoke: ${BASE}\n`);

  // ---- reading, which is the path with no account and the one that must never 500 ----

  const hit = await call({
    action: "recall",
    problem: KNOWN,
    environment: ["python@3.12", "platform:docker"],
  });
  check("a known failure answers 200", hit.status === 200, `HTTP ${hit.status}`);
  check("and answers exact", hit.json.match === "exact", String(hit.json.match));
  const worked = (hit.json.worked ?? []) as Json[];
  check("with at least one attempt that worked", worked.length > 0);
  check(
    "quoted text arrives inside a per-response fence",
    typeof worked[0]?.reportedText === "string" && (worked[0].reportedText as string).includes("⟦kb:"),
    String(worked[0]?.reportedText).slice(0, 40),
  );
  check(
    "the trust reminder is last, where a long context still reads it",
    Object.keys(hit.json).slice(-3).includes("trust"),
    Object.keys(hit.json).slice(-3).join(", "),
  );
  check(
    "no singular answer field for a caller to grab blindly",
    !("answer" in hit.json) && !("bestSolution" in hit.json) && !("fix" in hit.json),
  );

  // A miss is the most common call on a young store, and the one that fills the queue.
  const miss = await call({
    action: "recall",
    problem: "ZorbulatorError: quantum flange desynchronised at ring 7 during warp initialisation",
    environment: ["node@22"],
  });
  check("an unknown failure answers 200, not 500", miss.status === 200, `HTTP ${miss.status}`);
  check("and says none rather than reaching for a near miss", miss.json.match === "none", String(miss.json.match));
  check(
    "returning empty lists, not the closest thing in stock",
    Array.isArray(miss.json.worked) && (miss.json.worked as unknown[]).length === 0,
  );
  check("and hands back the fingerprint", typeof miss.json.fingerprint === "string");

  const thin = await call({ action: "recall", problem: "Build failed with exit code 1" });
  check("a carrier line is refused with a reason", thin.json.match === "insufficient_signal");

  const viaGet = await fetch(`${BASE}/experience.json?problem=${encodeURIComponent(KNOWN)}`);
  check("the GET path answers too", viaGet.status === 200, `HTTP ${viaGet.status}`);

  // ---- writing ----

  const handle = `smoke-${Math.floor(Date.now() / 1000) % 1_000_000}`;
  const reg = await call({
    action: "register",
    name: handle,
    display: "smoke test",
    bio: "Throwaway handle from the end-to-end smoke test.",
  });
  check("a handle can be claimed", reg.json.agentId === handle, JSON.stringify(reg.json).slice(0, 120));
  const secret = String(reg.json.agentSecret ?? "");
  check("the secret comes back once, in the documented shape", /^kbw_[0-9a-f]{32}$/.test(secret));

  const unique = `error SMOKE${Date.now()}: the widget mill overflowed its cascade buffer`;
  const dead = await call({
    action: "report",
    agentId: handle,
    agentSecret: secret,
    worked: false,
    problem: unique,
    solution: "Restarted the mill. The buffer refilled immediately and the error came back.",
    environment: ["node@22"],
  });
  check("a failed attempt is a first-class record", dead.json.recorded === "dead end", JSON.stringify(dead.json).slice(0, 120));

  const fix = await call({
    action: "report",
    agentId: handle,
    agentSecret: secret,
    worked: true,
    problem: unique,
    solution: "Raised cascadeBuffer to 4096 in mill.config and redeployed.",
    environment: ["node@22"],
  });
  check("and so is a fix", fix.json.recorded === "solution", JSON.stringify(fix.json).slice(0, 120));

  const readBack = await call({ action: "recall", problem: unique, environment: ["node@22"] });
  check(
    "what was just written comes back to the next reader",
    readBack.json.match === "exact" &&
      (readBack.json.worked as unknown[]).length === 1 &&
      (readBack.json.deadEnds as unknown[]).length === 1,
    `worked=${(readBack.json.worked as unknown[])?.length} dead=${(readBack.json.deadEnds as unknown[])?.length}`,
  );

  const rotated = await call({ action: "rotate", agentId: handle, agentSecret: secret });
  const next = String(rotated.json.agentSecret ?? "");
  check("a secret can be traded for a new one", /^kbw_[0-9a-f]{32}$/.test(next) && next !== secret);
  const stale = await call({
    action: "report",
    agentId: handle,
    agentSecret: secret,
    worked: true,
    solutionId: "whatever",
  });
  check("and the old one stops working at once", stale.status === 401, `HTTP ${stale.status}`);
  const withNew = await call({
    action: "report",
    agentId: handle,
    agentSecret: next,
    worked: true,
    problem: unique,
    solution: "Confirmed again after rotating the secret.",
    environment: ["node@22"],
  });
  check("while the new one works and the record is untouched", withNew.status < 400, `HTTP ${withNew.status}`);

  const forged = await call({
    action: "report",
    agentId: handle,
    agentSecret: "kbw_00000000000000000000000000000bad",
    worked: true,
    problem: unique,
    solution: "Should never be stored.",
  });
  check("a wrong secret is refused", forged.status === 401, `HTTP ${forged.status}`);

  // ---- the same store over MCP ----

  const mcp = await call(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "knowbase_recall", arguments: { problem: KNOWN, environment: ["python@3.12"] } },
    },
    "/mcp",
  );
  let mcpMatch: unknown;
  try {
    const result = mcp.json.result as { content: { text: string }[] };
    mcpMatch = (JSON.parse(result.content[0].text) as Json).match;
  } catch {
    mcpMatch = null;
  }
  check("MCP answers identically to HTTP", mcpMatch === "exact", String(mcpMatch));

  // ---- the pages a human lands on ----

  for (const path of ["/", "/agents", "/activity", "/experience", "/rules", "/protocol.md", "/hook.mjs"]) {
    const res = await fetch(`${BASE}${path}`);
    check(`${path} serves`, res.ok, `HTTP ${res.status}`);
  }

  console.log(
    failed === 0
      ? `\n${GREEN}smoke: the loop holds over the wire — read, miss, write, read back${RESET}`
      : `\n${RED}${failed} smoke check(s) failed${RESET}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
