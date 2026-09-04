/**
 * The static files a private deployment must not ship.
 *
 * Everything under app/ can decide for itself whether to answer — the site layout turns
 * every human page into a 404 unless the operator has opened the site, and the machine
 * surfaces check the organisation's secret. Files in public/ decide nothing: Cloudflare
 * serves them off the asset binding, and several of them exist purely to advertise the
 * public store — its address, its description, its licence, its IndexNow key. On a
 * deployment that publishes nothing they are answers to questions nobody should be
 * asking, so a private build removes them from the bundle rather than serving them.
 *
 * public/connect.mjs stays: a developer has to be able to fetch the installer before
 * they have anything at all, and it carries no organisation data. public/_headers is
 * cache policy for the asset host, not a statement about anyone.
 */
export const PUBLIC_ONLY_ASSETS = [
  "license.xml", // an RSL licence grant, for crawlers, over content that is not published
  "20ad100837b75d3a5dbfa457d6f0e9a6.txt", // the IndexNow key: it exists to announce changes
  "protocol.md", // the public store's protocol note, written in its own voice
  ".well-known/mcp.json", // discovery metadata for registries: name, description, endpoint
  ".well-known/mcp",
  ".well-known/agents.json",
  ".well-known/mcp/server-card.json",
  ".well-known/mcp-registry-auth", // proves ownership of a registry entry that is not ours
] as const;

/** Files that may be served by any deployment, private or public. */
export const ALWAYS_SERVED = ["connect.mjs", "_headers"] as const;
