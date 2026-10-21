-- Empty schema only: contains no accounts, posts, credentials, or API keys.
CREATE TABLE ai_characters (
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
      created_at TEXT DEFAULT (datetime('now')), theme_version INTEGER NOT NULL DEFAULT 1, participation_role TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE autonomous_log (
      user_id TEXT PRIMARY KEY,
      last_autonomous_at TEXT,
      last_trend_at TEXT,
      last_growth_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE celebrity_comments (
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
    );

CREATE TABLE celebrity_notification_preferences (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_read_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE celebrity_scenes (
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
    );

CREATE TABLE character_growth_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      trigger_reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE content_candidates(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,character_id TEXT NOT NULL,content TEXT NOT NULL,parent_id TEXT,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','published','discarded')),source TEXT NOT NULL,scheduled_at TEXT NOT NULL,created_at TEXT NOT NULL,published_at TEXT, theme_version INTEGER NOT NULL DEFAULT 1, reviewed INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(character_id) REFERENCES ai_characters(id) ON DELETE CASCADE);

CREATE TABLE content_events(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,job TEXT NOT NULL,outcome TEXT NOT NULL,reason TEXT NOT NULL,scores TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);

CREATE TABLE content_pool_state(user_id TEXT PRIMARY KEY,next_fill_at TEXT NOT NULL, theme_version INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);

CREATE TABLE generation_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    active_until INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

CREATE TABLE likes (
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
    );

CREATE TABLE llm_attempts(id TEXT PRIMARY KEY,user_id TEXT,job TEXT NOT NULL,priority TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,outcome TEXT NOT NULL,status INTEGER,latency_ms INTEGER,tokens INTEGER NOT NULL,estimated INTEGER NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE llm_provider_limits(provider TEXT NOT NULL,model TEXT NOT NULL,remaining_requests INTEGER,remaining_tokens INTEGER,reset_requests_at INTEGER,reset_tokens_at INTEGER,observed_at TEXT NOT NULL,PRIMARY KEY(provider,model));

CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      character_id TEXT,
      post_id TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('user', 'ai')),
      ai INTEGER DEFAULT 0,
      content TEXT NOT NULL,
      reply_to TEXT,
      created_at TEXT DEFAULT (datetime('now')), theme_version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE reaction_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL CHECK (reaction_type IN ('like', 'reply', 'repost')),
      scheduled_at TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), theme_version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE resident_memory(character_id TEXT NOT NULL,user_id TEXT NOT NULL,post_id TEXT NOT NULL,PRIMARY KEY(character_id,post_id),FOREIGN KEY(character_id) REFERENCES ai_characters(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE);

CREATE TABLE resident_profiles(character_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,profile TEXT NOT NULL,FOREIGN KEY(character_id) REFERENCES ai_characters(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);

CREATE TABLE trends (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      description TEXT NOT NULL,
      post_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), theme_version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT NOT NULL,
      onboarding_done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

CREATE TABLE world_settings (
      user_id TEXT PRIMARY KEY,
      position TEXT NOT NULL,
      interests TEXT NOT NULL,
      atmosphere TEXT NOT NULL,
      exclusions TEXT NOT NULL DEFAULT '',
      follower_scale TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE world_theme_state(user_id TEXT PRIMARY KEY,theme TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,changed_at TEXT NOT NULL, position TEXT NOT NULL DEFAULT '',FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);

CREATE INDEX idx_ai_characters_theme ON ai_characters(user_id,theme_version);

CREATE INDEX idx_candidates_due ON content_candidates(user_id,state,scheduled_at);

CREATE INDEX idx_celebrity_comments_post
      ON celebrity_comments(user_id, scene_post_id, created_at);

CREATE INDEX idx_celebrity_scenes_pending
      ON celebrity_scenes(status, started_at);

CREATE INDEX idx_celebrity_scenes_user
      ON celebrity_scenes(user_id, started_at);

CREATE INDEX idx_characters_user ON ai_characters(user_id, created_at);

CREATE INDEX idx_content_candidates_theme ON content_candidates(user_id,theme_version);

CREATE INDEX idx_content_events_date ON content_events(user_id,created_at);

CREATE INDEX idx_content_pool_state_theme ON content_pool_state(user_id,theme_version);

CREATE INDEX idx_generation_sessions_active ON generation_sessions(user_id,revoked_at,active_until);

CREATE INDEX idx_likes_post ON likes(post_id);

CREATE INDEX idx_llm_attempts_date ON llm_attempts(created_at,user_id);

CREATE INDEX idx_notifications_user_dt ON notifications(user_id, read, datetime(created_at) DESC);

CREATE INDEX idx_posts_replies_dt ON posts(user_id, reply_to, datetime(created_at));

CREATE INDEX idx_posts_theme ON posts(user_id,theme_version);

CREATE INDEX idx_posts_timeline_dt ON posts(user_id, reply_to, datetime(created_at) DESC);

CREATE INDEX idx_reaction_queue_due_dt ON reaction_queue(done, datetime(scheduled_at));

CREATE INDEX idx_reaction_queue_theme ON reaction_queue(user_id,theme_version);

CREATE INDEX idx_trends_theme ON trends(user_id,theme_version);

CREATE TABLE deployment_locks(name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE login_rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
