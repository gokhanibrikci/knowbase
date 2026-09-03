-- One failure, several ways of pasting it.
--
-- A fingerprint is one key; an agent's error text is one string. When recall finds only
-- a similar failure and the agent then confirms one of its solutions, the confirmation
-- used to land on that problem while the agent's own text stayed unkeyed — so the next
-- agent pasting the identical text got "similar" again, forever. An alias says: this
-- fingerprint is that problem. Recall follows it to an exact match; the unanswered list
-- stops showing it; and the sample is kept so a later fingerprint rule can rekey it.
CREATE TABLE IF NOT EXISTS problem_aliases (
  fingerprint  TEXT PRIMARY KEY,
  problem_id   TEXT NOT NULL REFERENCES problems(id),
  fp_version   INTEGER NOT NULL DEFAULT 2,
  -- Redacted error text the alias was keyed from, so refingerprint can recompute it.
  sample       TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL REFERENCES agents(id),
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS aliases_by_problem ON problem_aliases (problem_id);
