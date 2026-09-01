/**
 * Making two agents who have never met recognise the same failure.
 *
 * Everything here is a pure function so the experience eval can attack it offline. Two
 * mistakes are possible and they are not symmetric:
 *
 *   under-merging  two agents hit the same wall, produce different fingerprints, and
 *                  neither ever sees the other's work. The store looks empty and the
 *                  whole thing is pointless.
 *   over-merging   two genuinely different failures collapse into one record, and the
 *                  advice handed out is confidently wrong.
 *
 * An adversarial review ran an earlier version of this file and found both, in the two
 * places they hurt most: every Python traceback hashed to "Traceback (most recent call
 * last)" because the first line of a traceback is not the error, and exit codes 137 and
 * 143 collided because the normalizer flattened every number it saw. The extractor and
 * the number rules below exist because of those two findings.
 *
 * The exact fingerprint is only the FIRST match path. Text search is the fallback, and
 * the original error sample travels with every answer so the reader can judge for itself
 * whether the record really is its problem.
 */

/* -- extraction: which line IS the error ----------------------------------- */

/** Lines that are the shape of a stack, not the shape of a failure. */
function isFrame(line: string): boolean {
  return (
    /^(at\s|file\s+"|from\s|\.\.\.|caused by:?$|in\s+<module>|\s*\^+\s*$|\|\s|-->\s)/i.test(line) ||
    /^\s*#\d+\s/.test(line) ||
    /^\s*\d+\s*\|/.test(line)
  );
}

/**
 * Lines that appear under every failure ever and identify none of them. A fingerprint
 * built from one of these becomes a mega-problem that swallows the store: every failed
 * build in every language, filed together, ranked together, useless.
 */
const CARRIERS = [
  /^traceback \(most recent call last\)/i,
  /^build failed/i,
  /^command failed/i,
  /^compilation failed/i,
  /^error:?$/i,
  /^errors?:?\s*\d*$/i,
  /^(npm|yarn|pnpm)\s+err(or)?!?\s*(code\s+ELIFECYCLE)?$/i,
  // The "error:" prefix is stripped as a block prefix before this runs, so the pattern
  // must match the bare remainder too.
  /^(error:?\s*)?process (completed|exited) with (exit )?(code|status)/i,
  /^exit(ed)? (with )?(code|status)/i,
  /^make(\[\d+\])?:\s*\*\*\*/i,
  /^the command .* returned a non-zero code/i,
  /^task .* failed/i,
  /^script failed/i,
  /^job failed/i,
  /^tests? failed/i,
  /^failed to compile/i,
  /^\d+ (error|problem)s?\b.*$/i,
  /^internal error$/i,
  /^unhandled (exception|rejection)$/i,
  /^segmentation fault$/i,
];

function isCarrier(line: string): boolean {
  const l = line.trim();
  return CARRIERS.some((p) => p.test(l));
}

/** Tool prefixes that repeat on every line of a multi-line block. */
const BLOCK_PREFIX = /^(npm error|npm ERR!|npm WARN|yarn error|pnpm ERR_|error:|warning:|✘ \[ERROR\]|\[ERROR\]|error\[E\d+\]:)\s*/;

function blockPrefix(line: string): string | null {
  const m = line.match(BLOCK_PREFIX);
  return m ? m[1] : null;
}

/**
 * The one line — or one block — that names the failure.
 *
 * Language by language the error lives somewhere different, and getting this wrong is
 * not a small inaccuracy: it decides whether every failure in an ecosystem merges into
 * one record.
 *
 *   Python   the error is the LAST line, after the traceback
 *   Java     the innermost "Caused by:" is the real cause
 *   npm      the meaning is spread across a prefixed block, not on one line
 *   the rest the first line that is neither a frame nor a carrier
 */
export function errorHeadline(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  // Python: the exception type and message come after the frames.
  if (/^traceback \(most recent call last\)/i.test(lines[0])) {
    const typed = [...lines].reverse().find((l) => /^[\w.]+(Error|Exception|Warning)\b/.test(l));
    if (typed) return typed;
    const tail = [...lines].reverse().find((l) => !isFrame(l) && !isCarrier(l));
    if (tail) return tail;
  }

  // Java and friends: the innermost cause is the failure; the outer ones are wrapping.
  const causes = lines.filter((l) => /^caused by:\s*\S/i.test(l));
  if (causes.length > 0) return causes[causes.length - 1].replace(/^caused by:\s*/i, "");

  // Prefixed blocks: npm spreads one error over several lines, all wearing the prefix.
  const prefix = lines.map(blockPrefix).find(Boolean);
  if (prefix) {
    const block = lines
      .filter((l) => blockPrefix(l) === prefix)
      .map((l) => l.replace(BLOCK_PREFIX, "").trim())
      .filter((l) => l && !isCarrier(l));
    if (block.length > 0) return block.slice(0, 3).join(" ");
  }

  const meaningful = lines.find((l) => !isFrame(l) && !isCarrier(l));
  return meaningful ?? lines.find((l) => !isFrame(l)) ?? lines[0];
}

/* -- normalization: what is noise, and what is the error ------------------- */

/**
 * Volatile fragments. Every rule here answers "would two agents hitting the identical
 * failure differ in this?" — and nothing else is touched, because a number is very
 * often the whole error: 137 is not 143, and 413 is not 502.
 */
const SCRUBBERS: [RegExp, string][] = [
  // Absolute paths, Windows and POSIX. The basename survives: "cannot find module ./foo"
  // and "./bar" are different failures, but the directories above them are noise.
  [/[a-z]:\\(?:[^\s\\'"]+\\)*([^\s\\'"]*)/gi, "<path>/$1"],
  [/(?:\/[^\s/'"]+){2,}\/([^\s/'":,)]*)/g, "<path>/$1"],
  // Identifiers unique to one run.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hash>"],
  [/\b\d{4}-\d{2}-\d{2}([t ]\d{2}:\d{2}:\d{2}(\.\d+)?z?)?\b/gi, "<time>"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
  [/\bpid[:= ]\s*\d+/gi, "pid <n>"],
  // Source positions. "line 41" and "line 87" of the same error are the same error.
  [/:\d+:\d+\b/g, ":<line>"],
  [/\b(line|column|col|offset|position)\s+\d+/gi, "$1 <n>"],
  // Quantities that vary per run.
  [/\b\d+(?:\.\d+)?\s?(?:ms|kb|mb|gb|tb|bytes?|secs?|seconds?|minutes?)\b/gi, "<size>"],
  [/\b(?:port\s+)?\d{4,5}\b(?=\s|$|[,.)])/g, (m: string) => (/^port/i.test(m) ? "port <n>" : m)] as unknown as [RegExp, string],
  // Long digit runs are ids; short ones are usually the error itself and stay.
  [/\b\d{6,}\b/g, "<n>"],
];

export function normalizeError(raw: string): string {
  let text = raw.toLowerCase();
  for (const [pattern, replacement] of SCRUBBERS) {
    text = typeof replacement === "function"
      ? text.replace(pattern, replacement as unknown as string)
      : text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Words carrying no discriminating signal. Deliberately short: a stop list that grows
 * becomes a machine for merging distinct failures.
 */
const NOISE = new Set([
  "the", "a", "an", "at", "in", "on", "of", "to", "for", "with", "from", "by", "is",
  "was", "be", "this", "that", "it", "its", "and", "or", "but", "not", "no",
  "error", "err", "exception", "failed", "failure", "fatal", "warning", "warn",
  "please", "try", "again", "unexpected", "problem", "issue", "occurred", "while",
  "npm", "yarn", "pnpm", "traceback", "recent", "call", "last", "caused",
]);

/** How many meaningful tokens of the error decide identity. */
const SIGNATURE_TOKENS = 12;

export function signatureTokens(raw: string): string[] {
  const seen = new Set<string>();
  for (const token of normalizeError(errorHeadline(raw)).split(/[^a-z0-9<>_./@:-]+/)) {
    if (token.length < 2 || NOISE.has(token)) continue;
    if (!seen.has(token)) seen.add(token);
    if (seen.size >= SIGNATURE_TOKENS) break;
  }
  return [...seen];
}

/**
 * Whether there is enough in this text to identify a failure at all.
 *
 * "Build failed with exit code 1" is true of everything and identifies nothing; filing
 * it would create one enormous record that every unrelated failure joins. Better to
 * refuse and say why than to accept a fingerprint that poisons ranking for everyone.
 */
export function insufficientSignal(raw: string): string | null {
  const headline = errorHeadline(raw);
  if (!headline) return "no error text";
  if (isCarrier(headline)) {
    return "this line reports that something failed without saying what — include the error itself, not just the exit status";
  }
  const tokens = signatureTokens(raw);
  if (tokens.length < 3) {
    return "too little to identify this failure — paste the whole error, not a summary";
  }
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The join key between two agents who have never met. Sixteen hex characters: far more
 * than collision safety needs at any plausible size, short enough to read in a URL.
 *
 * Versioned, because the first version of a rule like this is never the last, and the
 * stored sample lets any later version be recomputed rather than lost.
 */
export const FINGERPRINT_VERSION = 1;

export async function fingerprint(raw: string): Promise<string> {
  const tokens = signatureTokens(raw);
  const basis = tokens.length > 0 ? tokens.join(" ") : normalizeError(raw);
  return (await sha256Hex(`v${FINGERPRINT_VERSION}|${basis}`)).slice(0, 16);
}

/** A short, readable title when the agent does not supply one. */
export function titleFrom(raw: string): string {
  const headline = errorHeadline(raw).replace(/\s+/g, " ").trim();
  return headline.length > 140 ? `${headline.slice(0, 137)}...` : headline;
}

/* -- environments ---------------------------------------------------------- */

export type Environment = { name: string; version: string | null };

/**
 * Self-reported, and an agent reads them straight off its lockfile:
 * "next@16.3.0", "@opennextjs/cloudflare@1.20.2", "node@22", "platform:cloudflare-workers".
 */
export function parseEnvironment(raw: unknown): Environment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, Environment>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const entry = item.trim().toLowerCase();
    if (!entry || entry.length > 120) continue;
    // Scoped npm names start with @, so split on the LAST @ only.
    const at = entry.lastIndexOf("@");
    const [name, version] = at > 0 ? [entry.slice(0, at), entry.slice(at + 1)] : [entry, null];
    if (!/^[a-z0-9@/_.:-]+$/.test(name)) continue;
    if (!seen.has(name)) seen.set(name, { name, version: version || null });
  }
  return [...seen.values()].slice(0, 40);
}

/** Major version only: 16.3.0 and 16.4.1 are the same world far more often than not. */
function major(version: string | null): string | null {
  if (!version) return null;
  const m = version.match(/\d+/);
  return m ? m[0] : null;
}

export type EnvMatch = "same" | "compatible" | "different" | "unknown";

/**
 * How much a report from over there is worth over here.
 *
 *   same        an exact version overlap — the strongest thing that can be said
 *   compatible  same package, same major
 *   different   the same package at a different major: usually the entire story
 *   unknown     nothing in common, or nobody said
 *
 * Deliberately coarse. A precise-looking score computed from self-reported strings would
 * be false precision, and agents would rank on it.
 */
export function environmentMatch(mine: Environment[], theirs: Environment[]): EnvMatch {
  if (mine.length === 0 || theirs.length === 0) return "unknown";
  const byName = new Map(theirs.map((e) => [e.name, e]));

  let compatible = false;
  let conflicting = false;
  for (const entry of mine) {
    const other = byName.get(entry.name);
    if (!other) continue;
    if (entry.version && other.version && entry.version === other.version) return "same";
    const a = major(entry.version);
    const b = major(other.version);
    if (a && b) {
      if (a === b) compatible = true;
      else conflicting = true;
    } else {
      compatible = true;
    }
  }

  if (compatible) return "compatible";
  if (conflicting) return "different";
  return "unknown";
}

export function formatEnvironment(env: Environment[]): string[] {
  return env.map((e) => (e.version ? `${e.name}@${e.version}` : e.name));
}
