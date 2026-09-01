import type { Metadata } from "next";
import Link from "next/link";

import { KoList } from "@/components/ko/ko-list";
import { Section, Tag, type Tone } from "@/components/ko/parts";
import {
  isPlaceholderQuery,
  matchKnowledgeObjects,
  presentableMatchResults,
  type MatchVerdict,
} from "@/lib/ko/match";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { AGENT_INPUT_LIMITS } from "@/lib/mcp/contract";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Search",
  // Result pages are permutations of content that already has canonical URLs.
  robots: { index: false, follow: true },
};

const MATCH_TONE: Record<MatchVerdict, Tone> = {
  strong: "ok",
  partial: "warn",
  none: "bad",
};

const MATCH_GUIDANCE: Record<MatchVerdict, string> = {
  strong:
    "One entry clearly covers this error. Check its Not Applicable To section before acting.",
  partial:
    "No entry clearly covers this query. These are related leads, not answers; verify their scope or search elsewhere before acting.",
  none: "Knowbase does not cover this error yet. No near match is shown on purpose.",
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const raw = params.q;
  const query = ((Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "").slice(
    0,
    AGENT_INPUT_LIMITS.queryCharacters,
  );

  const all = getAllKnowledgeObjects();
  const placeholder = query ? isPlaceholderQuery(query) : false;
  const report = query && !placeholder ? matchKnowledgeObjects(all, query) : null;
  const results = report
    ? presentableMatchResults(report, 5).map((result) => result.ko)
    : [];

  const sectionTitle = !query
    ? "Search"
    : placeholder
      ? "Invalid query"
      : report?.verdict === "strong"
        ? "Best match"
        : report?.verdict === "partial"
          ? "Related leads — not answers"
          : "No matching knowledge object";

  const sectionHint = !query
    ? "enter a query above"
    : placeholder
      ? "replace the placeholder with an actual error"
      : report?.verdict === "strong"
        ? "1 verified knowledge object"
        : report?.verdict === "partial"
          ? `${results.length} leads shown · ${all.length} searched`
          : `${all.length} knowledge objects searched`;

  return (
    <div className="pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-dim">
        <Link href="/" className="hover:text-accent">
          {site.name}
        </Link>
        <span className="mx-2 text-ink-faint">&gt;</span>
        <span className="text-ink">search</span>
      </nav>

      <h1 className="mt-5 text-2xl text-ink-bright">
        <span className="select-none text-accent-soft"># </span>
        {query ? `"${query}"` : "Search"}
      </h1>

      {report ? (
        <div className="mt-5 border border-rule bg-panel px-4 py-3 text-sm" role="status">
          <p>
            <Tag tone={MATCH_TONE[report.verdict]}>match: {report.verdict}</Tag>
            <span className="ml-3 text-ink">{MATCH_GUIDANCE[report.verdict]}</span>
          </p>
          {report.unmatchedTerms.length > 0 ? (
            <p className="mt-2 text-xs text-ink-dim">
              <span className="text-ink-faint">not covered by this corpus: </span>
              {report.unmatchedTerms.slice(0, 8).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <Section
        id="results"
        title={sectionTitle}
        hint={sectionHint}
      >
        {placeholder ? (
          <div className="border border-rule bg-panel px-4 py-6 text-sm">
            <p className="text-ink">
              This looks like an unsubstituted placeholder, not an error message.
            </p>
          </div>
        ) : results.length > 0 ? (
          <KoList objects={results} />
        ) : (
          <div className="border border-rule bg-panel px-4 py-6 text-sm">
            <p className="text-ink">
              {query
                ? MATCH_GUIDANCE.none
                : "Search by error text, error code, or technology."}
            </p>
            <p className="mt-2 text-ink-dim">
              The corpus is small and deliberately so — an entry ships only once its claims are
              backed by primary sources.{" "}
              <Link href="/library" className="text-accent hover:text-ink-bright">
                Browse the full index
              </Link>
              .
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
