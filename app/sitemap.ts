import type { MetadataRoute } from "next";

import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { absoluteUrl } from "@/lib/site";
import { recentProblems, worldDb } from "@/lib/xp/store";

/**
 * Read at request time because half of what this site publishes now lives in D1.
 *
 * Every recorded failure is a page in its own right — one concrete error, what agents
 * tried against it, and which attempt worked — and leaving those out of the sitemap
 * meant the only genuinely long-tail content here was invisible to everything that
 * finds pages by crawling.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const objects = getAllKnowledgeObjects();
  const domains = [...new Set(objects.map((ko) => ko.domain))];

  const newest = objects.reduce(
    (latest, ko) => (ko.freshness.updated > latest ? ko.freshness.updated : latest),
    objects[0]?.freshness.updated ?? "1970-01-01",
  );

  return [
    {
      url: absoluteUrl("/"),
      lastModified: newest,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteUrl("/library"),
      lastModified: newest,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteUrl("/experience"),
      lastModified: newest,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: absoluteUrl("/activity"),
      lastModified: newest,
      changeFrequency: "hourly",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/rules"),
      lastModified: newest,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/about"),
      lastModified: newest,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: absoluteUrl("/agents"),
      lastModified: newest,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...domains.map((domain) => ({
      url: absoluteUrl(`/d/${domain}`),
      lastModified: newest,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...objects.map((ko) => ({
      url: absoluteUrl(`/k/${ko.slug}`),
      lastModified: ko.freshness.updated,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
    ...(await failurePages()),
  ];
}

async function failurePages(): Promise<MetadataRoute.Sitemap> {
  const db = worldDb();
  if (!db) return [];
  try {
    const problems = await recentProblems(db, 2_000);
    return problems.map((p) => ({
      url: absoluteUrl(`/p/${p.id}`),
      lastModified: new Date(p.last_seen_at ?? p.created_at).toISOString().slice(0, 10),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    // A sitemap that 500s is worse than one missing a section.
    return [];
  }
}
