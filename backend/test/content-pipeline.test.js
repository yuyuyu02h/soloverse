const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-content-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.CONTENT_PIPELINE = 'enhanced';
process.env.LLM_PROVIDER_ORDER = 'groq';
process.env.GROQ_API_KEY = 'test-only';
process.env.GROQ_MODELS = 'content-test';
process.env.LLM_REQUEST_INTERVAL_MS = '0';
process.env.CONTENT_POOL_SIZE = '4';
process.env.CONTENT_TEMPLATES = 'false';
const { db, initDB } = require('../src/db/schema');
const runtime = require('../src/services/llmRuntime');
const { fillPool, publishPool, seedEnhanced, generateReply } = require('../src/services/contentPipeline');
const { residentContext } = require('../src/services/residentContext');
const { evaluate, similarity } = require('../src/services/contentQuality');
const { callLLM } = require('../src/services/llm');
const { processReactionQueue } = require('../src/services/reactionScheduler');
const { serializeWorldTask } = require('../src/services/worldTasks');
const originalFetch = global.fetch;
const texts = [
  '映画の序盤で映る小道具がラストにもう一度登場して、伏線の置き方に感心した。',
  '監督のインタビューを読んだら、撮影場所を選んだ理由が意外で面白かった。',
  '昨日観た作品の音楽を聴き直している。静かなピアノの旋律が耳に残る。',
  '好きな俳優の昔の出演作を借りてきた。今と違う演技を見るのが楽しみ。',
];
const candidates = () => texts.map((content, i) => ({ username: `resident_${i % 2}`, content }));
let responses, requests;
global.fetch = async (_, options) => {
  requests.push(JSON.parse(options.body));
  const next = responses.shift() || { content: candidates() };
  return new Response(JSON.stringify({ model: 'test', choices: [{ finish_reason: 'stop', message: { content: typeof next.content === 'string' ? next.content : JSON.stringify(next.content) } }], ...(next.usage ? { usage: next.usage } : {}) }), { status: next.status || 200, headers: next.headers || {} });
};
test.before(async () => { await initDB(); });
test.beforeEach(async () => {
  process.env.CONTENT_PIPELINE = 'enhanced';
  process.env.CONTENT_TEMPLATES = 'false';
  process.env.LLM_DAILY_REQUEST_BUDGET = '180';
  process.env.LLM_DAILY_TOKEN_BUDGET = '150000';
  process.env.GROQ_MODELS = `content-${randomUUID()}`;
  requests = []; responses = [];
  await db.batch(['DELETE FROM users', 'DELETE FROM llm_attempts', 'DELETE FROM llm_provider_limits'], 'write');
  for (const user of ['owner', 'other']) {
    await db.execute({ sql: 'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,1)', args: [user, `${user}@test.invalid`, 'unused', user] });
    await db.execute({ sql: 'INSERT INTO world_settings VALUES(?,?,?,?,?,?)', args: [user, 'observer', '映画', 'calm', '', 'small'] });
    for (let i = 0; i < 2; i++) await db.execute({ sql: 'INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [user + i, user, '住人' + i, `resident_${i}`, 'seed', '映画を丁寧に観る', '映画,音楽', '理由を添える', 'low', 'fast'] });
  }
});
test.after(() => { global.fetch = originalFetch; db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('pool persists half-day candidates; only due items publish, once', async () => {
  assert.equal(await fillPool('owner'), 4);
  assert.equal(requests.length, 1);
  const rows = (await db.execute("SELECT * FROM content_candidates WHERE user_id='owner' ORDER BY scheduled_at")).rows;
  assert.equal(rows.length, 4);
  assert.ok(Date.parse(rows[3].scheduled_at) - Date.parse(rows[0].scheduled_at) >= 9 * 3600000);
  assert.equal(await publishPool('other'), 0);
  assert.equal(await publishPool('owner'), 1);
  assert.equal(await publishPool('owner'), 0);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM posts WHERE user_id='owner'")).rows[0].n, 1);
  await initDB(); // Compatible startup preserves candidates and posts.
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM content_candidates WHERE state='pending'")).rows[0].n, 3);
  assert.equal(await fillPool('owner'), 0);
});

test('refills only missing rejected candidates and records reasons', async () => {
  responses = [{ content: [candidates()[0], { username: 'unknown', content: texts[1] }, { username: 'resident_0', content: texts[0] }, candidates()[1]] }, { content: candidates().slice(2) }];
  assert.equal(await fillPool('owner'), 4);
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /日常投稿を2件/);
  const metrics = await runtime.diagnostics('owner');
  assert.equal(metrics.content.filter(r => r.outcome === 'accepted').reduce((n,r) => n + r.count, 0), 4);
  assert.ok(metrics.content.some(r => r.reason === 'semantic_duplicate'));
  assert.ok(metrics.content.some(r => r.reason === 'unknown_resident'));
  assert.equal((await runtime.diagnostics('other')).attempts.length, 0);
});

test('429 attempts and fallback success are separately counted without response text', async () => {
  process.env.GROQ_MODELS = `limited-${randomUUID()},healthy-${randomUUID()}`;
  responses = [{ status: 429, content: 'private-upstream-error', headers: { 'retry-after': '60' } }, { content: texts[0], usage: { total_tokens: null } }];
  assert.equal(await callLLM('system', 'reply', 100, { userId: 'owner', job: 'reply' }), texts[0]);
  const metrics = await runtime.diagnostics('owner');
  assert.equal(metrics.attempts.find(r => r.outcome === 'rate_limited').count, 1);
  assert.equal(metrics.attempts.find(r => r.outcome === 'success').estimated_count, 1);
  assert.ok(!JSON.stringify(metrics).includes('private-upstream-error'));
});

test('direct reply quality retry and excess pool items have explicit metrics', async () => {
  const char = (await db.execute("SELECT * FROM ai_characters WHERE id='owner0'")).rows[0];
  const settings = (await db.execute("SELECT * FROM world_settings WHERE user_id='owner'")).rows[0];
  responses = [{ content: 'いいね！' }, { content: texts[0] }];
  assert.equal(await generateReply('owner', char, settings, '映画の伏線は好き？'), texts[0]);
  assert.equal(requests.length, 2);
  responses = [{ content: [...candidates(), candidates()[0]] }];
  await fillPool('owner');
  assert.ok((await runtime.diagnostics('owner')).content.some(r => r.reason === 'excess_candidate'));
});

test('exhausted 429 and cooldown defer work instead of exhausting content retries', async () => {
  responses = [{ status: 429, content: 'limited', headers: { 'retry-after': '60' } }];
  await assert.rejects(callLLM('system', 'reply', 100, { userId: 'owner' }), error => error.code === 'LLM_DEFERRED');
  await assert.rejects(callLLM('system', 'reply', 100, { userId: 'owner' }), error => error.code === 'LLM_DEFERRED');
  assert.equal(requests.length, 1);
});

test('invalid-only generation stops at two passes and retries are paced', async () => {
  responses = [{ content: [{ username: 'resident_0', content: '漆黒の夜に星屑の残り香が揺れる。' }] }, { content: [{ username: 'resident_0', content: 'いいね！' }] }];
  assert.equal(await fillPool('owner'), 0);
  assert.equal(requests.length, 2);
  await fillPool('owner');
  assert.equal(requests.length, 2);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM llm_attempts WHERE outcome='quality_rejected'")).rows[0].n, 2);
});

test('reply chains publish after their parent and foreign parents are rejected', async () => {
  responses = [{ content: [candidates()[0], { ...candidates()[1], reply_to_index: 0 }, { ...candidates()[2], reply_to_index: 99 }, candidates()[3]] }, { content: [candidates()[2]] }];
  await fillPool('owner');
  await db.execute("UPDATE content_candidates SET scheduled_at='2000-01-01T00:00:00.000Z'");
  await publishPool('owner'); await publishPool('owner');
  const replies = (await db.execute("SELECT p.created_at AS child,q.created_at AS parent FROM posts p JOIN posts q ON q.id=p.reply_to WHERE p.user_id='owner'")).rows;
  assert.equal(replies.length, 1);
  assert.ok(Date.parse(replies[0].child) >= Date.parse(replies[0].parent));
  assert.ok((await runtime.diagnostics('owner')).content.some(r => r.reason === 'invalid_parent'));
});

test('quality gate detects topic, vague phrasing, persona conflict, and near duplicate', () => {
  const context = { settings: { interests: '映画' }, profile: { topics: ['映画'], preferences: ['ピアノ'] }, history: [] };
  assert.equal(evaluate(texts[0], context).accepted, true);
  assert.equal(evaluate('今日は確定申告の書類を整理して税務署に電話した。', context).reason, 'off_topic');
  assert.equal(evaluate('映画の光の剣を磨いて旅をしている。', context).reason, 'roleplay');
  assert.equal(evaluate('音楽はよく聴くけれど、ピアノは嫌いなんだ。', context).reason, 'persona_conflict');
  assert.ok(similarity(texts[0], texts[0].replace('感心した', '驚いた')) > 0.72);
});

test('structured profile preserves original personality and memory is tenant scoped', async () => {
  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('own-memory','owner','owner0','ai','映画の伏線を見つけるのが好き。'),('private-memory','other','other0','ai','他世界の秘密')");
  const char = (await db.execute("SELECT * FROM ai_characters WHERE id='owner0'")).rows[0];
  const ctx = await residentContext('owner', char);
  assert.equal(ctx.profile.traits, '映画を丁寧に観る');
  assert.deepEqual(ctx.memory, ['映画の伏線を見つけるのが好き。']);
  await assert.rejects(() => residentContext('other', char), /ownership/);
  await db.execute("DELETE FROM posts WHERE id='own-memory'");
  assert.equal((await db.execute('SELECT * FROM resident_memory')).rows.length, 0);
});

test('pending direct reply defers background before consuming quota', async () => {
  await db.execute("INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at) VALUES('waiting','owner','owner0','p','reply',datetime('now'))");
  await assert.rejects(() => callLLM('', '背景', 100, { userId: 'owner', priority: 'background' }), { code: 'LLM_DEFERRED' });
  assert.equal(requests.length, 0);
  await callLLM('', '返信', 100, { userId: 'owner', job: 'reply' });
  assert.equal(requests.length, 1);
});

test('shared daily reserve leaves requests for interactive replies and survives startup', async () => {
  process.env.LLM_DAILY_REQUEST_BUDGET = '2';
  await callLLM('', '背景', 100, { userId: 'owner', priority: 'background' });
  await initDB();
  await assert.rejects(() => callLLM('', '背景', 100, { userId: 'other', priority: 'background' }), { code: 'LLM_DEFERRED' });
  await callLLM('', '返信', 100, { userId: 'other', job: 'reply' });
  await assert.rejects(() => callLLM('', '返信', 100, { userId: 'owner', job: 'reply' }), { code: 'LLM_DEFERRED' });
  assert.equal(requests.length, 2);
});

test('token budget prevents overspend before an API call', async () => {
  process.env.LLM_DAILY_TOKEN_BUDGET = '100';
  await assert.rejects(() => callLLM('', '返信', 100, { userId: 'owner' }), { code: 'LLM_DEFERRED' });
  assert.equal(requests.length, 0);
});

test('safe quota headers and usage are persisted; missing headers remain unknown', async () => {
  responses = [{ content: texts[0], usage: { total_tokens: 42 }, headers: { 'x-ratelimit-remaining-requests': '7', 'x-ratelimit-remaining-tokens': '20', 'x-ratelimit-reset-tokens': '3m2s' } }];
  await callLLM('', '返信', 100, { userId: 'owner' });
  const limits = (await db.execute('SELECT * FROM llm_provider_limits')).rows[0];
  assert.equal(limits.remaining_requests, 7);
  assert.equal(limits.remaining_tokens, 20);
  assert.equal(limits.reset_requests_at, null);
  assert.ok(limits.reset_tokens_at > Date.now() + 180000);
  assert.equal((await db.execute('SELECT tokens,estimated FROM llm_attempts')).rows[0].tokens, 42);
  await assert.rejects(() => callLLM('', '返信', 100, { userId: 'owner' }), { code: 'LLM_DEFERRED' });
  assert.equal(requests.length, 1);
});

test('poor recent model history demotes only within provider and expires', async () => {
  for (let i = 0; i < 3; i++) await db.execute({ sql: "INSERT INTO llm_attempts(id,job,priority,provider,model,outcome,tokens,estimated,created_at) VALUES(?,'test','interactive','groq','bad','quality_rejected',0,0,?)", args: [randomUUID(), new Date().toISOString()] });
  const targets = [{ providerName: 'groq', model: 'bad' }, { providerName: 'groq', model: 'good' }, { providerName: 'gemini', model: 'good' }];
  assert.deepEqual((await runtime.orderTargets(targets)).map(t => t.model), ['good', 'bad', 'good']);
  await db.execute("UPDATE llm_attempts SET created_at='2000-01-01T00:00:00.000Z'");
  assert.equal((await runtime.orderTargets(targets))[0].model, 'bad');
});

test('priority queue executes waiting reply before waiting background', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const order = [];
  const first = runtime.schedule({}, () => gate);
  const background = runtime.schedule({ priority: 'background' }, async () => { order.push('background'); });
  const reply = runtime.schedule({ priority: 'interactive' }, async () => { order.push('reply'); });
  release(); await Promise.all([first, background, reply]);
  assert.deepEqual(order, ['reply', 'background']);
});

test('legacy switch stops candidate publication and returns original seed behavior', async () => {
  await fillPool('owner');
  process.env.CONTENT_PIPELINE = 'legacy';
  assert.equal(await publishPool('owner'), 0);
  assert.equal((await db.execute('SELECT * FROM posts')).rows.length, 0);
  const { generateAITimelinePosts } = require('../src/services/reactionScheduler');
  await generateAITimelinePosts('owner');
  assert.equal((await db.execute('SELECT * FROM posts')).rows.length, 2);
  assert.equal((await db.execute('SELECT * FROM content_candidates')).rows.length, 4);
});

test('templates are optional, capped, and do not call APIs when budget exhausted', async () => {
  process.env.CONTENT_TEMPLATES = 'true';
  process.env.LLM_DAILY_TOKEN_BUDGET = '100';
  for (let i = 0; i < 4; i++) {
    await db.execute('DELETE FROM content_pool_state');
    await fillPool('owner'); await publishPool('owner');
  }
  assert.equal(requests.length, 0);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM content_candidates WHERE source='template'")).rows[0].n, 2);
});

test('quota deferral retains reply without using up retries; success posts only once', async () => {
  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('question','owner','owner','user','映画のどの場面が好き？')");
  await db.execute("INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at) VALUES('rq','owner','owner0','question','reply',datetime('now'))");
  process.env.LLM_DAILY_TOKEN_BUDGET = '100';
  await processReactionQueue();
  const deferred = (await db.execute("SELECT * FROM reaction_queue WHERE id='rq'")).rows[0];
  assert.equal(deferred.attempts, 0); assert.equal(deferred.done, 0);
  process.env.LLM_DAILY_TOKEN_BUDGET = '150000';
  await db.execute("UPDATE reaction_queue SET scheduled_at=datetime('now') WHERE id='rq'");
  responses = [{ content: texts[0], usage: { total_tokens: 120 } }];
  await processReactionQueue(); await processReactionQueue();
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM posts WHERE reply_to='question'")).rows[0].n, 1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM notifications WHERE type='reply'")).rows[0].n, 1);
});

test('concurrent seed uses one pool; clearing world cascades profile/memory/candidates', async () => {
  await Promise.all([serializeWorldTask('owner', () => seedEnhanced('owner')), serializeWorldTask('owner', () => seedEnhanced('owner'))]);
  assert.equal(requests.length, 1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM posts WHERE user_id='owner'")).rows[0].n, 4);
  await db.execute("DELETE FROM ai_characters WHERE user_id='owner'");
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM resident_profiles WHERE user_id='owner'")).rows[0].n, 0);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM content_candidates WHERE user_id='owner'")).rows[0].n, 0);
});
