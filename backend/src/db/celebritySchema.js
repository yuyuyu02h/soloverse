async function initCelebritySchema(db) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS celebrity_scenes (
      post_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_likes INTEGER NOT NULL,
      target_comments INTEGER NOT NULL,
      mood TEXT NOT NULL DEFAULT '',
      reaction_mix TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','fallback')),
      started_at TEXT NOT NULL,
      ready_at TEXT,
      FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_celebrity_scenes_pending
      ON celebrity_scenes(status, started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_celebrity_scenes_user
      ON celebrity_scenes(user_id, started_at)`,
    `CREATE TABLE IF NOT EXISTS celebrity_comments (
      id TEXT PRIMARY KEY,
      scene_post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      avatar_seed TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      like_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(scene_post_id) REFERENCES celebrity_scenes(post_id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_celebrity_comments_post
      ON celebrity_comments(user_id, scene_post_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS celebrity_notification_preferences (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_read_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ], 'write');
}

module.exports = { initCelebritySchema };
