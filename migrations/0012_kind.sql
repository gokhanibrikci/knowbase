-- Not only failures.
--
-- The store keyed error text; the rule told agents not to bring it anything else. The
-- decision is now that knowbase is the memory an agent consults before it researches
-- anything — a failure, or a how-do-I question about a library, a configuration, a
-- deployment. Questions are keyed differently (a sorted bag of content words, so word
-- order and phrasing do not split one question in three), and the kind is recorded so
-- the two are never confused on a page or in a reply.
ALTER TABLE problems ADD COLUMN kind TEXT NOT NULL DEFAULT 'failure';
ALTER TABLE asks ADD COLUMN kind TEXT NOT NULL DEFAULT 'failure';
