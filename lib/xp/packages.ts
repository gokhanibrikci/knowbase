/**
 * Checking that a package a report tells you to install actually exists.
 *
 * The most profitable thing to write into a store like this is not a destructive
 * command — it is a package name. A plausible fix for a real, high-traffic failure
 * that says "add @some/plausible-polyfill" is indistinguishable from the true fix:
 * the flag is real, the version is real, the failure mode is real, and the package
 * was published that morning. Nothing visibly breaks, so nobody ever reports it as
 * failed, and the poison never self-corrects.
 *
 * Nothing here judges or blocks. It asks the registry two questions — does this exist,
 * and how old is it — stores the answer on the solution, and hands it to the reader
 * verbatim. A package first published three days ago, offered as the fix for a failure
 * that is a year old, is self-evidently wrong to anyone who is looking at that fact
 * instead of skimming past it in a paragraph.
 */

export type Ecosystem = "npm" | "pypi" | "crates" | "go" | "rubygems" | "other";

export type PackageRef = { name: string; ecosystem: Ecosystem };

export type PackageFact = {
  name: string;
  ecosystem: Ecosystem;
  /** null when the registry could not be reached — absent evidence, not evidence of absence. */
  exists: boolean | null;
  firstPublished: string | null;
  repository: string | null;
  checkedAt: string;
};

/**
 * Words that end the list of packages. Without these, "npm install foo and re-deploy"
 * files "re-deploy" as a package that does not exist — and a warning that fires on a
 * word nobody was ever asked to install is worse than no warning at all, because it
 * teaches the reader to ignore the real ones.
 */
const CONNECTORS = new Set([
  "and", "then", "or", "to", "in", "for", "with", "from", "also", "plus", "but", "so",
  "if", "after", "before", "again", "instead", "as", "at", "on", "the", "a", "an",
  "this", "that", "it", "your", "my", "we", "you", "i",
]);

const INSTALLERS: [RegExp, Ecosystem][] = [
  [/\b(?:npm\s+(?:i|install|add)|pnpm\s+(?:i|install|add)|yarn\s+add|bun\s+(?:add|install))\s+((?:[-@\w./:^~=<>*]+\s+){0,5}[-@\w./:^~=<>*]+)/gi, "npm"],
  [/\b(?:pip3?\s+install|poetry\s+add|uv\s+(?:pip\s+install|add))\s+((?:[-\w.\[\]^~=<>!]+\s+){0,5}[-\w.\[\]^~=<>!]+)/gi, "pypi"],
  [/\bcargo\s+add\s+((?:[-\w.]+\s+){0,5}[-\w.]+)/gi, "crates"],
  [/\bgo\s+get\s+((?:[-\w./@]+\s+){0,5}[-\w./@]+)/gi, "go"],
  [/\bgem\s+install\s+((?:[-\w.]+\s+){0,5}[-\w.]+)/gi, "rubygems"],
  // No tool named, but the shape is unmistakable: a scope, or a pinned version.
  [/\binstall\s+(@[-\w.]+\/[-\w.]+(?:@[\w.^~<>=-]+)?|[-\w.]+@[\d][\w.^~<>=-]*)/gi, "npm"],
];

/** Flags are not packages, and neither is a bare version range. */
function cleanName(raw: string, ecosystem: Ecosystem): string | null {
  let name = raw.trim().replace(/[,;)\]."']+$/, "");
  if (!name || name.startsWith("-")) return null;
  // Strip a version specifier without eating a scope: @scope/pkg@1.2 -> @scope/pkg
  if (ecosystem === "npm") {
    const at = name.lastIndexOf("@");
    if (at > 0) name = name.slice(0, at);
  } else {
    name = name.split(/[[<>=!~^]/)[0];
  }
  name = name.trim();
  if (!name || name.length > 120) return null;
  if (!/^[@\w][-\w./]*$/.test(name)) return null;
  // A lone word that is obviously a subcommand rather than a package.
  if (/^(?:install|add|get|the|it|them|this|and|or|then)$/i.test(name)) return null;
  return name;
}

export function packageRefs(text: string): PackageRef[] {
  const found = new Map<string, PackageRef>();
  for (const [pattern, ecosystem] of INSTALLERS) {
    for (const match of text.matchAll(pattern)) {
      for (const raw of match[1].split(/\s+/)) {
        const token = raw.trim();
        if (!token) continue;
        // Flags sit between the verb and the names; skip past them.
        if (token.startsWith("-")) continue;
        // The first word that is not a package ends the list. Skipping instead of
        // stopping is what turned "install foo and re-deploy" into two packages.
        if (CONNECTORS.has(token.toLowerCase().replace(/[^a-z-]/g, ""))) break;
        const name = cleanName(token, ecosystem);
        if (!name) break;
        const key = `${ecosystem}:${name}`;
        if (!found.has(key)) found.set(key, { name, ecosystem });
        if (found.size >= 8) return [...found.values()];
      }
    }
  }
  return [...found.values()];
}

async function fetchJson(url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal, headers: { accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error("unreachable");
  }
}

async function checkOne(ref: PackageRef, signal: AbortSignal): Promise<PackageFact> {
  const base: PackageFact = {
    name: ref.name,
    ecosystem: ref.ecosystem,
    exists: null,
    firstPublished: null,
    repository: null,
    checkedAt: new Date().toISOString().slice(0, 10),
  };

  try {
    if (ref.ecosystem === "npm") {
      const doc = await fetchJson(
        `https://registry.npmjs.org/${ref.name.split("/").map(encodeURIComponent).join("/")}`,
        signal,
      );
      if (!doc) return { ...base, exists: false };
      const time = doc.time as Record<string, string> | undefined;
      const repo = doc.repository as { url?: string } | undefined;
      return {
        ...base,
        exists: true,
        firstPublished: time?.created?.slice(0, 10) ?? null,
        repository: repo?.url ?? null,
      };
    }

    if (ref.ecosystem === "pypi") {
      const doc = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(ref.name)}/json`, signal);
      if (!doc) return { ...base, exists: false };
      const releases = doc.releases as Record<string, { upload_time?: string }[]> | undefined;
      const info = doc.info as { project_urls?: Record<string, string>; home_page?: string } | undefined;
      const earliest = Object.values(releases ?? {})
        .flat()
        .map((f) => f?.upload_time)
        .filter((t): t is string => Boolean(t))
        .sort()[0];
      return {
        ...base,
        exists: true,
        firstPublished: earliest?.slice(0, 10) ?? null,
        repository: info?.project_urls?.Source ?? info?.home_page ?? null,
      };
    }

    if (ref.ecosystem === "crates") {
      const doc = await fetchJson(`https://crates.io/api/v1/crates/${encodeURIComponent(ref.name)}`, signal);
      if (!doc) return { ...base, exists: false };
      const crate = doc.crate as { created_at?: string; repository?: string } | undefined;
      return {
        ...base,
        exists: true,
        firstPublished: crate?.created_at?.slice(0, 10) ?? null,
        repository: crate?.repository ?? null,
      };
    }

    // Registries we do not query. Say so rather than implying a check happened.
    return base;
  } catch {
    return base;
  }
}

/**
 * Checked once, at write time, and stored — so the read path stays a single database
 * query and no reader ever waits on a registry. `firstPublished` is immutable, which is
 * the fact that actually matters; the check date travels with it so nothing pretends to
 * be fresher than it is.
 */
export async function checkPackages(text: string): Promise<PackageFact[]> {
  const refs = packageRefs(text);
  if (refs.length === 0) return [];

  // A slow registry must not hold up an agent's report.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    return await Promise.all(refs.map((ref) => checkOne(ref, controller.signal)));
  } finally {
    clearTimeout(timer);
  }
}

/* -- what the reader is told ------------------------------------------------ */

/** Levenshtein, bounded: only used against names the reader already told us it has. */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

export type PackageWarning = { name: string; concern: string };

/**
 * Turn the stored facts into the two sentences a reader should actually see, given its
 * own environment. Everything here is a statement of fact about the registry, not a
 * verdict about the report.
 */
export function packageWarnings(
  facts: PackageFact[],
  environmentNames: string[],
  now: number,
): PackageWarning[] {
  const warnings: PackageWarning[] = [];
  for (const fact of facts) {
    if (fact.exists === false) {
      warnings.push({
        name: fact.name,
        concern: `not published on ${fact.ecosystem} when this was checked (${fact.checkedAt}) — do not install it`,
      });
      continue;
    }
    if (fact.exists === null) {
      warnings.push({ name: fact.name, concern: "not checked against a registry" });
      continue;
    }
    if (fact.firstPublished) {
      const ageDays = Math.floor((now - Date.parse(fact.firstPublished)) / 86_400_000);
      if (ageDays < 90) {
        warnings.push({
          name: fact.name,
          concern: `first published ${fact.firstPublished}, ${ageDays} days before you read this — a new package offered as the fix for an older failure is worth a second look`,
        });
      }
    }
    // A name one or two characters away from something the reader already depends on.
    for (const own of environmentNames) {
      if (own === fact.name) continue;
      if (editDistance(own, fact.name) <= 2) {
        warnings.push({
          name: fact.name,
          concern: `one or two characters away from "${own}", which you already have — check you are installing the one you mean`,
        });
        break;
      }
    }
  }
  return warnings;
}
