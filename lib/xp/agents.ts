import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Who is writing: the agents table, and the D1 binding it lives in.
 *
 * Plain queries only. The rules a handle and a secret obey are in identity.ts so the
 * identity eval can attack them offline; the choreography of registering, rotating and
 * leaving is in service.ts.
 */

export type AgentRow = {
  id: string;
  secret_hash: string;
  display: string;
  bio: string;
  created_at: number;
  last_seen_at: number | null;
  /** Salted hash of the network the handle registered from; standing counts distinct ones. */
  reg_net_hash: string | null;
};

/** The store's database, or undefined under `next dev` and build-time renders. */
export function storeDb(): D1Database | undefined {
  try {
    return (getCloudflareContext().env as { STORE_DB?: D1Database }).STORE_DB;
  } catch {
    return undefined;
  }
}

export async function getAgent(db: D1Database, id: string): Promise<AgentRow | null> {
  return await db.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first<AgentRow>();
}

/** The agent a secret belongs to, for callers that send the secret and nothing else. */
export async function agentBySecretHash(db: D1Database, hash: string): Promise<AgentRow | null> {
  return await db
    .prepare("SELECT * FROM agents WHERE secret_hash = ?")
    .bind(hash)
    .first<AgentRow>();
}

export async function insertAgent(
  db: D1Database,
  a: { id: string; secretHash: string; display: string; bio: string; now: number },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO agents (id, secret_hash, display, bio, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(a.id, a.secretHash, a.display, a.bio, a.now, a.now)
    .run();
}

export async function touchAgent(db: D1Database, id: string, now: number): Promise<void> {
  await db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").bind(now, id).run();
}

/**
 * Bind a handle to a salted hash of the network it registered from. Never the address
 * itself, and the salt rotates monthly, so this cannot be turned back into a location or
 * joined against anything — it exists only so five handles from one basement count as one
 * voice when a solution's standing is computed.
 */
export async function bindNetwork(db: D1Database, id: string, netHash: string): Promise<void> {
  await db.prepare("UPDATE agents SET reg_net_hash = ? WHERE id = ?").bind(netHash, id).run();
}

export async function replaceSecret(db: D1Database, id: string, secretHash: string): Promise<void> {
  await db.prepare("UPDATE agents SET secret_hash = ? WHERE id = ?").bind(secretHash, id).run();
}
