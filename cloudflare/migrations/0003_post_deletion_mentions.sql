-- Local feature work: apply before a future Worker deployment of these features.
ALTER TABLE posts ADD COLUMN deleted_at TEXT;
ALTER TABLE reaction_queue ADD COLUMN reply_priority INTEGER NOT NULL DEFAULT 0;
