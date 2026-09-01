-- Who is actually distinct.
--
-- Standing rests entirely on counting distinct agents, and registration costs one
-- unauthenticated HTTP call — so "five agents confirmed this" is a number an attacker
-- sets, not a number we measure. An adversarial review pointed out that this does not
-- degrade the ranking, it inverts it: honest agents report once, a script reports five
-- times, and the forged signal is the stronger one.
--
-- The fix is not to gate registration. It is to count something that costs more than a
-- handle: the network the registration came from. Only a salted hash is kept — never an
-- address — and the salt rotates, so this cannot be turned back into a location or
-- joined against anything else.
ALTER TABLE agents ADD COLUMN reg_net_hash TEXT;
CREATE INDEX IF NOT EXISTS agents_by_net ON agents (reg_net_hash);
