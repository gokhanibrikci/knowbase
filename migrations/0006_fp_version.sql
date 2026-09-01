-- Which fingerprint rule produced each key.
--
-- The first version of a rule like this is never the last: an extractor will one day
-- learn that some ecosystem puts its error somewhere new, and every key it produced
-- before that becomes wrong. Recording the version — alongside the sample, which is
-- already kept — means a later version can recompute the key for old rows and merge
-- them, instead of the store carrying a permanent seam nobody can find.
ALTER TABLE problems ADD COLUMN fp_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS problems_by_fp_version ON problems (fp_version);
