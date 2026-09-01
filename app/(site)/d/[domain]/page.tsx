import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { KoList } from "@/components/ko/ko-list";
import { Section } from "@/components/ko/parts";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { site } from "@/lib/site";


export function generateStaticParams() {
  const domains = new Set(getAllKnowledgeObjects().map((ko) => ko.domain));
  return [...domains].map((domain) => ({ domain }));
}

export async function generateMetadata({ params }: PageProps<"/d/[domain]">): Promise<Metadata> {
  const { domain } = await params;
  const objects = getAllKnowledgeObjects().filter((ko) => ko.domain === domain);
  if (objects.length === 0) return {};

  return {
    title: `${domain} — verified troubleshooting entries`,
    description: `${objects.length} verified ${domain} knowledge objects: error, root cause, fix, applicable versions, and the primary sources behind each one.`,
    alternates: { canonical: `/d/${domain}` },
  };
}

export default async function DomainPage({ params }: PageProps<"/d/[domain]">) {
  const { domain } = await params;
  const objects = getAllKnowledgeObjects().filter((ko) => ko.domain === domain);
  if (objects.length === 0) notFound();

  return (
    <div className="pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-dim">
        <Link href="/" className="hover:text-accent">
          {site.name}
        </Link>
        <span className="mx-2 text-ink-faint">&gt;</span>
        <span className="text-ink">{domain}</span>
      </nav>

      <h1 className="mt-5 text-2xl text-ink-bright">
        <span className="select-none text-accent-soft"># </span>
        {domain}
      </h1>

      <Section id="entries" title="Entries" hint={`${objects.length} knowledge objects`}>
        <KoList objects={objects} />
      </Section>
    </div>
  );
}
