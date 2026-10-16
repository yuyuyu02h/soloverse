// 発表用の任意機能。DEMO_RESET_USER_IDS を空にすると全アカウントで無効。
const { db } = require('../db/schema');
const { isAdminUser } = require('../middleware/admin');
const { serializeWorldTask } = require('./worldTasks');

function resetsOnLogout(userId, scope = 'user') {
  return scope === 'user' && isAdminUser(userId) && String(process.env.DEMO_RESET_USER_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean).includes(userId);
}

async function resetDemoWorld(userId, sessionId) {
  return serializeWorldTask(userId, async () => {
    // 子テーブルから消す。認証情報・管理者権限・使用済みAI枠は保持する。
    const tables = ['celebrity_comments', 'celebrity_scenes', 'celebrity_notification_preferences',
      'resident_memory', 'resident_profiles', 'content_candidates', 'content_pool_state',
      'reaction_queue', 'notifications', 'likes', 'posts', 'trends', 'character_growth_log',
      'ai_characters', 'autonomous_log', 'content_events', 'world_theme_state', 'world_settings'];
    const now = Date.now();
    await db.batch([
      ...tables.map(table => ({ sql: `DELETE FROM ${table} WHERE user_id=?`, args: [userId] })),
      { sql: 'UPDATE users SET onboarding_done=0 WHERE id=?', args: [userId] },
      { sql: 'UPDATE generation_sessions SET active_until=0,revoked_at=? WHERE user_id=?', args: [now, userId] },
      { sql: `INSERT INTO generation_sessions(session_id,user_id,active_until,revoked_at) VALUES(?,?,0,?)
          ON CONFLICT(session_id) DO UPDATE SET active_until=0,revoked_at=excluded.revoked_at`, args: [sessionId, userId, now] },
    ], 'write');
  });
}
module.exports = { resetsOnLogout, resetDemoWorld };
