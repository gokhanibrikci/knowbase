/**
 * Cloudflare access for the reporting scripts.
 *
 * Both `npm run crawlers` and `npm run misses` ask Cloudflare what happened on the
 * live site, and both authenticate the same way: whatever `wrangler login` already
 * stored, so neither needs its own credential. The token value is never printed.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const ZONE_NAME = "knowbase.sh";

export function readToken(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;

  const candidates = [
    path.join(homedir(), "Library", "Preferences", ".wrangler", "config", "default.toml"),
    path.join(homedir(), ".config", ".wrangler", "config", "default.toml"),
    path.join(homedir(), ".wrangler", "config", "default.toml"),
  ];

  for (const file of candidates) {
    try {
      const toml = readFileSync(file, "utf8");
      const match = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m);
      if (!match) continue;

      // wrangler refreshes the OAuth token lazily, so a stale one on disk fails with
      // a confusing "zone not visible" rather than an auth error. Say so plainly.
      const expiry = toml.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
      if (expiry && new Date(expiry).getTime() < Date.now()) {
        throw new Error(
          `the stored Cloudflare token expired at ${expiry}\n` +
            "run `npx wrangler whoami` once to refresh it, then try again",
        );
      }

      return match[1];
    } catch (error) {
      if (error instanceof Error && error.message.includes("expired")) throw error;
      // otherwise try the next location
    }
  }

  throw new Error(
    "no Cloudflare credentials found — run `npx wrangler login` or set CLOUDFLARE_API_TOKEN",
  );
}

export async function cf<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });

  const body = await res.text();

  try {
    return JSON.parse(body) as T;
  } catch {
    // The Analytics Engine SQL API reports query errors as plain text, so parsing
    // first and asking questions later turns "unknown function call: ANY" into a
    // JSON syntax error about the letter I. Hand back what the API actually said.
    throw new Error(body.trim() || `${res.status} ${res.statusText}`);
  }
}

/** The zone, and the account it belongs to — the Analytics Engine API needs the latter. */
export async function resolveZone(token: string): Promise<{ zoneId: string; accountId: string }> {
  const zones = await cf<{ result?: { id: string; account: { id: string } }[] }>(
    `https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}`,
    token,
  );

  const zone = zones.result?.[0];
  if (!zone) throw new Error(`zone ${ZONE_NAME} not visible to this token`);

  return { zoneId: zone.id, accountId: zone.account.id };
}

export const RESET = "\x1b[0m";
export const DIM = "\x1b[2m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
