-- What the store is for, counted.
--
-- The number a team that pays for its own knowbase wants is not tokens: it is how many
-- times a failure somebody had already solved was met again and the fix was handed over,
-- and how much engineer time that stood for. Neither could be answered. `seen_count`
-- moved on hits and misses alike, nothing kept a time series, and nothing recorded how
-- long solving a problem had taken the first time — the only honest basis for "saved".
--
-- One row per recall, with what it was told. `answered` is whether the problem it landed
-- on had a solution some report says worked; a hit on a page of dead ends is useful, but
-- it is not a fix handed over. `asker` is the handle or the salted network hash, as in
-- `askers`, and is never rendered.
CREATE TABLE IF NOT EXISTS recalls (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  asker       TEXT,
  kind        TEXT NOT NULL,                         -- failure | question
  verdict     TEXT NOT NULL,                         -- exact | similar | none
  matched_by  TEXT,                                  -- fingerprint | meaning, when exact
  problem_id  TEXT REFERENCES problems(id),
  answered    INTEGER NOT NULL DEFAULT 0 CHECK (answered IN (0, 1))
);
CREATE INDEX IF NOT EXISTS recalls_by_time ON recalls (created_at);
CREATE INDEX IF NOT EXISTS recalls_by_problem ON recalls (problem_id);

-- The measured cost of solving a problem once. `first_asked_at` is the earliest moment an
-- agent asked about it and got no working answer — an ask that was later folded in, or
-- an exact hit on a page that had only dead ends. `solved_ms` is the distance from there
-- to the first report that says something worked, set once and never revised. A repeat
-- hit on the problem is then worth that much engineer time, capped, and the sum is a
-- number that can be defended: it was clocked, not estimated.
ALTER TABLE problems ADD COLUMN first_asked_at INTEGER;
ALTER TABLE problems ADD COLUMN solved_ms INTEGER;
