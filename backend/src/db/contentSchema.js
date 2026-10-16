async function initContentSchema(db) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS llm_attempts(id TEXT PRIMARY KEY,user_id TEXT,job TEXT NOT NULL,priority TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,outcome TEXT NOT NULL,status INTEGER,latency_ms INTEGER,tokens INTEGER NOT NULL,estimated INTEGER NOT NULL,created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_llm_attempts_date ON llm_attempts(created_at,user_id)`,
    `CREATE TABLE IF NOT EXISTS llm_provider_limits(provider TEXT NOT NULL,model TEXT NOT NULL,remaining_requests INTEGER,remaining_tokens INTEGER,reset_requests_at INTEGER,reset_tokens_at INTEGER,observed_at TEXT NOT NULL,PRIMARY KEY(provider,model))`,
    `CREATE TABLE IF NOT EXISTS content_events(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,job TEXT NOT NULL,outcome TEXT NOT NULL,reason TEXT NOT NULL,scores TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE INDEX IF NOT EXISTS idx_content_events_date ON content_events(user_id,created_at)`,
    `CREATE TABLE IF NOT EXISTS resident_profiles(character_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,profile TEXT NOT NULL,FOREIGN KEY(character_id) REFERENCES ai_characters(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS resident_memory(character_id TEXT NOT NULL,user_id TEXT NOT NULL,post_id TEXT NOT NULL,PRIMARY KEY(character_id,post_id),FOREIGN KEY(character_id) REFERENCES ai_characters(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS content_candidates(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,character_id TEXT NOT NULL,content TEXT NOT NULL,parent_id TEXT,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','published','discarded')),source TEXT NOT NULL,scheduled_at TEXT NOT NULL,created_at TEXT NOT NULL,published_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(character_id) REFERENCES ai_characters(id) ON DELETE CASCADE)`,
    `CREATE INDEX IF NOT EXISTS idx_candidates_due ON content_candidates(user_id,state,scheduled_at)`,
    `CREATE TABLE IF NOT EXISTS content_pool_state(user_id TEXT PRIMARY KEY,next_fill_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS world_theme_state(user_id TEXT PRIMARY KEY,theme TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,changed_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  ], 'write');
  // Additive migration: retain every existing account, character, and post.
  for (const table of ['posts', 'ai_characters', 'content_candidates', 'reaction_queue', 'trends', 'content_pool_state']) {
    const columns = (await db.execute(`PRAGMA table_info(${table})`)).rows;
    if (!columns.some(c => c.name === 'theme_version')) await db.execute(`ALTER TABLE ${table} ADD COLUMN theme_version INTEGER NOT NULL DEFAULT 1`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_${table}_theme ON ${table}(user_id,theme_version)`);
  }
  if (!(await db.execute('PRAGMA table_info(content_candidates)')).rows.some(c => c.name === 'reviewed')) await db.execute('ALTER TABLE content_candidates ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0');
  if (!(await db.execute('PRAGMA table_info(ai_characters)')).rows.some(c => c.name === 'participation_role')) await db.execute("ALTER TABLE ai_characters ADD COLUMN participation_role TEXT NOT NULL DEFAULT ''");
  if (!(await db.execute('PRAGMA table_info(world_theme_state)')).rows.some(c => c.name === 'position')) await db.execute("ALTER TABLE world_theme_state ADD COLUMN position TEXT NOT NULL DEFAULT ''");
  await db.execute(`INSERT OR IGNORE INTO world_theme_state(user_id,theme,version,changed_at)
    SELECT user_id,interests,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM world_settings`);
  await db.execute("UPDATE world_theme_state SET position=COALESCE((SELECT position FROM world_settings WHERE user_id=world_theme_state.user_id),'') WHERE position=''");
  require('../services/llmRuntime').attachDatabase(db);
}
module.exports = { initContentSchema };
