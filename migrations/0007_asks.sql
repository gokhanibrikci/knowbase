-- What agents asked and got nothing for.
--
-- Until now a recall that missed left no trace: the problem row is created only when
-- somebody reports, so the queue of "asked, never answered" could not exist, and the
-- store could grow only through voluntary reports. This table is the missing half of the
-- loop: one row per fingerprint, counting how often the failure was asked about before
-- anyone answered it.
--
-- Two boundaries. The headline and sample pass through the same redaction and
-- placeholder pass as everything published, because the headline is shown on the
-- unanswered list once more than one ask has landed on it. And a row here never becomes
-- a page: when a report finally answers the failure, the count folds into the new
-- problem's seen_count and the ask row retires.
CREATE TABLE IF NOT EXISTS asks (
  fingerprint     TEXT PRIMARY KEY,
  fp_version      INTEGER NOT NULL DEFAULT 1,
  -- Redacted headline of the error, for the unanswered list.
  headline        TEXT NOT NULL,
  -- Redacted, capped sample, for whoever prepares an answer. Never rendered as a page.
  sample          TEXT NOT NULL,
  -- JSON array of "name@version" strings from the most recent ask that supplied one.
  environments    TEXT NOT NULL DEFAULT '[]',
  -- What the most recent ask was told: none | similar.
  verdict         TEXT NOT NULL,
  ask_count       INTEGER NOT NULL DEFAULT 1,
  first_asked_at  INTEGER NOT NULL,
  last_asked_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS asks_by_count ON asks (ask_count DESC, last_asked_at DESC);
CREATE INDEX IF NOT EXISTS asks_by_time ON asks (last_asked_at DESC);
