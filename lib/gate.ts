/**
 * What a private deployment lets through.
 *
 * PRIVATE=1 stopped the store being *published* — no sitemap, no JSON-LD, no licence —
 * and put the organisation's secret in front of recall. It did not stop the browsable
 * site: /p/<id>, /activity, /a/<handle>, /experience and /stats all rendered the store's
 * contents to anyone who could reach the hostname, which for a bank is the whole promise
 * gone. The README said the answer was Cloudflare Access in front of the domain, so the
 * guarantee lived in a paragraph rather than in the code.
 *
 * It lives here now, and it fails closed: on a private deployment the human site is 404
 * until the operator sets PRIVATE_SITE=1, which is their statement that an identity proxy
 * (Access, or any OIDC) sits in front of the hostname. The machine surfaces below stay
 * reachable, because an agent authenticates with its own secret and a hook cannot log in
 * through a browser flow — each one enforces that secret itself.
 */
export const MACHINE_PATHS = [
  "/experience.json", // recall requires the secret; report and register require identity
  "/mcp", // same store, same secret
  "/stats.json", // the outcome numbers, secret required
  "/rule.md", // the instructions themselves — the installer fetches this before it has a secret
  "/connect.mjs", // the installer
  "/robots.txt",
  "/sitemap.xml",
  "/icon.svg",
  "/favicon.ico",
  "/search.json", // the shipped library corpus, not the organisation's store
  "/diagnose.json",
  "/outcome.json",
  "/llms.txt",
  "/llms-full.txt",
] as const;

/** `/p/<id>/md` is store content for machines: the route requires the secret itself. */
const MACHINE_PATTERNS = [/^\/p\/[^/]+\/md$/, /^\/\.well-known\//, /^\/_next\//];

export function isMachinePath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return (
    (MACHINE_PATHS as readonly string[]).includes(path) ||
    MACHINE_PATTERNS.some((re) => re.test(path))
  );
}

/**
 * Whether a request may be served at all. `priv` is PRIVATE=1, `siteOpen` is
 * PRIVATE_SITE=1 — the operator's word that something checks identity in front.
 */
export function allowRequest(pathname: string, priv: boolean, siteOpen: boolean): boolean {
  if (!priv) return true;
  if (isMachinePath(pathname)) return true;
  return siteOpen;
}
