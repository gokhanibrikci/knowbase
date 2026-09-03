-- Whether a row has been placed in the meaning index.
--
-- A fingerprint is one key; two agents describing one failure in two languages, or one
-- question in two phrasings, produce two keys and never meet. The meaning index (a
-- multilingual embedding per problem and per unanswered ask, in Vectorize) is what lets
-- recall find them anyway. Rows written before the index existed are embedded lazily,
-- the first time a recall lands on them, and this column is how that is known.
ALTER TABLE problems ADD COLUMN embedded_at INTEGER;
ALTER TABLE asks ADD COLUMN embedded_at INTEGER;
