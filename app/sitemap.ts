import type { MetadataRoute } from "next";

import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
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
  ];
}
