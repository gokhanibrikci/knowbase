export const site = {
  name: "knowbase",
  version: "0.1.0",
  tagline: "keep it simple.",
  title: "knowbase — verified technical knowledge for humans and agents",
  description:
    "Verified, source-backed answers to concrete engineering failures. Every entry states the error, the root cause, the fix, the versions it applies to, and the primary sources that prove it.",
  // Canonical URLs, the sitemap, JSON bodies and llms.txt are all built from this.
  // Overridable so a preview deploy can advertise its own origin instead of the
  // production one, which would otherwise create duplicate canonicals.
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://knowbase.sh").replace(/\/$/, ""),
  locale: "en_US",
} as const;

export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
