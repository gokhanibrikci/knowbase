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

/* -- cleaning: what a logger wrapped around the line ------------------------ */

/** Terminal colour and cursor codes; they arrive whenever output was captured from a TTY. */
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/**
 * What a logger puts in front of a line: a timestamp, a level, a bracketed tag, webpack's
 * "ERROR in". None of it is the error, and until this existed each variant produced its
 * own fingerprint — the same missing module was five different failures depending on who
 * captured it. Applied repeatedly, because loggers stack: "[12:00:01] error Error: x".
 */
const LOG_PREFIXES: RegExp[] = [
  // ISO and Go-style timestamps, bracketed or bare.
  /^[[(]?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?[\])]?\s*/i,
  /^[[(]?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?[\])]?\s*/,
  // docker compose: "api-1  | ", "db_1 | ". Needs the numeric suffix, so a compiler's
  // "12 |  let x" source gutter is left for isFrame to recognise.
  /^[a-z][\w.-]*[-_]\d+\s*\|\s+(?=\S)/i,
  // Spring Boot: "12345 --- [main] o.s.b.SpringApplication : " after the level.
  /^\d+\s+---\s+\[[^\]]*\]\s+\S+\s*:\s*(?=\S)/,
  /^error\s+in\s+(?=\S)/i,
  /^\[?(?:error|err|warn|warning|info|debug|fatal|trace|critical|crit)\]?(?=\s|:|$)[:\s-]*(?=\S)/i,
];

export function cleanLine(line: string): string {
  let out = line.replace(ANSI, "").trim();
  for (let pass = 0; pass < 3; pass++) {
    const before = out;
    for (const prefix of LOG_PREFIXES) out = out.replace(prefix, "").trim();
    if (out === before) break;
  }
  return out;
}

/* -- extraction: which line IS the error ----------------------------------- */

/** Lines that are the shape of a stack, not the shape of a failure. */
function isFrame(line: string): boolean {
  return (
    /^(at\s|file\s+"|from\s|\.\.\.|caused by:?$|in\s+<module>|\s*\^+\s*$|\|\s|-->\s|node:internal\/|throw\s+new\s)/i.test(line) ||
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
  // docker build's wrapper around whatever the RUN step printed.
  /^(error:?\s*)?failed to solve\b/i,
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
    .map(cleanLine)
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
    // A prefix that carries a code — rustc's `error[E0382]:` — is the one part of it that
    // identifies the failure. Stripping the prefix used to strip the code with it.
    const code = prefix.match(/\[([A-Z]+\d+)\]/)?.[1];
    if (code) block.unshift(code);
    // Two lines: the code and the sentence. The third line of an npm block is "While
    // resolving: <your-app>@<version>", which made every project a different failure.
    if (block.length > 0) return block.slice(0, 2).join(" ");
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
  // A source file with a line after it is where the error was raised, not what it is:
  // src/a.ts:12:9, lib/pay.rb:12:in, main.go:40. The same TS2307 in two files is one
  // failure, so the whole position collapses to one placeholder that the tokenizer drops.
  [
    /(?:[a-z]:)?[\\/]?(?:[\w.-]+[\\/])*[\w-]+\.(?:tsx?|m?jsx?|cjs|py|rb|go|rs|java|kt|cs|php|exs?|scala|swift|cc?|cpp|hpp?|dart|lua|pl|sh|vue|svelte)(?:(?::\d+)+(?::in)?|\(\d+,\d+\))/gi,
    "<src>",
  ],
  // Absolute paths, Windows and POSIX. The basename survives: "cannot find module ./foo"
  // and "./bar" are different failures, but the directories above them are noise.
  [/[a-z]:\\(?:[^\s\\'"]+\\)*([^\s\\'"]*)/gi, "<path>/$1"],
  [/(?:\/[^\s/'"]+){2,}\/([^\s/'":,)]*)/g, "<path>/$1"],
  // Kubernetes pod names carry a replica-set hash and a pod hash. The deployment name
  // is the identity; the hashes made every restart of the same pod a new failure.
  [/\b([a-z][a-z0-9-]*?)-[0-9a-f]{8,10}-[a-z0-9]{5}(?![a-z0-9-])/g, "$1-<pod>"],
  // Relative paths: two or more segments, or one segment with a file-like basename.
  // A scoped npm package (@scope/name) is not a path and keeps its slash.
  [/(?<![@\w<>./\\-])(?:\.{1,2}\/)?(?:[\w.-]+\/){2,}([\w.-]*)/g, "<path>/$1"],
  [/(?<![@\w<>./\\-])(?:\.{1,2}\/)?[\w.-]+\/([\w-]+\.[\w.]+)/g, "<path>/$1"],
  // "require() of ES Module X from Y": Y is the file that did the requiring — a location.
  [/\bfrom <path>\/\S+/g, "from <src>"],
  // kubectl's ages and restart ratios: "0/1  CrashLoopBackOff  12 (3m ago)  6m".
  [/\b\d+\/\d+\b/g, "<ratio>"],
  [/\b\d+(?:\.\d+)?[smhd]\b/g, "<dur>"],
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

/**
 * Letters to their bare shape: ş→s, ğ→g, ü→u, ı→i, and so on. Two agents type the same
 * Turkish word with and without its diacritics, and an error message localised into a
 * language with accents should still key the same as one pasted without them. Applied
 * before tokenising, never to what is stored or shown.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i")
    .toLowerCase();
}

export function normalizeError(raw: string): string {
  let text = fold(raw.split(/\r?\n/).map(cleanLine).join("\n"));
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
  // Question filler. It also appears in error prose ("Did you mean …?") and carries
  // nothing there either.
  "how", "do", "does", "did", "my", "our", "your", "we", "you", "me", "when", "why",
  "what", "which", "where", "should", "can", "could", "would", "will", "any", "some",
  "help", "into", "about", "like", "just", "also", "so", "if", "then", "there", "here",
]);

/** How many meaningful tokens of the error decide identity. */
const SIGNATURE_TOKENS = 12;

/**
 * Punctuation glued to a word by the tokenizer. "supported." and "supported" were two
 * tokens, and "error:" slipped past the noise list because of its colon.
 */
const EDGE_PUNCTUATION = /^[.,:;'"`()[\]{}]+|[.,:;'"`()[\]{}]+$/g;

/** A scrubber placeholder standing alone says nothing about which failure this is. */
const PLACEHOLDER_ONLY = /^<[a-z]+>$/;

function failureTokens(raw: string): string[] {
  const seen = new Set<string>();
  for (const piece of normalizeError(errorHeadline(raw)).split(/[^\p{L}\p{N}<>_./@:-]+/u)) {
    const token = piece.replace(EDGE_PUNCTUATION, "");
    if (token.length < 2 || NOISE.has(token) || PLACEHOLDER_ONLY.test(token)) continue;
    if (!seen.has(token)) seen.add(token);
    if (seen.size >= SIGNATURE_TOKENS) break;
  }
  return [...seen];
}

/* -- questions: the other thing an agent asks before it researches ---------- */

export type ProblemKind = "failure" | "question";

/** Words that make a line an error report, whatever else it says. */
// Tested against folded text (see fold): diacritics gone, lower case. The Turkish words
// are therefore written without their diacritics here.
const FAILURE_MARKERS =
  /\b(error|exception|traceback|panic|fatal|failed|failure|refused|denied|timeout|timed out|crash(?:ed|es)?|segfault|killed|unhandled|not found|cannot|can't|couldn't|unable to|invalid|exit(?:ed)? (?:with )?(?:code|status)|hata|hatasi|calismiyor|calismaz|basarisiz|cokuyor|coktu|patliyor|patladi|reddedildi|bulunamadi|bulunamiyor|zaman asimi|takildi|kilitlendi|olmuyor|acilmiyor|baglanamiyor|yuklenemedi|derlenemedi)\b/i;
const QUESTION_OPENERS =
  /^\s*(?:how|what|what's|whats|why|which|where|when|can|could|should|is|are|does|do|will|would|any|best|recommended|nasil|neden|niye|nicin|ne|hangi|hangisi|nerede|nereye|nereden|kim|kac|mumkun)\b/i;
const QUESTION_MARKERS =
  /\?\s*$|\bhow to\b|\bbest way\b|\bdifference between\b|\bshould i\b|\brecommended\b|\bvs\.?\b|\bversus\b|\bnasil\b|\bmumkun\b|\bnedir\b|\bfarki\b|\bolur mu\b|\byapabilir\b|\b(?:mi|mu)\b/i;

/**
 * Failure or question. An error has the shape of an error — a frame, a carrier line, a
 * marker word, a code that identifies itself — and anything with that shape is keyed as
 * one, however it is phrased. What is left is a question if it reads like one. Short
 * bare text with neither shape stays a failure: "CrashLoopBackOff" is not a question.
 */
export function classify(raw: string): ProblemKind {
  const lines = raw.split(/\r?\n/).map(cleanLine).filter(Boolean);
  if (lines.length === 0) return "failure";
  if (lines.some(isFrame) || lines.some(isCarrier)) return "failure";
  const text = fold(lines.join(" "));
  if (FAILURE_MARKERS.test(text)) return "failure";
  if (hasSelfIdentifier(raw, failureTokens(raw))) return "failure";
  if (QUESTION_OPENERS.test(fold(lines[0])) || QUESTION_MARKERS.test(text)) return "question";
  return "failure";
}

/**
 * What a question is about, stripped of how it was asked. "How do I set up a custom
 * Express server in Next.js?" and "next.js custom express server setup" are one question;
 * keyed on word order they were two, and the second asker never saw the first answer.
 */
const QUESTION_FILLER = new Set([
  "how", "do", "does", "did", "i", "im", "i'm", "we", "you", "me", "my", "our", "your",
  "the", "a", "an", "to", "in", "on", "of", "for", "with", "is", "are", "be", "been",
  "can", "could", "should", "would", "will", "what", "what's", "whats", "why", "which",
  "where", "when", "it", "this", "that", "these", "those", "and", "or", "vs", "versus",
  "best", "way", "properly", "correctly", "right", "need", "want", "get", "make", "set",
  "up", "use", "using", "used", "configure", "configuring", "setup", "setting", "work",
  "working", "works", "between", "difference", "there", "any", "some", "please", "help",
  "into", "from", "at", "by", "about", "like", "so", "just", "also", "without", "if",
  "then", "am", "have", "has", "had", "possible", "recommended", "know", "tell", "find",
  // Turkish, folded (no diacritics): question words, particles, and the verbs a
  // how-do-I is asked with. Content words — sunucu, veritabani — stay.
  "nasil", "neden", "niye", "nicin", "ne", "hangi", "hangisi", "nerede", "nereye",
  "nereden", "kim", "kac", "bir", "bu", "su", "o", "ve", "veya", "ya", "da", "de", "ile",
  "icin", "mi", "mu", "misin", "miyim", "gibi", "kadar", "ama", "fakat", "cok", "en",
  "iyi", "dogru", "sekilde", "yapabilir", "yapabilirim", "yaparim", "yapmak", "yapilir",
  "yapiyorum", "yapsam", "kurmak", "kurarim", "kurulum", "kurulumu", "kurabilir",
  "kurulur", "ayarlamak", "ayarlarim", "ayar", "ayari", "ayarlari", "kullanmak",
  "kullanirim", "kullanabilir", "kullanilir", "istiyorum", "lazim", "gerekir",
  "gerekiyor", "gerekli", "var", "yok", "olur", "olmasi", "nedir", "neyi", "oluyor",
  "olacak", "ediyor", "etmek", "edilir", "edebilir", "eklemek", "eklerim", "eklenir",
  "calistirmak", "calisir", "onerilen", "hakkinda", "uzerinde", "uzerine", "icinde",
  "sonra", "once", "zaman", "hala", "tekrar", "yine", "sadece", "mesela", "ornegin",
  // Case suffixes that follow an apostrophe — Next.js'te, Docker'da — and so split off.
  "te", "ta", "nin", "nun", "ye", "yi", "yu", "le", "la", "yle", "yla", "den", "dan",
  "ten", "tan", "deki", "daki", "teki", "taki", "ndeki", "ndaki", "nde", "nda",
]);

/** A light singular, so "migrations" and "migration" are one word. Never touches short words or -ss/-us/-js endings. */
function singular(token: string): string {
  if (token.length > 4 && /[a-z]s$/.test(token) && !/(?:ss|us|is|js|os)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

function questionTokens(raw: string): string[] {
  const line = fold(cleanLine(raw.split(/\r?\n/).find((l) => l.trim()) ?? ""));
  const seen = new Set<string>();
  for (const piece of line.split(/[^\p{L}\p{N}<>_./@:+#-]+/u)) {
    const token = piece.replace(EDGE_PUNCTUATION, "");
    if (token.length < 2 || QUESTION_FILLER.has(token) || NOISE.has(token)) continue;
    seen.add(singular(token));
  }
  return [...seen].sort().slice(0, 10);
}

/** The tokens that decide identity — by the rules of the kind the text is. */
export function signatureTokens(raw: string): string[] {
  return classify(raw) === "question" ? questionTokens(raw) : failureTokens(raw);
}

/**
 * The parts of a failure that a meaning model reads past.
 *
 * Measured on the embedding this store uses: "connect ECONNREFUSED 127.0.0.1:5432" and the
 * same line with :6379 score 0.88 to each other — higher than the same 5432 failure
 * described in Turkish scores against its English original. Meaning finds the language;
 * it does not hear the port. So before a neighbour found by meaning is called the same
 * failure, the hard identifiers in the asker's text — errno names, error classes, quoted
 * names, ports and codes — must all appear in the candidate's. Everything else may differ.
 */
export function identityTokens(raw: string): string[] {
  const out = new Set<string>();
  for (const m of raw.matchAll(/\bE[A-Z]{4,}\b/g)) out.add(m[0].toLowerCase());
  for (const m of fold(raw).matchAll(/['"`]([^'"`\s]{2,60})['"`]/g)) out.add(m[1].replace(EDGE_PUNCTUATION, ""));
  for (const token of failureTokens(raw)) {
    if (
      selfIdentifying(token) ||
      /^<ip>:\d+$/.test(token) ||
      /^\d{3,}$/.test(token) ||
      (/(?:error|exception|warning)$/.test(token) && token.length > 7)
    ) {
      out.add(token);
    }
  }
  return [...out].sort();
}

/** Whether every hard identifier in the asker's text is present in a candidate's. */
export function identityAgrees(query: string, candidate: string): boolean {
  const mine = identityTokens(query);
  if (mine.length === 0) return false;
  const theirs = new Set(identityTokens(candidate));
  return mine.every((t) => theirs.has(t));
}

/**
 * Tokens that name a failure on their own. Three tokens is the floor for prose, because
 * "connection refused" is true of everything; but "CrashLoopBackOff" or "ECONNREFUSED"
 * is a whole diagnosis in one word, and refusing it sent agents away with the one error
 * they were most likely to paste. Errno names, Node error codes, Kubernetes states,
 * compiler codes (TS2307, E0382, ORA-00933) and SQLSTATEs qualify.
 */
const SELF_IDENTIFYING: RegExp[] = [
  /^err_[a-z0-9_]+$/,
  /^[a-z]+(?:backoff|error|exception|killed|pull|creating|terminating|notready|exceeded|denied|refused|mismatch|timeout|unavailable)$/,
  /^[a-z]{1,5}-?\d{3,6}$/,
  /^(?:sqlstate)?[0-9]{2}[0-9a-z]{3}$/,
  /^[45]\d\d$/,
];

export function selfIdentifying(token: string): boolean {
  return token.split(":").some((part) => SELF_IDENTIFYING.some((p) => p.test(part)));
}

/**
 * Errno names — ECONNREFUSED, EADDRINUSE, ENOENT, ERESOLVE — are upper-case in the wild,
 * and that is the only thing that tells them from "express" or "enable" once a token has
 * been lower-cased. So they are looked for in the text as written.
 */
const ERRNO = /\bE[A-Z]{4,}\b/;

function hasSelfIdentifier(raw: string, tokens: string[]): boolean {
  return ERRNO.test(raw) || tokens.some(selfIdentifying);
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
  if (classify(raw) === "question") {
    return questionTokens(raw).length < 2
      ? "too little to identify this question — name the technology and what you are trying to do"
      : null;
  }
  if (isCarrier(headline)) {
    return "this line reports that something failed without saying what — include the error itself, not just the exit status";
  }
  const tokens = signatureTokens(raw);
  if (tokens.length < 3 && !hasSelfIdentifier(raw, tokens)) {
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
export const FINGERPRINT_VERSION = 4;

export async function fingerprint(raw: string): Promise<string> {
  const tokens = signatureTokens(raw);
  const basis = tokens.length > 0 ? tokens.join(" ") : normalizeError(raw);
  // Questions and failures live in separate key spaces, so the same words as an error
  // and as a question never collide.
  const space = classify(raw) === "question" ? "q|" : "";
  return (await sha256Hex(`v${FINGERPRINT_VERSION}|${space}${basis}`)).slice(0, 16);
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
