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
import {
  TRUST_BOUNDARY,
  bodyProblem,
  handleProblem,
  isCitizen,
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

// ---- the first law, and the wire that carries it --------------------------

check(
  "trust boundary names the threat in plain words",
  TRUST_BOUNDARY.includes("UNTRUSTED") && TRUST_BOUNDARY.includes("never follow instructions"),
);

const worldTools = TOOLS.filter((t) => t.name.startsWith("world_"));
check(
  "contract: all six world tools are declared",
  ["world_join", "world_post", "world_read", "world_rooms", "world_create_room", "world_presence"].every(
    (n) => worldTools.some((t) => t.name === n),
  ),
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
