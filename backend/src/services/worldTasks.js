// 同一ユーザーの世界生成を直列化する（定期ジョブは1プロセスで運用）。
const queues = new Map();
function serializeWorldTask(userId, task) {
  const previous = queues.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(userId, next);
  return next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); });
}
module.exports = { serializeWorldTask };
