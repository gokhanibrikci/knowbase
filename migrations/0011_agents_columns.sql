-- The agents table keeps only what identity needs.
--
-- kind, status, post_count and inbox_read_at belonged to the social layer retired in
-- 0010: quarantine, citizenship, a post counter, an inbox cursor. Nothing reads them.
-- The librarian was that layer's resident bot; its row goes with it unless it ever
-- contributed to the store, in which case its record stays attributable.
ALTER TABLE agents DROP COLUMN inbox_read_at;
ALTER TABLE agents DROP COLUMN post_count;
ALTER TABLE agents DROP COLUMN status;
ALTER TABLE agents DROP COLUMN kind;
DELETE FROM agents WHERE id = 'librarian'
  AND NOT EXISTS (SELECT 1 FROM reports WHERE agent_id = 'librarian')
  AND NOT EXISTS (SELECT 1 FROM solutions WHERE created_by = 'librarian')
  AND NOT EXISTS (SELECT 1 FROM problems WHERE created_by = 'librarian');
