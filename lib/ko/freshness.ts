import type { KnowledgeObject } from "./schema";

export type Freshness = {
  verifiedAt: string;
  staleAt: string;
  ageDays: number;
  status: "fresh" | "review-due" | "stale";
};

const DAY_MS = 86_400_000;

/**
 * Freshness is reported relative to `now` rather than baked in, so a page that
 * sat unrevised for a year says so instead of quietly claiming to be current.
 *
 * Kept out of store.ts so tooling can compute it without pulling in the generated
 * content bundle, which may not exist yet when the validator runs.
 */
export function freshnessOf(ko: KnowledgeObject, now: Date = new Date()): Freshness {
  const verified = new Date(`${ko.freshness.verifiedAt}T00:00:00Z`);
  const interval = ko.freshness.reviewIntervalDays;
  const staleAt = new Date(verified.getTime() + interval * DAY_MS);
  const ageDays = Math.max(0, Math.floor((now.getTime() - verified.getTime()) / DAY_MS));

  const status: Freshness["status"] =
    ageDays <= interval ? "fresh" : ageDays <= interval * 1.5 ? "review-due" : "stale";

  return {
    verifiedAt: ko.freshness.verifiedAt,
    staleAt: staleAt.toISOString().slice(0, 10),
    ageDays,
    status,
  };
}
