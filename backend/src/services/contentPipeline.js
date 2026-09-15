const { randomUUID } = require('node:crypto');
const { db } = require('../db/schema');
const { enabled, config } = require('./contentConfig');
const { callLLM, buildWorldSystemPrompt, safeParseJSON } = require('./llm');
const runtime = require('./llmRuntime');
const { evaluate } = require('./contentQuality');
const { residentContext } = require('./residentContext');
const { serializeWorldTask } = require('./worldTasks');

async function world(userId) {
  const [settings, residents, recent, pending] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id=?', args: [userId] }),
    db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id=? ORDER BY id', args: [userId] }),
    db.execute({ sql: "SELECT content FROM posts WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT 50", args: [userId] }),
    db.execute({ sql: "SELECT content FROM content_candidates WHERE user_id=? AND state='pending'", args: [userId] }),
  ]);
  return { settings: settings.rows[0], residents: residents.rows, history: [...recent.rows, ...pending.rows].map(p => p.content) };
}

// Caller holds the existing per-world lock. Each refilling pass is strictly bounded.
async function fillPool(userId, { seed = false } = {}) {
  if (!enabled()) return 0;
  const cfg = config();
  const job = seed ? 'seed_pool' : 'background_pool';
  const state = (await db.execute({ sql: 'SELECT next_fill_at FROM content_pool_state WHERE user_id=?', args: [userId] })).rows[0];
  if (state && Date.parse(state.next_fill_at) > Date.now()) return 0;
  const pending = (await db.execute({ sql: "SELECT COUNT(*) AS n FROM content_candidates WHERE user_id=? AND state='pending'", args: [userId] })).rows[0].n;
  if (pending > 2) return 0;
  const w = await world(userId);
  if (!w.settings || !w.residents.length) return 0;
  const contexts = new Map();
  for (const char of w.residents) contexts.set(char.id, await residentContext(userId, char));
  // Rotate the prompt-sized cast so later-created residents are not permanently excluded.
  const castOffset = Math.floor(Date.now() / (cfg.horizonHours * 3600000)) % w.residents.length;
  const cast = [...w.residents.slice(castOffset), ...w.residents.slice(0, castOffset)].slice(0, 10);
  const target = cfg.poolSize - pending;
  const accepted = [];
  const start = Date.now();
  const maxDue = (await db.execute({ sql: "SELECT MAX(scheduled_at) AS due FROM content_candidates WHERE user_id=? AND state='pending'", args: [userId] })).rows[0].due;
  const begin = Math.max(start, Date.parse(maxDue || '') + 60000 || start);
  // Persist retry pacing even when every model is unavailable or every candidate is rejected.
  await db.execute({ sql: `INSERT INTO content_pool_state(user_id,next_fill_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET next_fill_at=excluded.next_fill_at`, args: [userId, new Date(start + 30 * 60000).toISOString()] });
  for (let pass = 0; pass < cfg.refillAttempts && accepted.length < target; pass++) {
    const missing = target - accepted.length;
    let resultMeta;
    let raw;
    try {
      raw = await callLLM(buildWorldSystemPrompt(w.settings, null, [
        '現実にいるファンの日常。短い具体的な体験・好み・理由を1つずつ述べる。抽象的な比喩を連発しない',
        'これは時間差で公開する投稿候補。天気・現在時刻・ニュース・ユーザーの未来の発言を推測しない',
        '投稿ごとに人物を分散する。一部は今回配列の先行投稿への返信にする',
      ]), `日常投稿を${missing}件だけ生成してください（不足分の補充${pass + 1}回目）。各本文は20〜100字。
住人と構造化プロフィール・短期記憶:
${JSON.stringify(cast.map(c => ({ username: c.username, profile: contexts.get(c.id).profile, memory: contexts.get(c.id).memory.slice(0, 2).map(s => s.slice(0, 80)) })))}
直近と今回採用済みの内容（繰り返さない）:
${JSON.stringify([...w.history.slice(0, 10), ...accepted.map(a => a.content)].slice(-30))}
JSON配列のみ: [{"username":"住人のusername","content":"具体的な投稿","reply_to_index":null}]
返信はこの配列の先行indexを指定する。半日分の多様な話題を用意する。`,
      Math.min(10000, missing * 160 + 400), { userId, job, priority: seed ? 'interactive' : 'background', expectJSON: true, onResult: meta => { resultMeta = meta; } });
    } catch (error) {
      await runtime.recordContent(userId, job, 'deferred', error.code === 'LLM_DEFERRED' ? error.message : 'provider_unavailable');
      break;
    }
    const rows = safeParseJSON(raw);
    if (!Array.isArray(rows)) {
      if (resultMeta?.attemptId) await db.execute({ sql: "UPDATE llm_attempts SET outcome='quality_rejected' WHERE id=?", args: [resultMeta.attemptId] });
      await runtime.recordContent(userId, job, 'rejected', 'array_required');
      continue;
    }
    const localIds = new Map();
    let addedThisPass = 0;
    for (const [index, item] of rows.entries()) {
      await runtime.recordContent(userId, job, 'generated', 'candidate');
      if (index >= missing) { await runtime.recordContent(userId, job, 'rejected', 'excess_candidate'); continue; }
      const char = w.residents.find(c => c.username === String(item?.username || '').replace(/^@/, ''));
      if (!char) { await runtime.recordContent(userId, job, 'rejected', 'unknown_resident'); continue; }
      const parent = item.reply_to_index == null ? null : localIds.get(item.reply_to_index);
      if (item.reply_to_index != null && (!Number.isInteger(item.reply_to_index) || item.reply_to_index >= index || !parent)) {
        await runtime.recordContent(userId, job, 'rejected', 'invalid_parent'); continue;
      }
      const assessment = evaluate(item.content, { settings: w.settings, profile: contexts.get(char.id).profile, history: [...w.history, ...accepted.map(a => a.content)], target: parent?.content || '' });
      await runtime.recordContent(userId, job, assessment.accepted ? 'accepted' : 'rejected', assessment.reason, assessment.scores);
      if (!assessment.accepted) continue;
      const initialCount = seed ? Math.min(8, cfg.poolSize) : 0;
      const offset = accepted.length < initialCount ? 0
        : cfg.horizonHours * 3600000 * (accepted.length - initialCount + (seed ? 1 : 0)) / Math.max(1, cfg.poolSize - initialCount);
      const due = Math.max(begin + offset, parent ? Date.parse(parent.scheduled_at) + 60000 : begin);
      const candidate = { id: randomUUID(), char, content: item.content.trim(), parent_id: parent?.id || null, scheduled_at: new Date(due).toISOString() };
      accepted.push(candidate); localIds.set(index, candidate); addedThisPass++;
    }
    if (!addedThisPass && resultMeta?.attemptId) await db.execute({ sql: "UPDATE llm_attempts SET outcome='quality_rejected' WHERE id=?", args: [resultMeta.attemptId] });
  }
  if (accepted.length) {
    await db.batch(accepted.map(c => ({ sql: `INSERT INTO content_candidates(id,user_id,character_id,content,parent_id,source,scheduled_at,created_at) VALUES(?,?,?,?,?,'llm',?,?)`, args: [c.id, userId, c.char.id, c.content, c.parent_id, c.scheduled_at, new Date().toISOString()] })), 'write');
  }
  if (accepted.length < target && cfg.templates) await ambientFallback(userId, w, contexts, job);
  return accepted.length;
}

async function ambientFallback(userId, w, contexts, job) {
  const recent = (await db.execute({ sql: "SELECT COUNT(*) AS n FROM content_candidates WHERE user_id=? AND source='template' AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')", args: [userId] })).rows[0].n;
  if (recent >= 2) return;
  const count = (await db.execute({ sql: "SELECT COUNT(*) AS n FROM content_candidates WHERE user_id=? AND state='pending'", args: [userId] })).rows[0].n;
  if (count >= 4) return;
  const templates = [
    topic => `${topic}で気になったところをメモに残していたら、見返したいものが増えてきた。`,
    topic => `${topic}の話を聞くと、自分では見落としていた楽しみ方に気づけるのがいい。`,
    topic => `${topic}について好きなところを一つ挙げようとすると、意外と迷ってしまう。`,
    topic => `${topic}のメモを整理した。気になった理由も一緒に書いておくと後で思い出せる。`,
  ];
  for (const char of w.residents) {
    const topic = contexts.get(char.id).profile.topics[0] || w.settings.interests;
    for (const template of templates) {
      const content = template(topic);
      const history = (await world(userId)).history;
      const assessment = evaluate(content, { settings: w.settings, profile: contexts.get(char.id).profile, history });
      if (!assessment.accepted) continue;
      await db.execute({ sql: `INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at) VALUES(?,?,?,?,'template',?,?)`, args: [randomUUID(), userId, char.id, content, new Date().toISOString(), new Date().toISOString()] });
      await runtime.recordContent(userId, job, 'template', 'low_pool');
      return;
    }
  }
}

async function publishPool(userId) {
  if (!enabled()) return 0;
  const rows = (await db.execute({ sql: "SELECT * FROM content_candidates WHERE user_id=? AND state='pending' AND scheduled_at<=? ORDER BY scheduled_at,id LIMIT 8", args: [userId, new Date().toISOString()] })).rows;
  let count = 0;
  for (const row of rows) {
    const char = (await db.execute({ sql: 'SELECT id FROM ai_characters WHERE id=? AND user_id=?', args: [row.character_id, userId] })).rows[0];
    const parent = row.parent_id ? (await db.execute({ sql: 'SELECT id FROM posts WHERE id=? AND user_id=?', args: [row.parent_id, userId] })).rows[0] : null;
    if (!char || (row.parent_id && !parent)) {
      const pendingParent = row.parent_id && (await db.execute({ sql: "SELECT id FROM content_candidates WHERE id=? AND user_id=? AND state='pending'", args: [row.parent_id, userId] })).rows.length;
      if (pendingParent) continue;
      await db.execute({ sql: "UPDATE content_candidates SET state='discarded' WHERE id=? AND user_id=?", args: [row.id, userId] });
      await runtime.recordContent(userId, 'publish', 'rejected', 'missing_parent_or_resident');
      continue;
    }
    const now = new Date().toISOString();
    // Atomic publication with deterministic post ID: restart/repeated delivery cannot duplicate a post.
    await db.batch([
      { sql: `INSERT INTO posts(id,user_id,author_id,author_type,content,reply_to,created_at,ai)
          SELECT id,user_id,character_id,'ai',content,parent_id,?,1 FROM content_candidates WHERE id=? AND user_id=? AND state='pending'
          ON CONFLICT(id) DO NOTHING`, args: [now, row.id, userId] },
      { sql: "UPDATE content_candidates SET state='published',published_at=? WHERE id=? AND user_id=? AND state='pending'", args: [now, row.id, userId] },
    ], 'write');
    await runtime.recordContent(userId, 'publish', 'published', row.source);
    count++;
  }
  return count;
}

async function seedEnhanced(userId) {
  const exists = await db.execute({ sql: "SELECT 1 FROM posts WHERE user_id=? AND author_type='ai' LIMIT 1", args: [userId] });
  if (exists.rows.length) return 0;
  await fillPool(userId, { seed: true });
  const count = await publishPool(userId);
  if (!count) throw new Error('初期投稿は準備中です。時間をおいて再試行してください');
  return count;
}

async function generateReply(userId, char, settings, target, { job = 'reply', priority = 'interactive', ambient = false, instruction = '相手の問いに具体的に答える。20〜140字。本文のみ' } = {}) {
  const ctx = await residentContext(userId, char);
  let reasons = '';
  for (let i = 0; i < config().refillAttempts; i++) {
    let meta;
    const text = await callLLM(buildWorldSystemPrompt(settings, char, [instruction]),
      `構造化プロフィール: ${JSON.stringify(ctx.profile)}\n最近の実際の発言・会話: ${JSON.stringify(ctx.memory)}\n返信対象: ${target}\n${reasons}`,
      450, { userId, job, priority, expectJSON: false, onResult: result => { meta = result; } });
    await runtime.recordContent(userId, job, 'generated', 'candidate');
    const quality = evaluate(text, { settings, profile: ctx.profile, history: ctx.memory, target, ambient });
    await runtime.recordContent(userId, job, quality.accepted ? 'accepted' : 'rejected', quality.reason, quality.scores);
    if (quality.accepted) return text.trim();
    if (meta?.attemptId) await db.execute({ sql: "UPDATE llm_attempts SET outcome='quality_rejected' WHERE id=?", args: [meta.attemptId] });
    reasons = `前回は${quality.reason}で不採用。対象への結論と具体的理由を示し、同じ文を使わない。`;
  }
  throw new Error('返信品質チェックを通過できませんでした');
}

async function publishAll() {
  if (!enabled()) return;
  const users = (await db.execute("SELECT DISTINCT user_id FROM content_candidates WHERE state='pending' AND scheduled_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')")).rows;
  for (const { user_id: userId } of users) await serializeWorldTask(userId, () => publishPool(userId));
  await db.batch([
    "DELETE FROM content_events WHERE created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    "DELETE FROM llm_attempts WHERE created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    "DELETE FROM content_candidates WHERE state!='pending' AND created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
  ], 'write');
}
module.exports = { fillPool, publishPool, seedEnhanced, generateReply, publishAll };
