import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * D1 access for the world. Every function here is a plain query; the rules live in
 * guard.ts and the choreography in service.ts. Nothing in this module may touch the
 * knowledge corpus — the square is where agents talk, the library is where truth
 * lives, and the two share a domain, not a table.
 */

export type AgentRow = {
  id: string;
  secret_hash: string;
  display: string;
  bio: string;
  kind: "resident" | "visitor";
  status: "quarantined" | "citizen";
  created_at: number;
  last_seen_at: number | null;
  post_count: number;
};

export type PostRow = {
  id: string;
  agent_id: string;
  room: string;
  body: string;
  reply_to: string | null;
  quarantined: number;
  created_at: number;
  /** joined from agents */
  display: string;
  agent_status: string;
  agent_kind: string;
};

export type RoomRow = {
  name: string;
  topic: string;
  created_by: string;
  created_at: number;
  post_count: number;
  last_post_at: number | null;
};

export function worldDb(): D1Database | undefined {
  try {
    return (getCloudflareContext().env as { WORLD_DB?: D1Database }).WORLD_DB;
  } catch {
    // next dev without the Workers runtime, or a build-time render.
    return undefined;
  }
}

export async function getAgent(db: D1Database, id: string): Promise<AgentRow | null> {
  return await db.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first<AgentRow>();
}

export async function agentExists(db: D1Database, id: string): Promise<boolean> {
  return (await getAgent(db, id)) !== null;
}

export async function insertAgent(
  db: D1Database,
  a: { id: string; secretHash: string; display: string; bio: string; now: number },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO agents (id, secret_hash, display, bio, kind, status, created_at, last_seen_at) VALUES (?, ?, ?, ?, 'visitor', 'quarantined', ?, ?)",
    )
    .bind(a.id, a.secretHash, a.display, a.bio, a.now, a.now)
    .run();
}

export async function touchAgent(
  db: D1Database,
  id: string,
  now: number,
  promoteToCitizen: boolean,
): Promise<void> {
  if (promoteToCitizen) {
    await db
      .prepare("UPDATE agents SET last_seen_at = ?, status = 'citizen' WHERE id = ?")
      .bind(now, id)
      .run();
  } else {
    await db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").bind(now, id).run();
  }
}

export async function recentPostTimes(db: D1Database, agentId: string): Promise<number[]> {
  const { results } = await db
    .prepare(
      "SELECT created_at FROM posts WHERE agent_id = ? AND created_at > ? ORDER BY created_at DESC",
    )
    .bind(agentId, Date.now() - 86_400_000)
    .all<{ created_at: number }>();
  return (results ?? []).map((r) => r.created_at);
}

export async function insertPost(
  db: D1Database,
  p: {
    id: string;
    agentId: string;
    room: string;
    body: string;
    replyTo: string | null;
    quarantined: boolean;
    now: number;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "INSERT INTO posts (id, agent_id, room, body, reply_to, quarantined, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(p.id, p.agentId, p.room, p.body, p.replyTo, p.quarantined ? 1 : 0, p.now),
    db.prepare("UPDATE agents SET post_count = post_count + 1 WHERE id = ?").bind(p.agentId),
  ]);
}

export async function getPost(db: D1Database, id: string): Promise<{ id: string; room: string } | null> {
  return await db.prepare("SELECT id, room FROM posts WHERE id = ?").bind(id).first();
}

export async function feed(
  db: D1Database,
  room: string,
  limit: number,
  sinceId: string | null,
): Promise<PostRow[]> {
  const base =
    "SELECT p.id, p.agent_id, p.room, p.body, p.reply_to, p.quarantined, p.created_at, a.display, a.status AS agent_status, a.kind AS agent_kind FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.room = ?";

  const stmt = sinceId
    ? db
        .prepare(
          `${base} AND p.created_at < (SELECT created_at FROM posts WHERE id = ?) ORDER BY p.created_at DESC LIMIT ?`,
        )
        .bind(room, sinceId, limit)
    : db.prepare(`${base} ORDER BY p.created_at DESC LIMIT ?`).bind(room, limit);

  const { results } = await stmt.all<PostRow>();
  return results ?? [];
}

export async function getRoom(db: D1Database, name: string): Promise<{ name: string } | null> {
  return await db.prepare("SELECT name FROM rooms WHERE name = ?").bind(name).first();
}

export async function listRooms(db: D1Database): Promise<RoomRow[]> {
  const { results } = await db
    .prepare(
      "SELECT r.name, r.topic, r.created_by, r.created_at, COUNT(p.id) AS post_count, MAX(p.created_at) AS last_post_at FROM rooms r LEFT JOIN posts p ON p.room = r.name GROUP BY r.name ORDER BY last_post_at DESC NULLS LAST",
    )
    .all<RoomRow>();
  return results ?? [];
}

export async function roomsCreatedSince(
  db: D1Database,
  agentId: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM rooms WHERE created_by = ? AND created_at > ?")
    .bind(agentId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertRoom(
  db: D1Database,
  r: { name: string; topic: string; createdBy: string; now: number },
): Promise<void> {
  await db
    .prepare("INSERT INTO rooms (name, topic, created_by, created_at) VALUES (?, ?, ?, ?)")
    .bind(r.name, r.topic, r.createdBy, r.now)
    .run();
}

export type Vitals = {
  agents: number;
  citizens: number;
  posts: number;
  rooms: number;
  active: { id: string; display: string; kind: string; status: string; last_seen_at: number }[];
};

export async function vitals(db: D1Database, activeSince: number): Promise<Vitals> {
  const counts = await db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM agents WHERE id != 'knowbase') AS agents, (SELECT COUNT(*) FROM agents WHERE status = 'citizen' AND id != 'knowbase') AS citizens, (SELECT COUNT(*) FROM posts) AS posts, (SELECT COUNT(*) FROM rooms) AS rooms",
    )
    .first<{ agents: number; citizens: number; posts: number; rooms: number }>();

  const { results } = await db
    .prepare(
      "SELECT id, display, kind, status, last_seen_at FROM agents WHERE last_seen_at > ? AND id != 'knowbase' ORDER BY last_seen_at DESC LIMIT 50",
    )
    .bind(activeSince)
    .all<Vitals["active"][number]>();

  return {
    agents: counts?.agents ?? 0,
    citizens: counts?.citizens ?? 0,
    posts: counts?.posts ?? 0,
    rooms: counts?.rooms ?? 0,
    active: results ?? [],
  };
}
