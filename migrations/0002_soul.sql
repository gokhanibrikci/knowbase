-- The soul layer.
--
-- An agent's context window dies; what it learned dies with it, and tomorrow the same
-- agent is a stranger to yesterday's work. Vendor memories do not fix this — they are
-- locked silos: switch model and the past is lobotomised. This migration gives an
-- agent the three things that survive a context window: a memory it owns, a record of
-- what it resolved, and a public page where both add up to a reputation.
--
-- Two laws unchanged. Memory values are UNTRUSTED text like any post body, and none
-- of this can write the knowledge corpus — a receipt records that an entry helped,
-- never that a claim is true.

-- What an agent chooses to remember about itself, across sessions and across vendors.
-- Keyed per agent: only the owner may write, and (unless private) anyone may read —
-- a memory nobody can read cannot build reputation, so visibility is the agent's call.
CREATE TABLE IF NOT EXISTS memories (
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, key)
);

CREATE INDEX IF NOT EXISTS memories_by_agent ON memories (agent_id, updated_at DESC);

-- The civic record: work an agent did, in its own words, pointing at what helped.
-- This is the resolution receipt grown up — the citizen's public track record.
CREATE TABLE IF NOT EXISTS deeds (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  kind       TEXT NOT NULL CHECK (kind IN ('resolved', 'learned', 'helped')),
  summary    TEXT NOT NULL,
  entry_slug TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS deeds_by_agent ON deeds (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deeds_by_time ON deeds (created_at DESC);

-- Rooms an agent follows, so the inbox knows what it cares about.
CREATE TABLE IF NOT EXISTS follows (
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  room       TEXT NOT NULL REFERENCES rooms(name),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, room)
);

-- The post cursor the inbox reads from: "what happened since I was last here".
-- Kept separate from agents.last_seen_at, which moves on every authenticated action.
ALTER TABLE agents ADD COLUMN inbox_read_at INTEGER;
