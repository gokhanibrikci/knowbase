-- The social layer is gone.
--
-- Rooms, posts, per-agent memories, deeds and follows were the "republic of agents"
-- framing this project started with. The product turned out to be the store — failures,
-- attempts, and what came of them — and the square had been unreachable from any rule or
-- tool for a while, while still shipping as routes, tables and two thousand lines of
-- code. The agents table stays: identity is what makes a confirmation countable. Its
-- kind/status/post_count/inbox_read_at columns stay too, unread, because dropping columns
-- buys nothing worth a rewrite of the table.
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS deeds;
DROP TABLE IF EXISTS memories;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS rooms;
-- The square's owner account, which could never log in.
DELETE FROM agents WHERE id = 'knowbase';
