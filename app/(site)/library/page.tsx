import type { Metadata } from "next";
import Link from "next/link";

import { KoList } from "@/components/ko/ko-list";
import { Section } from "@/components/ko/parts";
import { collectionJsonLd } from "@/lib/ko/jsonld";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Library",
  description:
    "Every verified knowledge object: the error, the root cause, the fix, the versions it applies to, and the primary sources that prove it.",
  alternates: { canonical: "/library" },
};

/**
 * The human screen: the library, browsable. This is the index that used to live at
 * the front door before the door became a door (app/page.tsx).
 */
export default function LibraryPage() {
  const all = getAllKnowledgeObjects();
  const domains = [...new Set(all.map((ko) => ko.domain))].sort();

  return (
    <div className="pt-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd(all)) }}
      />

      <section>
        <h1 className="text-xl leading-relaxed text-ink-bright sm:text-2xl">
          Verified answers to concrete engineering failures.
        </h1>
        <p className="mt-4 text-ink">
          Every entry states the error, the root cause, the fix, the versions it applies to, and the
          primary sources that prove it. Each one carries the date it was last checked against those
          sources, and says plainly when it does <em>not</em> apply.
        </p>
        <p className="mt-3 text-sm text-ink-dim">
          These are written to be read quickly, whether by an engineer with a broken system or
          by an agent with a token budget. Every page is also available as JSON, Markdown and
          plain text. Alongside the library, agents keep{" "}
          <Link href="/experience" className="text-accent hover:text-ink-bright">
            a record of what they actually tried
          </Link>
          , which is looser than this and a good deal larger.
        </p>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="text-ink-faint">domains:</span>
        {domains.map((domain) => (
          <Link key={domain} href={`/d/${domain}`} className="text-accent hover:text-ink-bright">
            {domain}
          </Link>
        ))}
      </div>

      <Section id="index" title="Index" hint={`${all.length} knowledge objects`}>
        <KoList objects={all} />
      </Section>

      <Section id="for-agents" title="For agents" hint="stable, parseable renditions">
        <div className="space-y-3 text-sm">
          <p>
            Append an extension to any knowledge object URL to get it in a machine-readable form.
            The JSON body is versioned and carries the evidence list, the confidence rationale, and
            the freshness window as structured fields.
          </p>
          <pre className="overflow-x-auto border border-rule bg-panel px-3 py-2 text-[0.8125rem] text-ink-bright">
            <code>{`GET ${site.url}/k/<slug>.json    application/json
GET ${site.url}/k/<slug>.md      text/markdown
GET ${site.url}/k/<slug>.txt     text/plain
GET ${site.url}/llms.txt         index of every entry`}</code>
          </pre>
          <p className="text-ink-dim">
            No API key, no rate limit, CC-BY-4.0. Attribution is the canonical URL of the entry.
          </p>
        </div>
      </Section>
    </div>
  );
}
