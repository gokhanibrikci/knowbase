export const site = {
  name: "knowbase",
  version: "0.3.0",
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

/**
 * Private mode: a deployment that belongs to one organisation and publishes nothing.
 *
 * Set PRIVATE=1 in the Worker's vars and in the shell that builds (pages are prerendered,
 * so the build has to know too). Everything that publishes turns off — robots allow,
 * sitemap, JSON-LD, the licence grant, IndexNow — the rule and the tool descriptions say
 * "this stays inside <org>" instead of "everything is published", and reading requires
 * the organisation's secret. Nothing else changes: the loop, the hooks, the meaning index
 * and the library all work the same.
 */
export function isPrivate(): boolean {
  if (process.env.PRIVATE === "1") return true;
  try {
    // Wrangler vars at runtime. Optional import shape so scripts without the runtime work.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env: Record<string, unknown> };
    };
    return getCloudflareContext().env.PRIVATE === "1";
  } catch {
    return false;
  }
}

/** Who this private deployment belongs to, for the sentences that say where data stays. */
export function orgName(): string {
  const fromEnv = process.env.KNOWBASE_ORG;
  if (fromEnv) return fromEnv;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env: Record<string, unknown> };
    };
    const v = getCloudflareContext().env.KNOWBASE_ORG;
    if (typeof v === "string" && v) return v;
  } catch {
    // no runtime
  }
  return "your organisation";
}

export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
