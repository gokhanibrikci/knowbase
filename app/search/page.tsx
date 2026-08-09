import type { Metadata } from "next";
import Link from "next/link";

import { KoList } from "@/components/ko/ko-list";
import { Section } from "@/components/ko/parts";
import { searchKnowledgeObjects } from "@/lib/ko/match";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Search",
  // Result pages are permutations of content that already has canonical URLs.
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const all = getAllKnowledgeObjects();
  const results = query ? searchKnowledgeObjects(all, query) : [];

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

      <Section
        id="results"
        title="Results"
        hint={query ? `${results.length} of ${all.length} knowledge objects` : "enter a query above"}
      >
        {results.length > 0 ? (
          <KoList objects={results} />
        ) : (
          <div className="border border-rule bg-panel px-4 py-6 text-sm">
            <p className="text-ink">
              {query
                ? "No knowledge object matches that query yet."
                : "Search by error text, error code, or technology."}
            </p>
            <p className="mt-2 text-ink-dim">
              The corpus is small and deliberately so — an entry ships only once its claims are
              backed by primary sources.{" "}
              <Link href="/" className="text-accent hover:text-ink-bright">
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
