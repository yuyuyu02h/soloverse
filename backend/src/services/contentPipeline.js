const { randomUUID } = require('node:crypto');
const { db } = require('../db/schema');
const { enabled, config } = require('./contentConfig');
const { callLLM, buildWorldSystemPrompt, safeParseJSON } = require('./llm');
const runtime = require('./llmRuntime');
const { evaluate } = require('./contentQuality');
const { residentContext, residentContexts } = require('./residentContext');
const { serializeWorldTask } = require('./worldTasks');
const { themeState, currentVersion } = require('./worldTheme');
const { topicHints } = require('./topicPolicy');
const { reviewBatch } = require('./contentReview');
const { resolveMode } = require('./worldModes');
const { isGenerationActive, activeGenerationSQL } = require('./generationActivity');

async function world(userId) {
  const settings = await themeState(userId);
  const [residents, recent, pending] = await Promise.all([
    db.execute({ sql: `SELECT * FROM ai_characters c WHERE user_id=? AND ${currentVersion('c')} ORDER BY id`, args: [userId] }),
    db.execute({ sql: `SELECT id,author_id,content,reply_to FROM posts p WHERE user_id=? AND ${currentVersion('p')} ORDER BY datetime(created_at) DESC LIMIT 50`, args: [userId] }),
    db.execute({ sql: `SELECT content FROM content_candidates c WHERE user_id=? AND ${currentVersion('c')} AND state='pending'`, args: [userId] }),
  ]);
  return { settings, residents: residents.rows, recent: recent.rows, history: [...recent.rows, ...pending.rows].map(p => p.content) };
}


async function deferPool(userId, settings, error, fallback = 'provider_unavailable') {
  const reason = error.code === 'LLM_DEFERRED' ? error.message : fallback;
  const retryAt = error.retryAt || new Date(Date.now() + 60000).toISOString();
  await db.execute({ sql: 'UPDATE content_pool_state SET next_fill_at=?,defer_reason=? WHERE user_id=? AND theme_version=?', args: [retryAt, reason, userId, settings.theme_version] });
  return reason;
}

// Caller holds the existing per-world lock. Each refilling pass is strictly bounded.
async function fillPool(userId, { seed = false } = {}) {
  if (!enabled()) return 0;
  if (!await isGenerationActive(userId)) return 0;
  const cfg = config();
  const settings = await themeState(userId);
  if (!settings) return 0;
  const job = seed ? 'seed_pool' : 'background_pool';
  const state = (await db.execute({ sql: 'SELECT next_fill_at,theme_version FROM content_pool_state WHERE user_id=?', args: [userId] })).rows[0];
  if (state?.theme_version === settings.theme_version && Date.parse(state.next_fill_at) > Date.now()) return 0;
  const pending = (await db.execute({ sql: `SELECT COUNT(*) AS n FROM content_candidates c WHERE user_id=? AND ${currentVersion('c')} AND state='pending'`, args: [userId] })).rows[0].n;
  if (pending > 2) return 0;
  const w = await world(userId);
  if (!w.settings || !w.residents.length) return 0;
  // Rotate the prompt-sized cast so later-created residents are not permanently excluded.
  const castOffset = Math.floor(Date.now() / (cfg.horizonHours * 3600000)) % w.residents.length;
  const cast = [...w.residents.slice(castOffset), ...w.residents.slice(0, castOffset)].slice(0, seed ? 4 : 10);
  const contexts = await residentContexts(userId, cast, settings);
  const target = (seed ? Math.min(4, cfg.poolSize) : cfg.poolSize) - pending;
  const accepted = [];
  const start = Date.now();
  const maxDue = (await db.execute({ sql: `SELECT MAX(scheduled_at) AS due FROM content_candidates c WHERE user_id=? AND ${currentVersion('c')} AND state='pending'`, args: [userId] })).rows[0].due;
  const begin = Math.max(start, Date.parse(maxDue || '') + 60000 || start);
  // Persist retry pacing even when every model is unavailable or every candidate is rejected.
  await db.execute({ sql: `INSERT INTO content_pool_state(user_id,next_fill_at,theme_version) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET next_fill_at=excluded.next_fill_at,theme_version=excluded.theme_version,defer_reason=''`, args: [userId, new Date(start + 30 * 60000).toISOString(), settings.theme_version] });
  for (let pass = 0; pass < cfg.refillAttempts && accepted.length < target; pass++) {
    const missing = target - accepted.length;
    let resultMeta;
    let raw;
    try {
      raw = await callLLM(buildWorldSystemPrompt(w.settings, null, [
        resolveMode(w.settings) === 'hobby'
          ? '趣味や専門分野の体験・工夫・質問を共有する。全員が共感語や助言で返さず、関わり方を分ける'
          : resolveMode(w.settings) === 'community'
            ? '界隈の日常の短い独り言、温度差のある感想、住人同士の内輪の会話を混ぜる。毎回説明や励ましで締めない'
            : '有名人を取り巻くファン、初見、同業者の自然な日常。全員を称賛役にせず、本人の投稿がない時に発言を捏造しない',
        'これは時間差で公開する投稿候補。天気・現在時刻・ニュース・ユーザーの未来の発言を推測しない',
        '投稿ごとに人物を分散する。3件以上作る時は最低1件、別の住人への具体的な返信を含める',
        resolveMode(w.settings) === 'celebrity'
          ? `ユーザーの役割は「${settings.interests}」。活動に関係する話題や本人の日常への反応を自然に扱う。全投稿に役割名を入れる必要はない`
          : `世界のテーマ・界隈は「${settings.interests}」。個人の無関係な趣味だけでは投稿しない。関連語の例: ${topicHints(settings.interests)}。用語を毎回詰め込まず、返信は親の文脈を引き継ぐ`,
      ]), `日常投稿を${missing}件だけ生成してください（不足分の補充${pass + 1}回目）。各本文は20〜100字。
住人と構造化プロフィール・短期記憶:
${JSON.stringify(cast.map(c => ({ username: c.username, profile: (({ fingerprint, ...profile }) => profile)(contexts.get(c.id).profile), memory: contexts.get(c.id).memory.slice(0, 2).map(s => s.slice(0, 80)) })))}
直近と今回採用済みの内容（繰り返さない）:
${JSON.stringify([...w.history.slice(0, 10), ...accepted.map(a => a.content)].slice(-30))}
JSON配列のみ: [{"username":"住人のusername","content":"具体的な投稿","reply_to_index":null}]
返信はこの配列の先行indexを指定する。または次の既存投稿のidをreply_to_idに指定し、会話の続きを書ける。同じ人への自分自身の返信は禁止。
${JSON.stringify(w.recent.filter(p => !p.reply_to).slice(0, 6))}
返信例: [{"username":"住人A","content":"テーマの具体的な問い","reply_to_index":null},{"username":"住人B","content":"その問いへの答えと理由","reply_to_index":0}]
半日分の多様な話題を用意する。`,
      Math.min(10000, missing * 160 + 400), { userId, job, priority: seed ? 'interactive' : 'background', expectJSON: true, onResult: meta => { resultMeta = meta; } });
    } catch (error) {
      if (error.code === 'LLM_DEFERRED' && error.message === 'user_inactive') {
        // Pausing is not a provider failure: do not make a returning user wait 30 minutes.
        await db.execute({ sql: 'UPDATE content_pool_state SET next_fill_at=? WHERE user_id=? AND theme_version=?', args: [new Date().toISOString(), userId, settings.theme_version] });
        return 0;
      }
      const reason = await deferPool(userId, settings, error);
      await runtime.recordContent(userId, job, 'deferred', reason);
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
      const char = cast.find(c => c.username === String(item?.username || '').replace(/^@/, ''));
      if (!char) { await runtime.recordContent(userId, job, 'rejected', 'unknown_resident'); continue; }
      const existingParent = item.reply_to_id ? w.recent.find(p => p.id === item.reply_to_id && !p.reply_to && p.author_id !== char.id) : null;
      if (item.reply_to_id && (!existingParent || item.reply_to_index != null)) { await runtime.recordContent(userId, job, 'rejected', 'invalid_parent'); continue; }
      const parent = item.reply_to_index == null ? existingParent : localIds.get(item.reply_to_index);
      if (item.reply_to_index != null && (!Number.isInteger(item.reply_to_index) || item.reply_to_index >= index || !parent)) {
        await runtime.recordContent(userId, job, 'rejected', 'invalid_parent'); continue;
      }
      if (parent?.char?.id === char.id) { await runtime.recordContent(userId, job, 'rejected', 'self_reply'); continue; }
      const assessment = evaluate(item.content, { settings: w.settings, profile: contexts.get(char.id).profile, history: [...w.history, ...accepted.map(a => a.content)], target: parent?.content || '', semanticReview: cfg.review });
      await runtime.recordContent(userId, job, assessment.accepted ? (cfg.review ? 'screened' : 'accepted') : 'rejected', assessment.reason, assessment.scores);
      if (!assessment.accepted) continue;
      const initialCount = seed ? Math.min(8, cfg.poolSize) : 0;
      const offset = accepted.length < initialCount ? 0
        : cfg.horizonHours * 3600000 * (accepted.length - initialCount + (seed ? 1 : 0)) / Math.max(1, cfg.poolSize - initialCount);
      const due = Math.max(begin + offset, parent?.scheduled_at ? Date.parse(parent.scheduled_at) + 60000 : begin);
      const candidate = { id: randomUUID(), char, content: item.content.trim(), parent_id: parent?.id || null, scheduled_at: new Date(due).toISOString() };
      accepted.push(candidate); localIds.set(index, candidate); addedThisPass++;
    }
    if (!addedThisPass && resultMeta?.attemptId) await db.execute({ sql: "UPDATE llm_attempts SET outcome='quality_rejected' WHERE id=?", args: [resultMeta.attemptId] });
  }
  let reviewed = false;
  let reviewDeferred = false;
  if (accepted.length && cfg.review) {
    try {
      const verdicts = await reviewBatch(userId, w.settings, accepted.map(c => ({ content:c.content,parent:accepted.find(p=>p.id===c.parent_id)?.content || w.recent.find(p=>p.id===c.parent_id)?.content })), { priority:seed ? 'interactive' : 'background' });
      const kept = new Set();
      const approved = [];
      for (const [index,candidate] of accepted.entries()) {
        const verdict = verdicts[index];
        const parentApproved = !candidate.parent_id || kept.has(candidate.parent_id) || w.recent.some(p=>p.id===candidate.parent_id);
        const ok = verdict.accepted && parentApproved;
        await runtime.recordContent(userId, job, ok ? 'accepted' : 'rejected', parentApproved ? verdict.reason : 'invalid_parent');
        if (ok) { kept.add(candidate.id); approved.push(candidate); }
      }
      accepted.splice(0,accepted.length,...approved);
      reviewed = true;
    } catch (error) {
      if (error.code === 'LLM_DEFERRED' && error.message === 'user_inactive') {
        await db.execute({ sql: 'UPDATE content_pool_state SET next_fill_at=? WHERE user_id=? AND theme_version=?', args: [new Date().toISOString(), userId, settings.theme_version] });
        return 0;
      }
      const reason = await deferPool(userId, settings, error, 'quality_review_wait');
      await runtime.recordContent(userId,job,'deferred',reason);
      if (!['provider_quota','provider_cooldown','daily_budget'].includes(reason)) {
        if (cfg.templates) await ambientFallback(userId,w,contexts,job);
        return 0;
      }
      reviewDeferred = true;
      // Keep unreviewed candidates; publication will review them after quota recovers.
    }
  }
  if (accepted.length) {
    if ((await themeState(userId))?.theme_version !== settings.theme_version) return 0;
    await db.batch(accepted.map(c => ({ sql: `INSERT INTO content_candidates(id,user_id,character_id,content,parent_id,source,scheduled_at,created_at,theme_version,reviewed) VALUES(?,?,?,?,?,?,?,?,?,?)`, args: [c.id, userId, c.char.id, c.content, c.parent_id, 'llm', c.scheduled_at, new Date().toISOString(), settings.theme_version,reviewed ? 1 : 0] })), 'write');
  }
  if (accepted.length < target && cfg.templates) await ambientFallback(userId, w, contexts, job);
  return reviewDeferred ? 0 : accepted.length;
}

async function ambientFallback(userId, w, contexts, job) {
  // Generic encouragement templates undermine the realism of the other experiences.
  if (resolveMode(w.settings) !== 'hobby') return;
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
    if (!contexts.has(char.id)) continue;
    const topic = w.settings.interests;
    for (const template of templates) {
      const content = template(topic);
      const history = (await world(userId)).history;
      const assessment = evaluate(content, { settings: w.settings, profile: contexts.get(char.id).profile, history });
      if (!assessment.accepted) continue;
      await db.execute({ sql: `INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at,theme_version,reviewed) VALUES(?,?,?,?,'template',?,?,?,1)`, args: [randomUUID(), userId, char.id, content, new Date().toISOString(), new Date().toISOString(), w.settings.theme_version] });
      await runtime.recordContent(userId, job, 'template', 'low_pool');
      return;
    }
  }
}

async function publishPool(userId) {
  if (!enabled()) return 0;
  if (!await isGenerationActive(userId)) return 0;
  const settings = await themeState(userId);
  if (!settings) return 0;
  await db.execute({ sql: "UPDATE content_candidates SET state='discarded' WHERE user_id=? AND state='pending' AND theme_version!=?", args: [userId, settings.theme_version] });
  const rows = (await db.execute({ sql: "SELECT * FROM content_candidates WHERE user_id=? AND state='pending' AND scheduled_at<=? ORDER BY scheduled_at,id LIMIT 8", args: [userId, new Date().toISOString()] })).rows;
  if (process.env.SOLOVERSE_RUNTIME === 'cloudflare') rows.splice(4);
  const unchecked = rows.filter(row=>!row.reviewed);
  if (unchecked.length && config().review) {
    try {
      const inputs = [];
      for (const row of unchecked) {
        const parent = row.parent_id ? (await db.execute({sql:'SELECT content FROM posts WHERE id=? AND user_id=? UNION ALL SELECT content FROM content_candidates WHERE id=? AND user_id=? LIMIT 1',args:[row.parent_id,userId,row.parent_id,userId]})).rows[0] : null;
        inputs.push({content:row.content,parent:parent?.content});
      }
      const verdicts = await reviewBatch(userId,settings,inputs);
      await db.batch(unchecked.map((row,index)=>({sql:'UPDATE content_candidates SET reviewed=1,state=? WHERE id=? AND user_id=?',args:[verdicts[index].accepted ? 'pending' : 'discarded',row.id,userId]})),'write');
      for (const [index,row] of unchecked.entries()) {
        row.reviewed=1;
        if (!verdicts[index].accepted) {
          row.state='discarded';
          await runtime.recordContent(userId,'publish','rejected',verdicts[index].reason);
        }
      }
    } catch (error) {
      const reason = await deferPool(userId, settings, error, 'quality_review_wait');
      await runtime.recordContent(userId,'publish','deferred',reason);
      return 0;
    }
  }
  const residents = process.env.SOLOVERSE_RUNTIME === 'cloudflare' && rows.length ? (await db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id=? AND theme_version=?', args:[userId,settings.theme_version] })).rows : null;
  const contexts = residents?.length ? await residentContexts(userId,residents,settings) : null;
  let count = 0;
  for (const row of rows) {
    if (row.state !== 'pending') continue;
    const char = residents ? residents.find(c=>c.id===row.character_id) : (await db.execute({ sql: 'SELECT * FROM ai_characters WHERE id=? AND user_id=? AND theme_version=?', args: [row.character_id, userId, settings.theme_version] })).rows[0];
    const parent = row.parent_id ? (await db.execute({ sql: 'SELECT id,content FROM posts WHERE id=? AND user_id=? AND theme_version=?', args: [row.parent_id, userId, settings.theme_version] })).rows[0] : null;
    if (!char || (row.parent_id && !parent)) {
      const pendingParent = row.parent_id && (await db.execute({ sql: "SELECT id FROM content_candidates WHERE id=? AND user_id=? AND state='pending'", args: [row.parent_id, userId] })).rows.length;
      if (pendingParent) continue;
      await db.execute({ sql: "UPDATE content_candidates SET state='discarded' WHERE id=? AND user_id=?", args: [row.id, userId] });
      await runtime.recordContent(userId, 'publish', 'rejected', 'missing_parent_or_resident');
      continue;
    }
    const assessment = evaluate(row.content, { settings, profile: (contexts?.get(char.id) || await residentContext(userId, char)).profile, target: parent?.content || '', semanticReview: Boolean(row.reviewed && row.source === 'llm') && config().review });
    if (!assessment.accepted) {
      await db.execute({ sql: "UPDATE content_candidates SET state='discarded' WHERE id=?", args: [row.id] });
      await runtime.recordContent(userId, 'publish', 'rejected', assessment.reason, assessment.scores);
      continue;
    }
    const now = new Date().toISOString();
    // Atomic publication with deterministic post ID: restart/repeated delivery cannot duplicate a post.
    await db.batch([
      { sql: `INSERT INTO posts(id,user_id,author_id,author_type,content,reply_to,created_at,ai,theme_version)
          SELECT id,user_id,character_id,'ai',content,parent_id,?,1,theme_version FROM content_candidates WHERE id=? AND user_id=? AND state='pending'
          ON CONFLICT(id) DO NOTHING`, args: [now, row.id, userId] },
      { sql: "UPDATE content_candidates SET state='published',published_at=? WHERE id=? AND user_id=? AND state='pending'", args: [now, row.id, userId] },
    ], 'write');
    await runtime.recordContent(userId, 'publish', 'published', row.source);
    count++;
  }
  return count;
}

async function seedEnhanced(userId) {
  await themeState(userId);
  const exists = await db.execute({ sql: `SELECT 1 FROM posts p WHERE user_id=? AND ${currentVersion('p')} AND author_type='ai' LIMIT 1`, args: [userId] });
  if (exists.rows.length) return 0;
  await fillPool(userId, { seed: true });
  const count = await publishPool(userId);
  if (!count) {
    const state = (await db.execute({ sql: 'SELECT next_fill_at,defer_reason FROM content_pool_state WHERE user_id=?', args: [userId] })).rows[0];
    throw new runtime.DeferredError(state?.defer_reason || 'initial_posts_wait', state?.next_fill_at);
  }
  return count;
}

async function generateReply(userId, char, settings, target, { job = 'reply', priority = 'interactive', ambient = false, question = target, instruction } = {}) {
  const ctx = await residentContext(userId, char);
  instruction ||= resolveMode(settings) === 'hobby'
    ? '相手の問いに具体的に答える。自分の知識の範囲で話し、初心者は専門家のように断定しない。20〜140字の自然な本文のみ'
    : '相手の投稿に自然に返す。質問なら答えるが、毎回解説や励ましにしない。知識や距離感は自分の関わり方に合わせる。6〜140字の本文のみ';
  let reasons = '';
  for (let i = 0; i < config().refillAttempts; i++) {
    let meta;
    const text = await callLLM(buildWorldSystemPrompt(settings, char, [instruction]),
      `構造化プロフィール: ${JSON.stringify(ctx.profile)}\n最近の実際の発言・会話: ${JSON.stringify(ctx.memory)}\n返信対象: ${target}\n${reasons}`,
      450, { userId, job, priority, expectJSON: false, onResult: result => { meta = result; } });
    await runtime.recordContent(userId, job, 'generated', 'candidate');
    const quality = evaluate(text, { settings, profile: ctx.profile, history: ctx.memory, target, question, ambient, interactive: priority === 'interactive' && !ambient });
    await runtime.recordContent(userId, job, quality.accepted ? 'accepted' : 'rejected', quality.reason, quality.scores);
    if (quality.accepted) return text.trim();
    if (meta?.attemptId) await db.execute({ sql: "UPDATE llm_attempts SET outcome='quality_rejected' WHERE id=?", args: [meta.attemptId] });
    reasons = `前回は${quality.reason}で不採用。対象への結論と具体的理由を示し、同じ文を使わない。`;
  }
  throw new Error('返信品質チェックを通過できませんでした');
}

async function publishAll() {
  if (!enabled()) return;
  const users = (await db.execute(`SELECT DISTINCT user_id FROM content_candidates c WHERE state='pending'
    AND ${activeGenerationSQL('c.user_id')} AND scheduled_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)).rows;
  for (const { user_id: userId } of users) await serializeWorldTask(userId, () => publishPool(userId));
  await db.batch([
    "DELETE FROM content_events WHERE created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    "DELETE FROM llm_attempts WHERE created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    "DELETE FROM content_candidates WHERE state!='pending' AND created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
  ], 'write');
}
module.exports = { fillPool, publishPool, seedEnhanced, generateReply, publishAll };
