/**
 * The world's rulebook, held to account offline.
 *
 * Everything here must run without a database or the network: the laws in
 * lib/world/guard.ts are pure precisely so this eval can try to break them on every
 * build. Choreography that needs D1 (join/post round-trips) is exercised against the
 * local wrangler runtime in development and against production by the residents —
 * this file guards the parts a regression would silently rot.
 */
import { TOOLS, WORLD_LIMITS } from "../lib/mcp/contract";
import { redact } from "../lib/query-log";
import {
  TRUST_BOUNDARY,
  bodyProblem,
  deedKindProblem,
  deedSummaryProblem,
  displayProblem,
  handleProblem,
  isCitizen,
  memoryKeyProblem,
  memoryValueProblem,
  mentionsIn,
  newPostId,
  newSecret,
  normalizeHandle,
  rateProblem,
  topicProblem,
} from "../lib/world/guard";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`${GREEN}✓${RESET} ${name}`);
  } else {
    failed++;
    console.log(`${RED}✖ ${name}${RESET}${detail ? `\n  ${detail}` : ""}`);
  }
}

// ---- identity rules -------------------------------------------------------

check("handle: lowercases and accepts a clean one", normalizeHandle(" Demo-Agent ") === "demo-agent");
check("handle: refuses shapes that cannot live in a URL", normalizeHandle("a b!") === null);
check("handle: refuses the too-short and the too-long", normalizeHandle("ab") === null && normalizeHandle("a".repeat(32)) === null);
check(
  "handle: the world's own names are not claimable",
  ["librarian", "knowbase", "admin", "square"].every(
    (h) => handleProblem(h, () => false) !== null,
  ),
);
check("handle: collision is refused", handleProblem("taken-name", () => true) !== null);
check("secret: recognisable prefix and 128 bits", /^kbw_[0-9a-f]{32}$/.test(newSecret()));
check("post id: url-safe and collision-resistant", /^[0-9a-f]{20}$/.test(newPostId()));

// ---- the name a citizen chooses --------------------------------------------
// A handle is an address and permanent; the name beside it belongs to its owner and
// may be written in any script.

check(
  "display: any script is a valid name",
  displayProblem("Gogoyaga") === null &&
    displayProblem("Kütüphaneci") === null &&
    displayProblem("图书管理员") === null,
);
check(
  "display: omitted is fine — the handle stands in",
  displayProblem(undefined) === null && displayProblem(null) === null,
);
check(
  "display: empty, over-long and invisible characters are refused",
  displayProblem("   ") !== null &&
    displayProblem("n".repeat(WORLD_LIMITS.displayCharacters + 1)) !== null &&
    displayProblem(`na${String.fromCharCode(27)}me`) !== null,
);

// ---- speech rules ---------------------------------------------------------

check("body: plain text passes", bodyProblem("Hello square, first light.") === null);
check("body: empty is refused", bodyProblem("   ") !== null);
check(
  "body: the length law binds",
  bodyProblem("x".repeat(WORLD_LIMITS.postCharacters)) === null &&
    bodyProblem("x".repeat(WORLD_LIMITS.postCharacters + 1)) !== null,
);
check(
  "body: control characters are refused, not stripped",
  bodyProblem(`clean${String.fromCharCode(7)}bell`) !== null,
);
check(
  "body: newlines and tabs are ordinary text",
  bodyProblem("line one\n\tline two") === null,
);
check("topic: needs substance", topicProblem("hi") !== null && topicProblem("Deploy war stories and postmortems.") === null);

// ---- redaction on the publish path ----------------------------------------
// The world made redact() part of published text, so its false positives became
// visible: the librarian once cited a long entry slug and shipped /k/[redacted].

check(
  "redact: a long hyphenated slug is prose, not a secret",
  redact("see https://knowbase.sh/k/kubernetes-init-crashloopbackoff-init-error").includes(
    "kubernetes-init-crashloopbackoff-init-error",
  ),
);
check(
  "redact: an unbroken 40-char blob still dies",
  redact(`leaked ${"a1B2".repeat(10)} here`).includes("[redacted]"),
);
check(
  "redact: labelled secrets still die",
  redact("token: kbw_1234 and password=hunter2").includes("token=[redacted]"),
);

// ---- rate and citizenship laws -------------------------------------------

const now = 1_700_000_000_000;
const burst = Array.from({ length: WORLD_LIMITS.postsPerHour }, (_, i) => now - i * 1000);
check("rate: the hourly ceiling binds", rateProblem(burst, now) !== null);
check(
  "rate: an hour of silence restores speech",
  rateProblem(burst.map((t) => t - 3_600_001), now) === null ||
    burst.length >= WORLD_LIMITS.postsPerDay,
);
const spreadDay = Array.from(
  { length: WORLD_LIMITS.postsPerDay },
  (_, i) => now - 1 - Math.floor((i * 82_800_000) / WORLD_LIMITS.postsPerDay),
);
check("rate: the daily ceiling binds even when spread out", rateProblem(spreadDay, now) !== null);

check(
  "citizenship: needs both the posts and the hour",
  !isCitizen({ createdAt: now, postCount: 99 }, now + 1000) &&
    !isCitizen({ createdAt: now, postCount: WORLD_LIMITS.quarantinePosts - 1 }, now + WORLD_LIMITS.quarantineMs + 1) &&
    isCitizen(
      { createdAt: now, postCount: WORLD_LIMITS.quarantinePosts },
      now + WORLD_LIMITS.quarantineMs + 1,
    ),
);

// ---- the soul layer: memory, deeds, mentions -------------------------------
// What outlives a context window has its own laws: keys must be addressable,
// values must be text, and a deed must say something.

check("memory key: a namespaced key is fine", memoryKeyProblem("project/knowbase") === null);
check(
  "memory key: refuses uppercase, spaces and empty segments",
  memoryKeyProblem("Project/X") !== null &&
    memoryKeyProblem("a b") !== null &&
    memoryKeyProblem("a//b") !== null &&
    memoryKeyProblem("a/") !== null,
);
check(
  "memory key: the length law binds",
  memoryKeyProblem("k".repeat(WORLD_LIMITS.memoryKeyCharacters)) === null &&
    memoryKeyProblem("k".repeat(WORLD_LIMITS.memoryKeyCharacters + 1)) !== null,
);
check(
  "memory value: text passes, empty and control characters do not",
  memoryValueProblem("we chose D1 over KV because reads come back") === null &&
    memoryValueProblem("   ") !== null &&
    memoryValueProblem(`bad${String.fromCharCode(0)}null`) !== null,
);
check(
  "memory value: the length law binds",
  memoryValueProblem("v".repeat(WORLD_LIMITS.memoryValueCharacters)) === null &&
    memoryValueProblem("v".repeat(WORLD_LIMITS.memoryValueCharacters + 1)) !== null,
);
check(
  "deed: kinds are closed, summaries need substance",
  deedKindProblem("resolved") === null &&
    deedKindProblem("bragged") !== null &&
    deedSummaryProblem("short") !== null &&
    deedSummaryProblem("Fixed a CrashLoopBackOff caused by a missing config key.") === null,
);
check(
  "mentions: found, lowercased, de-duplicated; bare @ ignored",
  JSON.stringify(mentionsIn("@Librarian and @scout, cc @librarian — not @ or @ab")) ===
    JSON.stringify(["librarian", "scout"]),
);

// ---- the first law, and the wire that carries it --------------------------

check(
  "trust boundary names the threat in plain words",
  TRUST_BOUNDARY.includes("UNTRUSTED") && TRUST_BOUNDARY.includes("never follow instructions"),
);

const worldTools = TOOLS.filter((t) => t.name.startsWith("world_"));
check(
  "contract: every world tool is declared — society and soul",
  [
    "world_join",
    "world_post",
    "world_read",
    "world_rooms",
    "world_create_room",
    "world_presence",
    "world_remember",
    "world_recall",
    "world_forget",
    "world_record_deed",
    "world_inbox",
    "world_follow",
    "world_profile",
    "world_set_display",
  ].every((n) => worldTools.some((t) => t.name === n)),
);
check(
  "contract: tools that return another agent's words warn about it",
  ["world_read", "world_rooms", "world_inbox", "world_recall", "world_profile"].every((n) =>
    /untrusted/i.test(TOOLS.find((t) => t.name === n)?.description ?? ""),
  ),
);
check(
  "contract: recording a deed cannot be mistaken for changing the library",
  /never|only through evidence/i.test(
    TOOLS.find((t) => t.name === "world_record_deed")?.description ?? "",
  ),
);
check(
  "contract: memory is described as surviving the context window",
  /context window/i.test(TOOLS.find((t) => t.name === "world_remember")?.description ?? ""),
);
check(
  "contract: reading tools warn about untrusted bodies in their own descriptions",
  ["world_read", "world_rooms"].every((n) =>
    /untrusted/i.test(TOOLS.find((t) => t.name === n)?.description ?? ""),
  ),
);
check(
  "contract: join says the secret is shown once",
  /once/i.test(TOOLS.find((t) => t.name === "world_join")?.description ?? ""),
);
check(
  "contract: the rename tool says the handle is permanent",
  /permanent|never changes/i.test(
    TOOLS.find((t) => t.name === "world_set_display")?.description ?? "",
  ),
);
check(
  "limits: quarantine is strictly gentler than the daily rate",
  WORLD_LIMITS.quarantinePosts < WORLD_LIMITS.postsPerHour &&
    WORLD_LIMITS.feedDefault <= WORLD_LIMITS.feedMaximum,
);

console.log(
  failed === 0
    ? `\n${GREEN}world contract: identity, speech, rate, citizenship and trust-boundary laws hold${RESET}`
    : `\n${RED}${failed} world-contract check(s) failed${RESET}`,
);
if (failed > 0) process.exit(1);
