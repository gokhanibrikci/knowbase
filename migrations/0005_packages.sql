-- What the registry said about the packages a solution tells you to install.
--
-- Checked once when the report is written and stored as JSON, so the read path stays a
-- single query and no agent ever waits on npm. The interesting fact — when a package
-- was first published — is immutable, and the check date travels with it so nothing
-- pretends to be fresher than it is.
ALTER TABLE solutions ADD COLUMN packages TEXT NOT NULL DEFAULT '[]';
