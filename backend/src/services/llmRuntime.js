// One runner: priority admission, persistent quota reservations, and content-free telemetry.
const { randomUUID } = require('node:crypto');
const { enabled, config } = require('./contentConfig');
let db;
let active = false;
const waiting = [];
function attachDatabase(client) { db = client; }
class DeferredError extends Error {
  constructor(reason) { super(reason); this.code = 'LLM_DEFERRED'; }
}
function schedule(options, task) {
  if (!enabled()) return task();
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject, priority: options.priority === 'background' ? 1 : 0 });
    drain();
  });
}
async function drain() {
  if (active || !waiting.length) return;
  active = true;
  waiting.sort((a, b) => a.priority - b.priority);
  const next = waiting.shift();
  try { next.resolve(await next.task()); } catch (error) { next.reject(error); }
  finally { active = false; drain(); }
}
async function beforeAttempt(target, options, estimatedTokens) {
  if (!enabled() || !db) return null;
  const cfg = config();
  const isBackground = options.priority === 'background';
  if (isBackground) {
    const replies = await db.execute("SELECT 1 FROM reaction_queue WHERE done=0 AND reaction_type='reply' AND datetime(scheduled_at)<=datetime('now','+3 minutes') LIMIT 1");
    if (waiting.some(item => item.priority === 0) || replies.rows.length) throw new DeferredError('reply_priority');
  }
  const usage = (await db.execute("SELECT COUNT(*) AS requests, COALESCE(SUM(tokens),0) AS tokens FROM llm_attempts WHERE created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now')")).rows[0];
  const fraction = isBackground ? 1 - cfg.replyReserve : 1;
  if (Number(usage.requests) >= Math.floor(cfg.dailyRequests * fraction)
    || Number(usage.tokens) + estimatedTokens > cfg.dailyTokens * fraction) throw new DeferredError('daily_budget');
  const latest = (await db.execute({
    sql: 'SELECT * FROM llm_provider_limits WHERE provider=? AND model=?', args: [target.providerName, target.model],
  })).rows[0];
  if (latest && ((latest.remaining_requests === 0 && latest.reset_requests_at > Date.now())
    || (latest.remaining_tokens != null && latest.remaining_tokens < estimatedTokens && latest.reset_tokens_at > Date.now()))) {
    throw new DeferredError('provider_quota');
  }
  const id = randomUUID();
  await db.execute({ sql: `INSERT INTO llm_attempts(id,user_id,job,priority,provider,model,outcome,tokens,estimated,created_at)
    VALUES(?,?,?,?,?,?,'running',?,1,?)`, args: [id, options.userId || null, options.job || 'unspecified', isBackground ? 'background' : 'interactive', target.providerName, target.model, estimatedTokens, new Date().toISOString()] });
  return id;
}
function resetTime(value) {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Date.now() + Number(value) * 1000;
  let ms = 0;
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  for (const [, n, unit] of parts) ms += Number(n) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit]);
  return parts.length ? Date.now() + ms : null;
}
async function finishAttempt(id, target, response, data, outcome, elapsed) {
  if (!id || !db) return;
  const total = Number(data?.usage?.total_tokens);
  const known = data?.usage?.total_tokens != null && Number.isFinite(total) && total >= 0;
  await db.execute({ sql: 'UPDATE llm_attempts SET outcome=?,status=?,latency_ms=?,tokens=CASE WHEN ? THEN ? ELSE tokens END,estimated=? WHERE id=?',
    args: [outcome, response?.status || null, elapsed, known ? 1 : 0, known ? total : 0, known ? 0 : 1, id] });
  if (response) {
    const numberHeader = name => {
      const raw = response.headers.get(name);
      return raw != null && Number.isFinite(Number(raw)) ? Math.max(0, Number(raw)) : null;
    };
    const rr = numberHeader('x-ratelimit-remaining-requests');
    const rt = numberHeader('x-ratelimit-remaining-tokens');
    const resetR = resetTime(response.headers.get('x-ratelimit-reset-requests'));
    const resetT = resetTime(response.headers.get('x-ratelimit-reset-tokens'));
    await db.execute({ sql: `INSERT INTO llm_provider_limits(provider,model,remaining_requests,remaining_tokens,reset_requests_at,reset_tokens_at,observed_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider,model) DO UPDATE SET remaining_requests=excluded.remaining_requests,remaining_tokens=excluded.remaining_tokens,
      reset_requests_at=excluded.reset_requests_at,reset_tokens_at=excluded.reset_tokens_at,observed_at=excluded.observed_at`,
    args: [target.providerName, target.model, rr, rt, resetR, resetT, new Date().toISOString()] });
  }
}
async function orderTargets(targets) {
  if (!enabled() || !db) return targets;
  const rows = (await db.execute("SELECT provider,model,COUNT(*) AS n,SUM(CASE WHEN outcome IN ('success') THEN 1 ELSE 0 END) AS good FROM llm_attempts WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') AND outcome!='running' GROUP BY provider,model")).rows;
  const score = target => {
    const stat = rows.find(r => r.provider === target.providerName && r.model === target.model);
    return stat && stat.n >= 3 && stat.good / stat.n < 0.5 ? 1 : 0;
  };
  return [...new Set(targets.map(t => t.providerName))].flatMap(provider => targets.filter(t => t.providerName === provider).sort((a, b) => score(a) - score(b)));
}
async function recordContent(userId, job, outcome, reason, scores = {}) {
  if (!enabled() || !db) return;
  await db.execute({ sql: 'INSERT INTO content_events(user_id,job,outcome,reason,scores,created_at) VALUES(?,?,?,?,?,?)',
    args: [userId, job, outcome, reason, JSON.stringify(scores), new Date().toISOString()] });
}
async function diagnostics(userId) {
  const [attempts, content, pool, profiles] = await Promise.all([
    db.execute({ sql: `SELECT provider,model,outcome,COUNT(*) AS count,SUM(tokens) AS tokens,SUM(estimated) AS estimated_count,AVG(latency_ms) AS latency_ms FROM llm_attempts WHERE user_id=? AND created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now') GROUP BY provider,model,outcome`, args: [userId] }),
    db.execute({ sql: "SELECT job,outcome,reason,COUNT(*) AS count FROM content_events WHERE user_id=? AND created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now') GROUP BY job,outcome,reason", args: [userId] }),
    db.execute({ sql: 'SELECT state,source,COUNT(*) AS count FROM content_candidates WHERE user_id=? GROUP BY state,source', args: [userId] }),
    db.execute({ sql: 'SELECT character_id,profile FROM resident_profiles WHERE user_id=?', args: [userId] }),
  ]);
  // Provider quota is shared across accounts: expose only to local CLI, not a tenant API.
  return { mode: enabled() ? 'enhanced' : 'legacy', budget: config(), attempts: attempts.rows, content: content.rows, pool: pool.rows, profiles: profiles.rows.map(r => ({ characterId: r.character_id, profile: JSON.parse(r.profile) })) };
}
module.exports = { attachDatabase, schedule, beforeAttempt, finishAttempt, orderTargets, recordContent, diagnostics, DeferredError, resetTime };
