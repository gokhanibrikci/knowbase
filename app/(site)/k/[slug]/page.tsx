import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CodeBox,
  CommandBox,
  MetaRow,
  Section,
  SummaryRow,
  SummaryTable,
  Tag,
  type Tone,
} from "@/components/ko/parts";
import { koJsonLd } from "@/lib/ko/jsonld";
import { freshnessOf, getAllKnowledgeObjects, getKnowledgeObject, getRelated } from "@/lib/ko/store";
import { absoluteUrl, site } from "@/lib/site";


export function generateStaticParams() {
  return getAllKnowledgeObjects().map((ko) => ({ slug: ko.slug }));
}

export async function generateMetadata({ params }: PageProps<"/k/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const ko = getKnowledgeObject(slug);
  if (!ko) return {};

  const url = `/k/${ko.slug}`;

  return {
    title: ko.title,
    description: ko.summary,
    keywords: [...ko.tags, ...ko.error.codes, ...ko.error.aliases],
    alternates: {
      canonical: url,
      // Advertises the machine-readable renditions to anything reading the head.
      types: {
        "application/json": `${url}.json`,
        "text/markdown": `${url}.md`,
        "text/plain": `${url}.txt`,
      },
    },
    openGraph: {
      type: "article",
      title: ko.title,
      description: ko.summary,
      url,
      publishedTime: ko.freshness.created,
      modifiedTime: ko.freshness.updated,
      tags: ko.tags,
    },
    twitter: { card: "summary", title: ko.title, description: ko.summary },
  };
}

const CONFIDENCE_TONE: Record<string, Tone> = { high: "ok", medium: "warn", low: "bad" };
const FRESHNESS_TONE: Record<string, Tone> = {
  fresh: "ok",
  "review-due": "warn",
  stale: "bad",
};
const WEIGHT_TONE: Record<string, Tone> = { primary: "primary", common: "common", edge: "edge" };

export default async function KnowledgeObjectPage({ params }: PageProps<"/k/[slug]">) {
  const { slug } = await params;
  const ko = getKnowledgeObject(slug);
  if (!ko) notFound();

  const fresh = freshnessOf(ko);
  const related = getRelated(ko);
  const primarySources = ko.evidence.filter((e) =>
    ["official-docs", "specification", "source-code"].includes(e.type),
  ).length;

  // Lifted into the summary table so the opening chunk of the page carries the
  // answer, not just the question. Retrieval cites the top of a document far more
  // often than its middle.
  const primaryCause = ko.rootCauses.find((c) => c.weight === "primary");
  const firstStep = ko.solution.steps[0];
  const firstCheck = firstStep?.command ?? firstStep?.instruction;

  return (
    <article className="pt-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(koJsonLd(ko)) }}
      />

      <nav aria-label="Breadcrumb" className="text-xs text-ink-dim">
        <Link href="/" className="hover:text-accent">
          {site.name}
        </Link>
        <span className="mx-2 text-ink-faint">&gt;</span>
        <Link href={`/d/${ko.domain}`} className="hover:text-accent">
          {ko.domain}
        </Link>
        <span className="mx-2 text-ink-faint">&gt;</span>
        <span className="text-ink">{ko.slug}</span>
      </nav>

      <header className="mt-5">
        <h1 className="text-2xl leading-snug text-ink-bright sm:text-[1.75rem]">
          <span className="select-none text-accent-soft"># </span>
          {ko.title}
        </h1>
        <p className="mt-3 text-ink">{ko.summary}</p>

        <SummaryTable caption={`Summary: ${ko.title}`}>
          <SummaryRow label="Error">
            <code className="text-ink-bright">{ko.error.signature}</code>
          </SummaryRow>
          <SummaryRow label="Applies to">
            {ko.appliesTo.technology.map((t) => `${t.name} ${t.versions}`).join(" · ")}
          </SummaryRow>
          {primaryCause ? (
            <SummaryRow label="Primary cause">
              <span className="text-ink-bright">{primaryCause.cause}</span>
            </SummaryRow>
          ) : null}
          {firstCheck ? (
            <SummaryRow label="First check">
              <code className="text-ink-bright">{firstCheck}</code>
            </SummaryRow>
          ) : null}
          <SummaryRow label="Confidence">
            <Tag tone={CONFIDENCE_TONE[ko.confidence]}>{ko.confidence}</Tag>
            <span className="ml-2 text-ink-faint">
              {ko.evidence.length} sources, {primarySources} primary
            </span>
          </SummaryRow>
          <SummaryRow label="Verified">
            <span className="text-ink-bright">{fresh.verifiedAt}</span>
            <span className="ml-2">
              <Tag tone={FRESHNESS_TONE[fresh.status]}>{fresh.status}</Tag>
            </span>
            <span className="ml-2 text-ink-faint">
              {fresh.ageDays}d old · recheck by {fresh.staleAt}
            </span>
          </SummaryRow>
          <SummaryRow label="Domain">
            <Link href={`/d/${ko.domain}`} className="hover:text-accent">
              {ko.domain}
            </Link>
            <span className="ml-2 text-ink-faint">{ko.tags.join(" ")}</span>
          </SummaryRow>
        </SummaryTable>
      </header>

      <Section id="error" title="Error">
        <CommandBox prefix="">{ko.error.signature}</CommandBox>
        {ko.error.codes.length > 0 ? (
          <p className="mt-3 text-sm">
            <span className="text-ink-dim">Codes: </span>
            {ko.error.codes.map((code) => (
              <span key={code} className="mr-2">
                <Tag>{code}</Tag>
              </span>
            ))}
          </p>
        ) : null}
        {ko.error.aliases.length > 0 ? (
          <p className="mt-2 text-sm text-ink-dim">
            Also seen as:{" "}
            {ko.error.aliases.map((alias, i) => (
              <span key={alias}>
                {i > 0 ? " · " : ""}
                <span className="text-ink">{alias}</span>
              </span>
            ))}
          </p>
        ) : null}
      </Section>

      <Section id="problem" title="Problem">
        <p>{ko.problem}</p>
      </Section>

      <Section
        id="root-cause"
        title="Root Cause"
        hint={`${ko.rootCauses.length} known causes, ranked`}
      >
        <ol className="space-y-4">
          {ko.rootCauses.map((cause, i) => (
            <li key={i}>
              {/* A heading, not a styled span: it gives each cause its own chunk
                  boundary, so a retrieval system can lift one cause with its
                  discriminator intact rather than half of two. */}
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="select-none text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-base font-normal text-ink-bright">{cause.cause}</h3>
                <Tag tone={WEIGHT_TONE[cause.weight]}>{cause.weight}</Tag>
              </div>
              {cause.detail ? <p className="mt-1 pl-7 text-sm">{cause.detail}</p> : null}
              {cause.discriminator ? (
                <p className="mt-1 pl-7 text-sm text-ink-dim">
                  <span className="text-accent-soft">→ how to tell: </span>
                  {cause.discriminator}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="solution" title="Solution">
        <ol className="space-y-5">
          {ko.solution.steps.map((step, i) => (
            <li key={i}>
              <div className="flex gap-2">
                <span className="select-none text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-ink-bright">{step.instruction}</span>
              </div>
              <div className="pl-7">
                {step.command ? <CommandBox>{step.command}</CommandBox> : null}
                {step.code ? <CodeBox language={step.language}>{step.code}</CodeBox> : null}
                {step.note ? (
                  <p className="mt-2 text-sm text-ink-dim">
                    <span className="text-accent-soft">note: </span>
                    {step.note}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        {ko.solution.verification ? (
          <p className="mt-6 border-l-2 border-ok/40 pl-3 text-sm">
            <span className="text-ok">verify · </span>
            {ko.solution.verification}
          </p>
        ) : null}
        {ko.solution.fallback ? (
          <p className="mt-3 border-l-2 border-warn/40 pl-3 text-sm">
            <span className="text-warn">if that fails · </span>
            {ko.solution.fallback}
          </p>
        ) : null}
      </Section>

      <Section id="applies-to" title="Applies To">
        <dl className="space-y-1 text-sm">
          {ko.appliesTo.technology.map((tech) => (
            <MetaRow key={tech.name} label={tech.name}>
              <span className="text-ink-bright">{tech.versions}</span>
              {tech.note ? <span className="ml-2 text-ink-dim">— {tech.note}</span> : null}
            </MetaRow>
          ))}
          {ko.appliesTo.runtimes?.length ? (
            <MetaRow label="Runtimes">{ko.appliesTo.runtimes.join(", ")}</MetaRow>
          ) : null}
          {ko.appliesTo.platforms?.length ? (
            <MetaRow label="Platforms">{ko.appliesTo.platforms.join(", ")}</MetaRow>
          ) : null}
        </dl>
      </Section>

      {ko.notApplicableTo.length > 0 ? (
        <Section
          id="not-applicable"
          title="Not Applicable To"
          hint="near misses this page does not answer"
        >
          <ul className="space-y-1 text-sm">
            {ko.notApplicableTo.map((item) => (
              <li key={item}>
                <span className="select-none text-bad/70">✗ </span>
                <span className="text-ink-dim">{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="evidence" title="Evidence" hint={`${ko.evidence.length} sources`}>
        <ol className="space-y-4">
          {ko.evidence.map((item, i) => (
            <li key={item.url}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="select-none text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                <Tag tone={["official-docs", "specification", "source-code"].includes(item.type) ? "primary" : "common"}>
                  {item.type}
                </Tag>
                <a
                  href={item.url}
                  rel="noopener"
                  className="text-ink-bright underline decoration-accent-soft underline-offset-4 hover:text-accent"
                >
                  {item.title}
                </a>
              </div>
              <p className="mt-1 pl-7 text-xs break-all text-ink-faint">{item.url}</p>
              <p className="mt-1 pl-7 text-sm text-ink-dim">
                {item.publisher} · read {item.retrievedAt}
              </p>
              <p className="mt-1 pl-7 text-sm">
                <span className="text-accent-soft">supports: </span>
                {item.supports}
              </p>
              {item.quote ? (
                <p className="mt-1 pl-7 text-sm text-ink-dim italic">&ldquo;{item.quote}&rdquo;</p>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="confidence" title="Confidence">
        <p>
          <Tag tone={CONFIDENCE_TONE[ko.confidence]}>{ko.confidence}</Tag>
          <span className="ml-3">{ko.confidenceRationale}</span>
        </p>
      </Section>

      {related.length > 0 ? (
        <Section id="related" title="Related">
          <ul className="space-y-1">
            {related.map((item) => (
              <li key={item.slug}>
                <span className="select-none text-ink-faint">→ </span>
                <Link
                  href={`/k/${item.slug}`}
                  className="text-ink-bright underline decoration-rule underline-offset-4 hover:text-accent"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/*
        Most readers of this page arrive from a search engine holding one error, and
        never see llms.txt. Both lines below are accuracy features rather than
        promotion: the first is how a reader escapes an entry that is a near miss for
        their failure, the second is how they stop guessing which cause they have.
      */}
      <Section id="not-yours" title="If this is not your failure">
        <div className="space-y-3 text-sm">
          <p>
            Look yours up rather than adapting this one —{" "}
            <Link href="/search.json?q=" className="text-accent hover:text-ink-bright">
              /search.json?q=
            </Link>{" "}
            takes an error message, a code, or a pasted stack trace and answers{" "}
            <code>none</code> when nothing here covers it.
          </p>
          <p>
            To narrow the {ko.rootCauses.length} causes above to the one you have, run the check
            on each and post what they returned:
          </p>
          <CommandBox prefix="">
            {`curl -s -X POST ${absoluteUrl("/diagnose.json")} \\\n  -H 'content-type: application/json' \\\n  -d '{"slug":"${ko.slug}","observations":"..."}'`}
          </CommandBox>
          <p className="text-ink-dim">
            It answers with the cause your observations identify and the reason each of the others
            is excluded. These calls are available as{" "}
            <Link href="/agents#install" className="text-accent hover:text-ink-bright">
              MCP tools
            </Link>{" "}
            as well, alongside the shared store&apos;s.
          </p>
        </div>
      </Section>

      <div className="mt-10 rule-solid" />
      <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-ink-faint">machine-readable:</span>
          <a href={`/k/${ko.slug}.json`} className="text-accent hover:text-ink-bright">
            [ JSON ]
          </a>
          <span className="text-ink-faint">|</span>
          <a href={`/k/${ko.slug}.md`} className="text-accent hover:text-ink-bright">
            [ Markdown ]
          </a>
          <span className="text-ink-faint">|</span>
          <a href={`/k/${ko.slug}.txt`} className="text-accent hover:text-ink-bright">
            [ Plain Text ]
          </a>
        </div>
        <span className="text-xs text-ink-faint">{absoluteUrl(`/k/${ko.slug}`)}</span>
      </div>
    </article>
  );
}
