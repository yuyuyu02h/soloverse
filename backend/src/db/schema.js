const { createClient } = require('@libsql/client');
const path = require('path');

const databasePath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../../soloverse.db');

const db = createClient({
  url: `file:${databasePath}`
});

async function initDB() {
  await db.execute('PRAGMA foreign_keys = ON');

  // ─── テーブル作成 ───────────────────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT NOT NULL,
      onboarding_done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS world_settings (
      user_id TEXT PRIMARY KEY,
      position TEXT NOT NULL,
      interests TEXT NOT NULL,
      atmosphere TEXT NOT NULL,
      exclusions TEXT NOT NULL DEFAULT '',
      follower_scale TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_characters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_seed TEXT NOT NULL,
      bio TEXT,
      personality TEXT NOT NULL,
      interests TEXT NOT NULL,
      reply_style TEXT NOT NULL,
      reaction_frequency TEXT NOT NULL,
      delay_profile TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('user', 'ai')),
      ai INTEGER DEFAULT 0,
      content TEXT NOT NULL,
      reply_to TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      liker_id TEXT NOT NULL,
      liker_type TEXT NOT NULL CHECK (liker_type IN ('user', 'ai')),
      ai INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(post_id, liker_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `);

  // reaction_queue: content カラムは削除（使用していないため）
  // attempts: LLM失敗時の再試行回数。無料枠の日次上限切れなどで
  // 失敗し続けるアイテムが30秒ごとに無限リトライされ、さらにクォータを
  // 消費し続ける「リトライ地獄」を防ぐために導入。
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reaction_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL CHECK (reaction_type IN ('like', 'reply', 'repost')),
      scheduled_at TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      character_id TEXT,
      post_id TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS trends (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      description TEXT NOT NULL,
      post_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS character_growth_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      trigger_reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // autonomous_log: last_growth_at を追加してキャラ増加間隔も一元管理
  await db.execute(`
    CREATE TABLE IF NOT EXISTS autonomous_log (
      user_id TEXT PRIMARY KEY,
      last_autonomous_at TEXT,
      last_trend_at TEXT,
      last_growth_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ─── マイグレーション ────────────────────────────────────
  await migrateCascade();
  await migrateAutonomousLogGrowth();
  await migrateReactionQueueAttempts();
  await createIndexes();
  await require('./contentSchema').initContentSchema(db);
  await require('./celebritySchema').initCelebritySchema(db);

  console.log('DB initialized');
}

async function createIndexes() {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_posts_timeline_dt ON posts(user_id, reply_to, datetime(created_at) DESC)',
    'CREATE INDEX IF NOT EXISTS idx_posts_replies_dt ON posts(user_id, reply_to, datetime(created_at))',
    'CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_dt ON notifications(user_id, read, datetime(created_at) DESC)',
    'CREATE INDEX IF NOT EXISTS idx_reaction_queue_due_dt ON reaction_queue(done, datetime(scheduled_at))',
    'CREATE INDEX IF NOT EXISTS idx_characters_user ON ai_characters(user_id, created_at)',
  ];
  for (const sql of indexes) await db.execute(sql);
}

// reaction_queue に attempts カラムがなければ追加（リトライ無限ループ防止用）
async function migrateReactionQueueAttempts() {
  try {
    await db.execute('ALTER TABLE reaction_queue ADD COLUMN attempts INTEGER DEFAULT 0');
    console.log('[Migration] Added attempts to reaction_queue');
  } catch (_) {
    // 既にカラムが存在する場合はエラーを無視
  }
}

// autonomous_log に last_growth_at カラムがなければ追加
async function migrateAutonomousLogGrowth() {
  try {
    await db.execute('ALTER TABLE autonomous_log ADD COLUMN last_growth_at TEXT');
    console.log('[Migration] Added last_growth_at to autonomous_log');
  } catch (_) {
    // 既にカラムが存在する場合はエラーを無視
  }
}

// 外部キーにON DELETE CASCADEが付いていないテーブルを再作成する
async function migrateCascade() {
  const targets = [
    'world_settings', 'ai_characters', 'posts',
    'likes', 'reaction_queue', 'notifications',
    'trends', 'character_growth_log', 'autonomous_log'
  ];

  for (const table of targets) {
    try {
      const fks = await db.execute(`PRAGMA foreign_key_list(${table})`);
      const needsMigrate = fks.rows.some(r => r.on_delete !== 'CASCADE');
      if (!needsMigrate) continue;

      console.log(`[Migration] Rebuilding ${table} with CASCADE...`);

      const rows = await db.execute(`SELECT * FROM ${table}`);

      await db.execute('PRAGMA foreign_keys = OFF');
      await db.execute(`DROP TABLE IF EXISTS ${table}`);
      await db.execute('PRAGMA foreign_keys = ON');

      await recreateTable(table);

      if (rows.rows.length > 0) {
        const cols = Object.keys(rows.rows[0]);
        for (const row of rows.rows) {
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map(c => row[c]);
          await db.execute({
            sql: `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
            args: values,
          });
        }
        console.log(`[Migration] Restored ${rows.rows.length} rows in ${table}`);
      }
    } catch (e) {
      console.warn(`[Migration] ${table} skipped:`, e.message);
    }
  }
}

async function recreateTable(name) {
  const defs = {
    world_settings: `CREATE TABLE IF NOT EXISTS world_settings (
      user_id TEXT PRIMARY KEY, position TEXT NOT NULL, interests TEXT NOT NULL,
      atmosphere TEXT NOT NULL, exclusions TEXT NOT NULL DEFAULT '', follower_scale TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    ai_characters: `CREATE TABLE IF NOT EXISTS ai_characters (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, username TEXT NOT NULL,
      avatar_seed TEXT NOT NULL, bio TEXT, personality TEXT NOT NULL, interests TEXT NOT NULL,
      reply_style TEXT NOT NULL, reaction_frequency TEXT NOT NULL, delay_profile TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    posts: `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, author_id TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('user', 'ai')),
      ai INTEGER DEFAULT 0, content TEXT NOT NULL, reply_to TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    likes: `CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL,
      liker_id TEXT NOT NULL, liker_type TEXT NOT NULL CHECK (liker_type IN ('user', 'ai')),
      ai INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(post_id, liker_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE)`,
    reaction_queue: `CREATE TABLE IF NOT EXISTS reaction_queue (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      post_id TEXT NOT NULL, reaction_type TEXT NOT NULL CHECK (reaction_type IN ('like', 'reply', 'repost')),
      scheduled_at TEXT NOT NULL, done INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    notifications: `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      character_id TEXT, post_id TEXT, read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    trends: `CREATE TABLE IF NOT EXISTS trends (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, keyword TEXT NOT NULL,
      description TEXT NOT NULL, post_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    character_growth_log: `CREATE TABLE IF NOT EXISTS character_growth_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trigger_reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    autonomous_log: `CREATE TABLE IF NOT EXISTS autonomous_log (
      user_id TEXT PRIMARY KEY, last_autonomous_at TEXT, last_trend_at TEXT, last_growth_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  };
  if (defs[name]) await db.execute(defs[name]);
}

module.exports = { db, initDB, databasePath };
