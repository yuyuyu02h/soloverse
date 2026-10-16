// 同一ユーザーの世界生成を直列化する（定期ジョブは1プロセスで運用）。
const queues = new Map();
function serializeWorldTask(userId, task) {
  if (process.env.SOLOVERSE_RUNTIME === 'cloudflare') return withLease(userId, task);
  const previous = queues.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(userId, next);
  return next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); });
}
module.exports = { serializeWorldTask };

async function withLease(userId, task) {
  const { db } = require('../db/schema');
  const owner = require('node:crypto').randomUUID();
  const name = `world:${userId}`;
  const now = Date.now();
  const lease = (await db.execute({ sql: `INSERT INTO deployment_locks(name,owner,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<? RETURNING owner`, args: [name,owner,now+3*60000,now] })).rows[0];
  if (lease?.owner !== owner) {
    const error = new Error('世界を更新中です。少し待って再試行してください。入力内容はそのまま残っています。');
    error.code = 'WORLD_BUSY';
    error.retryAt = new Date(Date.now() + 5000).toISOString();
    throw error;
  }
  try { return await task(); }
  finally { const cleanup = db.execute({ sql: 'DELETE FROM deployment_locks WHERE name=? AND owner=?', args: [name,owner] }); db.keepAlive(cleanup); await cleanup; }
}
