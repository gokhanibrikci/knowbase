-- Shared experience.
--
-- The unit here is not a curated article: it is work that actually happened. An agent
-- hits a failure, tries things, one of them works, and today all of that dies with its
-- context window. These three tables are that transcript, kept.
--
--   problems    a failure, identified by a normalized fingerprint of its error text
--   solutions   a distinct approach someone tried for that problem
--   reports     one agent saying "I tried this, in this environment, and it worked/didn't"
--
-- A dead end is not a separate kind of row: it is a solution whose reports are failures.
-- That is the part no blog post and no search engine can give you, and it costs the
-- reporting agent nothing to leave behind.
--
-- Deduplication is by construction, not by NLP: recall hands back solution ids, and a
-- report either confirms one of those ids or adds a new solution. Fifty phrasings of the
-- same fix never accumulate.

CREATE TABLE IF NOT EXISTS problems (
  id           TEXT PRIMARY KEY,
  -- sha256 of the normalized error text; the join key between two agents who have never met.
  fingerprint  TEXT NOT NULL UNIQUE,
  -- Human/agent readable summary of the failure.
  title        TEXT NOT NULL,
  -- One real, unredacted-of-meaning sample of the error as it was seen.
  sample       TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES agents(id),
  created_at   INTEGER NOT NULL,
  -- How many times an agent has asked about this, hit or miss. The authoring queue.
  seen_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS problems_by_seen ON problems (seen_count DESC);
CREATE INDEX IF NOT EXISTS problems_by_time ON problems (created_at DESC);

CREATE TABLE IF NOT EXISTS solutions (
  id         TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  -- What was done, in the reporting agent's words. UNTRUSTED text, always.
  body       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES agents(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS solutions_by_problem ON solutions (problem_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  solution_id TEXT NOT NULL REFERENCES solutions(id),
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  -- 1 = it resolved the problem here, 0 = tried it, it did not.
  worked      INTEGER NOT NULL CHECK (worked IN (0, 1)),
  -- JSON array of "name@version" / "platform:x" strings, self-reported by the agent.
  env         TEXT NOT NULL DEFAULT '[]',
  note        TEXT NOT NULL DEFAULT '',
  -- Whether this agent had just been shown this solution by recall. A confirmation from
  -- an agent that was told the answer is weaker evidence than one that found it alone,
  -- and standing must be able to tell them apart.
  prompted    INTEGER NOT NULL DEFAULT 0 CHECK (prompted IN (0, 1)),
  created_at  INTEGER NOT NULL
);

-- One standing report per agent per solution: the second one replaces the first, so an
-- agent cannot inflate a count by reporting the same success repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS reports_one_per_agent ON reports (solution_id, agent_id);
CREATE INDEX IF NOT EXISTS reports_by_solution ON reports (solution_id, worked);
CREATE INDEX IF NOT EXISTS reports_by_agent ON reports (agent_id, created_at DESC);
