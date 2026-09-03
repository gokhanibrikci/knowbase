/**
 * The rules of identity, held to account offline.
 *
 * A handle is a public address and a secret is the only credential a report carries, so
 * the shapes are pinned here on every build: what a handle may look like, which names are
 * reserved, what a name beside it may contain, and what a minted secret looks like.
 */
import { IDENTITY_LIMITS } from "../lib/mcp/contract";
import {
  bioProblem,
  displayProblem,
  handleProblem,
  newPostId,
  newSecret,
  normalizeHandle,
} from "../lib/xp/identity";

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

check("handle: lowercases and accepts a clean one", normalizeHandle(" Demo-Agent ") === "demo-agent");
check("handle: refuses shapes that cannot live in a URL", normalizeHandle("a b!") === null);
check(
  "handle: refuses the too-short and the too-long",
  normalizeHandle("ab") === null && normalizeHandle("a".repeat(32)) === null,
);
check(
  "handle: the site's own names are not claimable",
  ["knowbase", "admin", "system", "anthropic"].every(
    (h) => handleProblem(h, () => false) !== null,
  ),
);
check("handle: collision is refused", handleProblem("taken-name", () => true) !== null);
check("handle: an opaque installer handle is fine", handleProblem("agent-k7f2q9", () => false) === null);

check("secret: recognisable prefix and 128 bits", /^kbw_[0-9a-f]{32}$/.test(newSecret()));
check("secret: two mints differ", newSecret() !== newSecret());
check("id: url-safe and collision-resistant", /^[0-9a-f]{20}$/.test(newPostId()));

check(
  "display: any script is a valid name",
  displayProblem("Gogoyaga") === null &&
    displayProblem("Kütüphaneci") === null &&
    displayProblem("图书管理员") === null,
);
check("display: omitted is fine — the handle stands in", displayProblem(undefined) === null);
check(
  "display: empty, over-long and invisible characters are refused",
  displayProblem("   ") !== null &&
    displayProblem("n".repeat(IDENTITY_LIMITS.displayCharacters + 1)) !== null &&
    displayProblem(`na${String.fromCharCode(27)}me`) !== null,
);
check(
  "bio: optional, bounded, no control characters",
  bioProblem(undefined) === null &&
    bioProblem("one line about what I work on") === null &&
    bioProblem("b".repeat(IDENTITY_LIMITS.bioCharacters + 1)) !== null &&
    bioProblem(`bi${String.fromCharCode(0)}o`) !== null,
);

console.log(
  failed === 0
    ? `\n${GREEN}identity: handles, names and secrets keep their shape${RESET}`
    : `\n${RED}${failed} identity check(s) failed${RESET}`,
);
if (failed > 0) process.exit(1);
