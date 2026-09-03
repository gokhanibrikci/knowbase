-- Who asked, so a count can mean what it says.
--
-- `asks.ask_count` and `problems.seen_count` counted CALLS. Nothing deduplicated them, so
-- one agent retrying a fix, or a hook and a model both reacting to the same failure,
-- moved the number as much as two unrelated people would. The proof was already in the
-- store: one failure sat at seen_count 91, all of it a single session testing the
-- endpoint. And because nothing recorded WHO asked, the store could not tell "two agents
-- hit this" from "one agent asked twice" — while the text it generated implied the first.
--
-- One row per (what was asked about, who asked). The distinct count is then a fact rather
-- than a guess, and the raw call count stays beside it because the queue genuinely wants
-- to know how much traffic a missing answer is attracting.
--
-- `asker` is the handle when the caller authenticated, and otherwise `net:<hash>` — the
-- same salted network hash reports already use, so an anonymous ask still deduplicates
-- without the address being stored. It is never rendered.
CREATE TABLE IF NOT EXISTS askers (
  -- 'ask' while the failure is unanswered, 'problem' once it has a page.
  scope     TEXT NOT NULL,
  -- The ask's fingerprint, or the problem's id.
  ref       TEXT NOT NULL,
  asker     TEXT NOT NULL,
  first_at  INTEGER NOT NULL,
  last_at   INTEGER NOT NULL,
  PRIMARY KEY (scope, ref, asker)
);

CREATE INDEX IF NOT EXISTS askers_by_ref ON askers (scope, ref);

-- Distinct askers, carried separately from the call count so neither has to pretend to
-- be the other. Backfilled below from what can be justified rather than left at zero.
ALTER TABLE asks ADD COLUMN asker_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE problems ADD COLUMN asker_count INTEGER NOT NULL DEFAULT 1;

-- The counts as they stand are call counts inflated by testing, and there is no record of
-- who made those calls, so no honest distinct number can be recovered from them. The
-- defensible floor is the number of agents that actually left a report on the failure,
-- and at least one for the agent that opened it.
UPDATE problems
   SET asker_count = MAX(
         1,
         (SELECT COUNT(DISTINCT r.agent_id)
            FROM reports r
            JOIN solutions s ON s.id = r.solution_id
           WHERE s.problem_id = problems.id)
       );

-- seen_count is what the site renders, so it stops being a call tally too. The raw
-- traffic figure is not worth reconstructing from a polluted history.
UPDATE problems SET seen_count = asker_count;
UPDATE asks SET asker_count = 1;
