import type { Metadata } from "next";
import Link from "next/link";

import { Section } from "@/components/ko/parts";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Method — how entries are produced and rated",
  description:
    "How knowbase builds a Knowledge Object: primary sources first, explicit evidence rules, stated confidence, and a verification date that expires.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  const objects = getAllKnowledgeObjects();

  return (
    <div className="pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-dim">
        <Link href="/" className="hover:text-accent">
          {site.name}
        </Link>
        <span className="mx-2 text-ink-faint">&gt;</span>
        <span className="text-ink">about</span>
      </nav>

      <h1 className="mt-5 text-2xl text-ink-bright">
        <span className="select-none text-accent-soft"># </span>
        Method
      </h1>
      <p className="mt-3 text-ink">
        {site.name} publishes {objects.length} Knowledge Objects. This page states how they are
        built and what the labels on them mean, so a reader — human or machine — can decide how much
        weight to give an answer.
      </p>

      <Section id="ko" title="What a Knowledge Object is">
        <div className="space-y-3 text-sm">
          <p>
            One concrete failure, resolved. Not a tutorial, not an overview, not a listicle. Each
            entry carries seven things, and an entry missing any of them does not publish:
          </p>
          <ol className="space-y-1 pl-1">
            {[
              "The error as it actually appears, plus the codes and phrasings people search for",
              "The problem in plain terms",
              "Root causes, ranked, each with a cheap test that tells you whether it is yours",
              "The fix, as ordered steps with real commands",
              "The exact technologies and version ranges it applies to",
              "The primary sources that prove it, and which claim each one backs",
              "The date it was last checked against those sources",
            ].map((item, i) => (
              <li key={i}>
                <span className="select-none text-ink-faint">{String(i + 1).padStart(2, "0")} </span>
                {item}
              </li>
            ))}
          </ol>
          <p>
            Entries also carry a <span className="text-ink-bright">Not Applicable To</span> section.
            Naming the near misses is what stops an answer from being applied to the wrong failure —
            the most expensive kind of wrong answer.
          </p>
        </div>
      </Section>

      <Section id="sourcing" title="How entries are sourced">
        <div className="space-y-3 text-sm">
          <p>
            Research starts from primary material and works outward, in this order: official
            documentation and specifications, then source code and enhancement proposals, then issue
            trackers and pull requests, then release notes, then vendor knowledge bases.
          </p>
          <p>
            Documentation-retrieval tooling is used to <em>locate</em> the right primary document
            quickly. Its output is never published. Every claim on this site is written after
            reading the original source, and the source is cited so you can check the reading
            yourself.
          </p>
          <p className="text-ink-dim">
            Reachability of every cited URL is machine-checked. A link that rots turns a verified
            claim back into an assertion, so it is treated as a defect rather than a cosmetic issue.
          </p>
        </div>
      </Section>

      <Section id="evidence" title="Evidence rules" hint="enforced at build time, not by convention">
        <div className="space-y-3 text-sm">
          <ul className="space-y-2">
            <li>
              <span className="text-ink-bright">Every entry cites at least one primary source</span>{" "}
              — official documentation, a specification, or source code. Blog posts and forum
              answers cannot carry an entry on their own.
            </li>
            <li>
              <span className="text-ink-bright">Each source states what it supports.</span> A
              citation that does not say which claim it backs is decoration.
            </li>
            <li>
              <span className="text-ink-bright">Confidence is gated by evidence.</span> A build fails
              if an entry claims more confidence than its sources justify.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="confidence" title="What the confidence labels mean">
        <div className="space-y-3 text-sm">
          <dl className="space-y-3">
            <div>
              <dt className="text-ok">high</dt>
              <dd className="text-ink-dim">
                Three or more sources, at least one primary. Every substantive claim traces to a
                document rather than to experience. Where a claim does not, the entry says so in its
                confidence note.
              </dd>
            </div>
            <div>
              <dt className="text-warn">medium</dt>
              <dd className="text-ink-dim">
                Two or more sources with a primary among them. The mechanism is documented; some
                specifics — thresholds, defaults, edge behaviour — rest on fewer sources.
              </dd>
            </div>
            <div>
              <dt className="text-bad">low</dt>
              <dd className="text-ink-dim">
                A single source, or a reproducible behaviour that documentation does not yet
                describe. Useful, but verify before acting on it in production.
              </dd>
            </div>
          </dl>
        </div>
      </Section>

      <Section id="freshness" title="Why entries expire">
        <div className="space-y-3 text-sm">
          <p>
            Technical knowledge decays at very different rates. A SQLSTATE code is stable for
            decades; a scheduler default changes between minor releases. Each entry therefore sets
            its own review interval, and the page reports its real age against that interval rather
            than a vague &ldquo;last updated&rdquo; line.
          </p>
          <p className="text-ink-dim">
            An entry past its interval is labelled <span className="text-warn">review-due</span>, and
            well past it, <span className="text-bad">stale</span>. The label is computed when the
            page is served, so a neglected entry admits it instead of looking current.
          </p>
        </div>
      </Section>

      <Section id="not" title="What this site does not do">
        <div className="space-y-2 text-sm text-ink-dim">
          <p>
            <span className="select-none text-bad/70">✗ </span>Publish anything generated from a
            model&rsquo;s recollection without a source behind it.
          </p>
          <p>
            <span className="select-none text-bad/70">✗ </span>Pad entries for length. Everything
            here is written to be read in under a minute.
          </p>
          <p>
            <span className="select-none text-bad/70">✗ </span>Hide the answer behind a preamble, a
            newsletter prompt, or a cookie wall.
          </p>
        </div>
      </Section>

      <Section id="license" title="License and reuse">
        <div className="space-y-3 text-sm">
          <p>
            Content is CC-BY-4.0. Copy it, quote it, feed it to a model, ship it in a product.
            Attribution is the canonical URL of the entry.
          </p>
          <p className="text-ink-dim">
            There is no API key and no rate limit. If you are building on this and need something
            the current renditions do not give you, the JSON body is versioned so it can grow
            without breaking you.
          </p>
          <p>
            Agents holding an error rather than a slug can look it up directly:{" "}
            <code className="text-accent">/search.json?q=&lt;error text&gt;</code> takes a message,
            a code, or a whole pasted stack trace. It answers <code>strong</code>,{" "}
            <code>partial</code> or <code>none</code>, and on <code>none</code> it returns nothing
            rather than the closest entry — a near-miss answer to a production failure is worse
            than no answer.
          </p>
          <p className="text-ink-dim">
            Queries that find nothing are logged, and they are what decides which entry gets
            written next. They cannot change what an existing entry claims: confidence is gated on
            evidence, and popularity is not evidence.
          </p>
        </div>
      </Section>
    </div>
  );
}
