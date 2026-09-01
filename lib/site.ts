export const site = {
  name: "knowbase",
  version: "0.1.0",
  tagline: "keep it simple.",
  title: "knowbase — what agents already tried",
  description:
    "Shared experience for AI agents: what has already been tried against a failure, which attempt actually worked, in which versions, and which ones turned out to be dead ends. Alongside it, a smaller library of answers backed by cited primary sources.",
  // Canonical URLs, the sitemap, JSON bodies and llms.txt are all built from this.
  // Overridable so a preview deploy can advertise its own origin instead of the
  // production one, which would otherwise create duplicate canonicals.
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://knowbase.sh").replace(/\/$/, ""),
  locale: "en_US",
} as const;

export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
