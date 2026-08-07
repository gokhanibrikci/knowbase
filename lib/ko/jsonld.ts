import { absoluteUrl, site } from "@/lib/site";
import type { KnowledgeObject } from "./schema";

/**
 * Structured data for a KO page.
 *
 * `citation` is doing the real work here: it exposes every primary source as a
 * first-class node, which is the machine-readable form of the claim the site
 * makes in prose ("this answer is backed by these documents").
 */
export function koJsonLd(ko: KnowledgeObject) {
  const url = absoluteUrl(`/k/${ko.slug}`);

  const techArticle = {
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline: ko.title,
    name: ko.title,
    description: ko.summary,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: ko.freshness.created,
    dateModified: ko.freshness.updated,
    inLanguage: "en",
    keywords: [...ko.tags, ...ko.error.codes].join(", "),
    about: ko.appliesTo.technology.map((t) => ({
      "@type": "SoftwareApplication",
      name: t.name,
      softwareVersion: t.versions,
      applicationCategory: "DeveloperApplication",
    })),
    proficiencyLevel: "Expert",
    dependencies: ko.appliesTo.technology
      .map((t) => `${t.name} ${t.versions}`)
      .join("; "),
    citation: ko.evidence.map((e) => ({
      "@type": "CreativeWork",
      name: e.title,
      url: e.url,
      publisher: { "@type": "Organization", name: e.publisher },
    })),
    author: { "@type": "Organization", name: site.name, url: site.url },
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: site.url,
    },
    license: "https://creativecommons.org/licenses/by/4.0/",
    isAccessibleForFree: true,
  };

  const faqPage = {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: [
      {
        "@type": "Question",
        name: `What causes ${ko.error.signature}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: ko.rootCauses
            .map((c) => `${c.cause}${c.detail ? ` — ${c.detail}` : ""}`)
            .join(" "),
        },
      },
      {
        "@type": "Question",
        name: `How do I fix ${ko.error.signature}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: ko.solution.steps.map((s, i) => `${i + 1}. ${s.instruction}`).join(" "),
        },
      },
    ],
  };

  // The visible breadcrumb exists but is invisible to a parser without this.
  const breadcrumbs = {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumbs`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: site.name, item: site.url },
      {
        "@type": "ListItem",
        position: 2,
        name: ko.domain,
        item: absoluteUrl(`/d/${ko.domain}`),
      },
      { "@type": "ListItem", position: 3, name: ko.title, item: url },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [techArticle, faqPage, breadcrumbs],
  };
}

export function collectionJsonLd(objects: KnowledgeObject[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${site.url}/#collection`,
    name: site.name,
    description: site.description,
    url: site.url,
    hasPart: objects.map((ko) => ({
      "@type": "TechArticle",
      headline: ko.title,
      url: absoluteUrl(`/k/${ko.slug}`),
      dateModified: ko.freshness.updated,
    })),
  };
}
