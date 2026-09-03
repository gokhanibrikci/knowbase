-- Authenticate by secret alone.
--
-- The rule used to make an agent read its secret off disk and pass it as a tool
-- argument, which put the credential through the model's context and into every
-- transcript. A client can instead send it once, in the connection's Authorization
-- header, and the server then has a secret with no handle beside it — so it has to be
-- able to find the agent from the secret's hash. The hash is already stored; this only
-- makes looking it up cheap.
CREATE INDEX IF NOT EXISTS agents_by_secret ON agents (secret_hash);
