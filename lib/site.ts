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

/** A var that may arrive from the build environment or from the Worker's own vars. */
function runtimeVar(name: string): string | null {
  const fromBuild = process.env[name];
  if (fromBuild) return fromBuild;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env: Record<string, unknown> };
    };
    const v = getCloudflareContext().env[name];
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

/**
 * Whether the human site may be served at all.
 *
 * A private deployment's pages are 404 until the operator sets PRIVATE_SITE=1, which is
 * their statement that an identity proxy — Cloudflare Access, or any OIDC — stands in
 * front of the hostname. Nothing here can verify that, so it fails closed: the store is
 * not browsable by default, and opening it is a deliberate act. The machine surfaces are
 * unaffected; they check the organisation's secret themselves.
 */
export function siteVisible(): boolean {
  return !isPrivate() || runtimeVar("PRIVATE_SITE") === "1";
}

/**
 * The token that lets somebody claim a handle on a private deployment.
 *
 * Reading needs the organisation's secret — but registration handed out secrets to anyone
 * who could reach the endpoint, so the gate opened itself. On a private deployment a
 * handle now needs either an existing member's secret or this shared enrolment token,
 * which the organisation distributes the way it distributes any other build secret. When
 * it is unset, a private deployment refuses to register anyone at all.
 */
export function enrolToken(): string | null {
  return runtimeVar("KNOWBASE_ENROL");
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
