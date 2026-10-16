const { createHash } = require('node:crypto');
const { db } = require('../db/schema');

// A visible client renews this lease once a minute. Old accounts start paused.
const ACTIVITY_TTL_MS = 5 * 60 * 1000;

async function initActivitySchema() {
  await db.execute(`CREATE TABLE IF NOT EXISTS generation_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    active_until INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_generation_sessions_active ON generation_sessions(user_id,revoked_at,active_until)');
}

function sessionId(token) {
  // Store only a fingerprint, never the bearer token itself.
  return createHash('sha256').update(token).digest('hex');
}

async function isSessionRevoked(id) {
  const row = (await db.execute({ sql: 'SELECT revoked_at FROM generation_sessions WHERE session_id=?', args: [id] })).rows[0];
  return row?.revoked_at != null;
}

async function touchSession(userId, id) {
  await db.execute({
    sql: `INSERT INTO generation_sessions(session_id,user_id,active_until) VALUES(?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET active_until=excluded.active_until
      WHERE generation_sessions.revoked_at IS NULL AND generation_sessions.user_id=excluded.user_id`,
    args: [id, userId, Date.now() + ACTIVITY_TTL_MS],
  });
}

async function revokeSession(userId, id) {
  await db.execute({
    sql: `INSERT INTO generation_sessions(session_id,user_id,active_until,revoked_at) VALUES(?,?,0,?)
      ON CONFLICT(session_id) DO UPDATE SET active_until=0,revoked_at=excluded.revoked_at
      WHERE generation_sessions.user_id=excluded.user_id`,
    args: [id, userId, Date.now()],
  });
}

// Only fixed SQL column expressions from our callers may be passed here.
function activeGenerationSQL(userExpression) {
  return `EXISTS (SELECT 1 FROM generation_sessions gs WHERE gs.user_id=${userExpression}
    AND gs.revoked_at IS NULL AND gs.active_until>${Date.now()})`;
}

async function isGenerationActive(userId) {
  return (await db.execute({ sql: `SELECT 1 WHERE ${activeGenerationSQL('?')}`, args: [userId] })).rows.length > 0;
}

module.exports = { ACTIVITY_TTL_MS, initActivitySchema, sessionId, isSessionRevoked, touchSession, revokeSession, activeGenerationSQL, isGenerationActive };
