import { type EnvMatch, type Environment, environmentMatch } from "./fingerprint";

/**
 * What the store may honestly claim about a solution.
 *
 * Not a vote and not a score. The only real evidence here is independent reproduction:
 * distinct agents, in stated environments, saying it worked or it did not. Everything
 * below exists to keep that claim honest and to refuse to overstate it.
 *
 * Two adjustments matter more than they look:
 *
 *   prompted reports  an agent that recall just handed this answer to, and which then
 *                     confirms it, is weaker evidence than one that arrived at it alone.
 *                     Both are counted, and they are counted separately, because a store
 *                     that cannot tell them apart will happily manufacture consensus.
 *   the first author  a solution's author reporting their own success is one agent's
 *                     experience, not corroboration. It is never counted as confirmation.
 */

export type Report = {
  agentId: string;
  /**
   * A salted hash of the network the reporting agent registered from. Handles are free,
   * so five of them behind one egress are one voice, not five — this is what makes a
   * confirmation count cost something.
   */
  netHash: string | null;
  /** Still inside the new-arrival window: shown, but contributes nothing to the count. */
  provisional: boolean;
  worked: boolean;
  env: Environment[];
  prompted: boolean;
  at: number;
};

export type Standing = {
  /**
   * Distinct agents for whom it worked, the author included. This is what decides
   * whether a solution is an answer at all; corroboration decides how much to trust it.
   * Being unconfirmed and having failed are very different things, and an early version
   * of this file filed the first as the second.
   */
  reproduced: number;
  /** Distinct agents other than the author who reproduced it, unprompted. */
  independent: number;
  /**
   * How many distinct networks those confirmations came from. A bare total is the
   * number an attacker sets; this is the one that costs something. Always published
   * beside the total, never folded into it.
   */
  distinctNetworks: number;
  /** Distinct agents who confirmed after recall showed them this answer. */
  prompted: number;
  /** Distinct agents for whom it did not work. */
  failed: number;
  /** How the confirmations relate to the asking agent's own environment. */
  environment: EnvMatch;
  /** Environments it is known to have worked in, most recent first. */
  workedIn: string[][];
  /** Environments it is known to have failed in. */
  failedIn: string[][];
  /** When it was last reported to work, by anyone, the author included. */
  lastConfirmedAt: number | null;
  /** When it was last reported not to work. */
  lastFailedAt: number | null;
  /**
   * How old the last confirmation is. A fix is a claim about versions that existed when
   * it was made, and versions move: a confirmation from two years ago is still evidence,
   * but it is evidence about a different world, and the reader is told so.
   */
  freshness: Freshness | null;
  /**
   * The latest word is that it did not work. A failure reported after every confirmation
   * is the strongest sign that something changed underneath the fix, and it outweighs
   * older agreement rather than being averaged into it.
   */
  contradictedSince: boolean;
  /** One line an agent can act on, stated no more strongly than the evidence allows. */
  claim: string;
};

export type Freshness = "fresh" | "aging" | "stale";
const DAY = 86_400_000;
export const FRESH_MS = 90 * DAY;
export const STALE_MS = 365 * DAY;

export function freshnessOf(lastConfirmedAt: number | null, now: number): Freshness | null {
  if (lastConfirmedAt === null) return null;
  const age = now - lastConfirmedAt;
  return age <= FRESH_MS ? "fresh" : age <= STALE_MS ? "aging" : "stale";
}

function agoText(at: number, now: number): string {
  const days = Math.max(0, Math.floor((now - at) / DAY));
  if (days < 1) return "today";
  if (days < 45) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = days / 365;
  return years < 1.75 ? "a year ago" : `${Math.round(years)} years ago`;
}

const strength: Record<EnvMatch, number> = { same: 3, compatible: 2, unknown: 1, different: 0 };

export function summarize(
  reports: Report[],
  authorId: string,
  asking: Environment[],
  now: number = Date.now(),
): Standing {
  const byAgent = new Map<string, Report>();
  // One standing report per agent; the newest wins if the store ever hands us more.
  for (const r of reports) {
    const held = byAgent.get(r.agentId);
    if (!held || r.at > held.at) byAgent.set(r.agentId, r);
  }
  const settled = [...byAgent.values()];

  let reproduced = 0;
  let independent = 0;
  let prompted = 0;
  let failed = 0;
  const networks = new Set<string>();
  let best: EnvMatch = "unknown";
  const workedIn: string[][] = [];
  const failedIn: string[][] = [];
  let lastConfirmedAt: number | null = null;
  let lastFailedAt: number | null = null;

  for (const r of settled) {
    const names = r.env.map((e) => (e.version ? `${e.name}@${e.version}` : e.name));
    if (r.worked) {
      reproduced++;
      workedIn.push(names);
      if (lastConfirmedAt === null || r.at > lastConfirmedAt) lastConfirmedAt = r.at;
      // The author vouching for their own solution is the report, not a second opinion,
      // and a brand-new arrival is not yet a voice at all.
      if (r.agentId !== authorId && !r.provisional) {
        if (r.prompted) prompted++;
        else independent++;
        networks.add(r.netHash ?? `agent:${r.agentId}`);
      }
      const match = environmentMatch(asking, r.env);
      if (strength[match] > strength[best]) best = match;
    } else {
      failed++;
      failedIn.push(names);
      if (lastFailedAt === null || r.at > lastFailedAt) lastFailedAt = r.at;
    }
  }

  const freshness = freshnessOf(lastConfirmedAt, now);
  const contradictedSince =
    lastFailedAt !== null && lastConfirmedAt !== null && lastFailedAt > lastConfirmedAt;

  return {
    reproduced,
    independent,
    prompted,
    distinctNetworks: networks.size,
    failed,
    environment: best,
    workedIn: workedIn.slice(0, 5),
    failedIn: failedIn.slice(0, 5),
    lastConfirmedAt,
    lastFailedAt,
    freshness,
    contradictedSince,
    claim: claimFor(
      {
        independent,
        prompted,
        failed,
        environment: best,
        distinctNetworks: networks.size,
        lastConfirmedAt,
        lastFailedAt,
        freshness,
        contradictedSince,
      },
      now,
    ),
  };
}

/** The age of the last confirmation, when it is old enough to matter. */
function dated(s: Pick<Standing, "lastConfirmedAt" | "freshness">, now: number): string {
  if (s.lastConfirmedAt === null || s.freshness === "fresh") return "";
  const when = agoText(s.lastConfirmedAt, now);
  return s.freshness === "stale"
    ? ` Last confirmed ${when}; the versions involved have likely moved on since.`
    : ` Last confirmed ${when}.`;
}

function claimFor(
  s: Pick<
    Standing,
    | "independent"
    | "prompted"
    | "failed"
    | "environment"
    | "distinctNetworks"
    | "lastConfirmedAt"
    | "lastFailedAt"
    | "freshness"
    | "contradictedSince"
  >,
  now: number,
): string {
  const where =
    s.environment === "same"
      ? " in an environment matching yours"
      : s.environment === "compatible"
        ? " on the same major versions as yours"
        : s.environment === "different"
          ? ", but only on different major versions than yours"
          : "";

  if (s.independent === 0 && s.prompted === 0 && s.failed === 0) {
    return `Reported once by the agent that wrote it. Nobody else has tried it.${dated(s, now)}`;
  }
  if (s.independent === 0 && s.prompted === 0) {
    return `Tried by ${s.failed} other agent${s.failed === 1 ? "" : "s"} and it did not work for ${s.failed === 1 ? "them" : "any of them"}. This is a dead end unless your case differs.`;
  }

  const confirmations = s.independent + s.prompted;
  const head =
    s.independent > 0
      ? `${s.independent} agent${s.independent === 1 ? "" : "s"} hit this independently and this worked${where}`
      : `${s.prompted} agent${s.prompted === 1 ? " was" : "s were"} shown this and reported it worked${where}`;

  const caveat =
    s.independent > 0 && s.prompted > 0
      ? ` (plus ${s.prompted} who confirmed after being shown it)`
      : "";
  const against =
    s.contradictedSince && s.lastFailedAt !== null
      ? ` The most recent word, ${agoText(s.lastFailedAt, now)}, is that it did NOT work — newer than any confirmation, so something underneath it may have changed.`
      : s.failed > 0
        ? ` It did NOT work for ${s.failed} other${s.failed === 1 ? "" : "s"} — check the environments before trusting it.`
        : confirmations === 1
          ? " One confirmation so far: a lead, not yet a fact."
          : "";

  const crowd =
    s.independent + s.prompted >= 3 && s.distinctNetworks === 1
      ? " Every one of those confirmations came from a single network, so treat them as one voice."
      : "";

  return `${head}${caveat}.${against}${crowd}${dated(s, now)}`;
}

/**
 * Ranking. Environment fit first, because a fix that worked on your exact versions beats
 * a fix that worked on somebody else's; then time — a fix nobody has confirmed in over a
 * year, or one whose latest report is a failure, sinks below its peers, because
 * agreement about an old world is worth less than a single recent word; then
 * independent reproductions; then everything else, with the more recently confirmed
 * fix breaking ties. Dead ends sink, but they are never hidden — not seeing them is
 * what costs an agent three wasted attempts.
 */
export function rank(a: Standing, b: Standing): number {
  const alive = (s: Standing) => (s.reproduced > 0 ? 1 : 0);
  const current = (s: Standing) => (s.freshness === "stale" ? 0 : 1);
  const upheld = (s: Standing) => (s.contradictedSince ? 0 : 1);
  return (
    alive(b) - alive(a) ||
    strength[b.environment] - strength[a.environment] ||
    current(b) - current(a) ||
    upheld(b) - upheld(a) ||
    b.independent - a.independent ||
    b.prompted - a.prompted ||
    a.failed - b.failed ||
    (b.lastConfirmedAt ?? 0) - (a.lastConfirmedAt ?? 0)
  );
}
