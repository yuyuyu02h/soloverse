const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-activity-'));
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'test.db'), JWT_SECRET: 'activity-test-signing-secret-long-enough',
  BACKGROUND_JOBS: 'false', CONTENT_PIPELINE: 'enhanced', CONTENT_REVIEW: 'false',
  CONTENT_TEMPLATES: 'false', CONTENT_POOL_SIZE: '4', CONTENT_REFILL_ATTEMPTS: '1',
  LLM_PROVIDER_ORDER: 'groq', GROQ_API_KEY: 'test-only', GROQ_MODELS: 'activity-test', LLM_REQUEST_INTERVAL_MS: '0',
});
const { db, initDB } = require('../src/db/schema');
const { startServer, shutdown } = require('../server');
const { generateToken } = require('../src/middleware/auth');
const activity = require('../src/services/generationActivity');
const { callLLM } = require('../src/services/llm');
const { runAllUsers, runCharacterGrowth, checkAbsenceReactions } = require('../src/services/autonomousEngine');
const { fillPool, publishAll, seedEnhanced } = require('../src/services/contentPipeline');
const { processReactionQueue } = require('../src/services/reactionScheduler');
const { processPendingCelebrityScenes } = require('../src/services/celebrityMode');
const originalFetch = global.fetch;
let server, base, requests, onProviderRequest;
const moviePosts = [
  '映画の序盤で映る小道具がラストにもう一度登場して、伏線の置き方に感心した。',
  '監督のインタビューを読んだら、撮影場所を選んだ理由が意外で面白かった。',
  '昨日観た映画の音楽を聴き直している。静かなピアノの旋律が耳に残る。',
  '好きな俳優の昔の出演作を借りてきた。今と違う演技を見るのが楽しみ。',
];
global.fetch = async (url, options) => {
  if (String(url).startsWith(base + '/')) return originalFetch(url, options);
  const body = JSON.parse(options.body);
  requests.push(body);
  if (onProviderRequest) await onProviderRequest();
  const prompt = body.messages.at(-1).content;
  const content = body.messages[0]?.content.includes('観客反応ディレクター')
    ? JSON.stringify({ mood: '感想と質問', comments: [{ category: 'question', content: '映画の撮影で印象に残ったことはありますか？' }] })
    : prompt.includes('日常投稿を')
      ? JSON.stringify(moviePosts.map((content, i) => ({ username: `resident_${i % 2}`, content })))
      : moviePosts[0];
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { total_tokens: 100 } }));
};
async function api(route, token, { visible = false, body } = {}) {
  const res = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(visible ? { 'x-soloverse-active': '1' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, data: await res.json() };
}
async function activate(user = 'owner') {
  const token = generateToken(user);
  assert.equal((await api('/api/auth/activity', token, { visible: true, body: {} })).status, 200);
  return token;
}
async function dueReaction(id, userId, type = 'reply') {
  await db.execute({ sql: 'INSERT OR IGNORE INTO posts(id,user_id,author_id,author_type,content) VALUES(?,?,?,\'user\',?)', args: [`post-${userId}`, userId, userId, '映画の伏線の置き方で好きなところを教えて？'] });
  await db.execute({ sql: "INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at) VALUES(?,?,?,?,?,datetime('now','-1 minute'))", args: [id, userId, userId + '0', `post-${userId}`, type] });
}
test.before(async () => { server = await startServer(0); base = `http://127.0.0.1:${server.address().port}`; });
test.beforeEach(async () => {
  requests = []; onProviderRequest = null;
  process.env.CONTENT_PIPELINE = 'enhanced'; process.env.CONTENT_REVIEW = 'false';
  process.env.GROQ_MODELS = 'activity-' + randomUUID(); process.env.LLM_REQUEST_INTERVAL_MS = '0';
  process.env.LLM_DAILY_REQUEST_BUDGET = '180'; process.env.LLM_DAILY_TOKEN_BUDGET = '150000';
  await db.batch(['DELETE FROM users', 'DELETE FROM llm_attempts', 'DELETE FROM llm_provider_limits'], 'write');
  for (const user of ['owner', 'old', 'star', 'unfinished']) {
    await db.execute({ sql: 'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,?)', args: [user, `${user}@test.invalid`, 'unused', user, user === 'unfinished' ? 0 : 1] });
    if (user === 'unfinished') continue;
    await db.execute({ sql: 'INSERT INTO world_settings VALUES(?,?,?,?,?,?)', args: [user, user === 'star' ? 'admired' : 'observer', '映画', 'calm', '', 'small'] });
    await db.execute({ sql: "INSERT INTO autonomous_log(user_id,last_autonomous_at,last_trend_at,last_growth_at) VALUES(?,datetime('now','-1 day'),datetime('now'),datetime('now'))", args: [user] });
    for (let i = 0; i < 2; i++) await db.execute({ sql: 'INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [user + i, user, '住人' + i, `resident_${i}`, 'seed', `映画を丁寧に楽しむ owner_marker_${user}`, '映画', '理由を添える', 'low', 'fast'] });
  }
});
test.after(async () => { global.fetch = originalFetch; await shutdown(server); fs.rmSync(dir, { recursive: true, force: true }); });

test('existing accounts start paused; additive migration preserves worlds and reservations', async () => {
  await dueReaction('old-reply', 'old');
  await db.execute("INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at) VALUES('stock','old','old0','映画の伏線が気になる。','llm','2000-01-01','2000-01-01')");
  await initDB();
  assert.equal(await activity.isGenerationActive('old'), false);
  assert.equal(await fillPool('old'), 0);
  await runAllUsers(); await publishAll(); await processReactionQueue();
  await runCharacterGrowth('old'); await checkAbsenceReactions('old');
  assert.equal(requests.length, 0);
  assert.equal((await db.execute("SELECT state FROM content_candidates WHERE id='stock'")).rows[0].state, 'pending');
  assert.equal((await db.execute("SELECT done FROM reaction_queue WHERE id='old-reply'")).rows[0].done, 0);
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM ai_characters')).rows[0].n, 6);
});

test('visible activity renews only its account; hidden polling cannot revive an expired lease', async () => {
  const token = await activate();
  assert.equal(await activity.isGenerationActive('owner'), true);
  assert.equal(await activity.isGenerationActive('old'), false);
  await db.execute("UPDATE generation_sessions SET active_until=0");
  assert.equal((await api('/api/auth/me', token)).status, 200);
  assert.equal((await api('/api/auth/activity', token, { body: {} })).status, 200);
  assert.equal(await activity.isGenerationActive('owner'), false);
  await assert.rejects(callLLM('', 'reply', 100, { userId: 'owner' }), e => e.code === 'LLM_DEFERRED' && e.message === 'user_inactive');
  assert.equal(requests.length, 0);
  assert.equal((await api('/api/auth/me', token, { visible: true })).status, 200);
  await callLLM('', 'reply', 100, { userId: 'owner' });
  assert.equal(requests.length, 1);
});

test('logout revokes one login; another device remains active and revoked tokens cannot renew', async () => {
  const first = await activate(), second = await activate();
  assert.notEqual(first, second);
  assert.equal((await api('/api/auth/logout', first, { visible: true, body: {} })).status, 200);
  assert.equal(await activity.isGenerationActive('owner'), true);
  const oldResponse = await api('/api/auth/activity', first, { visible: true, body: {} });
  assert.equal(oldResponse.status, 401); assert.equal(oldResponse.data.code, 'SESSION_REVOKED');
  assert.equal((await api('/api/auth/me', second)).status, 200);
  assert.equal((await api('/api/auth/logout', second, { body: {} })).status, 200);
  assert.equal(await activity.isGenerationActive('owner'), false);
  await activity.touchSession('owner', activity.sessionId(first));
  assert.equal(await activity.isGenerationActive('owner'), false);
});

test('old signed tokens resume without forcing re-login; admin views never activate a world', async () => {
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  assert.equal((await api('/api/auth/me', token, { visible: true })).status, 200);
  assert.equal(await activity.isGenerationActive('owner'), true);
  await db.execute('UPDATE generation_sessions SET active_until=0');
  process.env.ADMIN_USER_IDS = 'owner';
  assert.equal((await api('/api/admin/overview', generateToken('owner', 'admin'), { visible: true })).status, 200);
  assert.equal(await activity.isGenerationActive('owner'), false);
  assert.equal((await api('/api/admin/overview', token, { visible: true })).status, 403);
  assert.equal(await activity.isGenerationActive('owner'), false);
});

test('switching accounts leaves only the new account generating, with its own context', async () => {
  const old = await activate('old');
  await api('/api/auth/logout', old, { body: {} });
  await activate();
  await runAllUsers();
  assert.ok(requests.length > 0);
  assert.ok(!JSON.stringify(requests).includes('owner_marker_old'));
  assert.ok(JSON.stringify(requests).includes('owner_marker_owner'));
  const attempts = (await db.execute('SELECT DISTINCT user_id FROM llm_attempts')).rows;
  assert.deepEqual(attempts.map(row => row.user_id), ['owner']);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM posts WHERE user_id='old'")).rows[0].n, 0);
});

test('inactive reply backlog does not occupy batch slots or block active background generation', async () => {
  for (let i = 0; i < 25; i++) await dueReaction('paused-' + i, 'old');
  await activate();
  await callLLM('', 'background', 100, { userId: 'owner', priority: 'background' });
  assert.equal(requests.length, 1);
  await dueReaction('active-reply', 'owner');
  await processReactionQueue();
  assert.equal((await db.execute("SELECT done FROM reaction_queue WHERE id='active-reply'")).rows[0].done, 1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM reaction_queue WHERE user_id='old' AND done=0 AND attempts=0")).rows[0].n, 25);
});

test('pending celebrity director pauses while offline and resumes after activity', async () => {
  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('scene-post','star','star','user','映画の撮影の話をします。')");
  const { createCelebrityScene } = require('../src/services/celebrityMode');
  await createCelebrityScene('star', 'scene-post', '映画の撮影の話をします。', new Date().toISOString());
  assert.equal(await processPendingCelebrityScenes(), 0);
  assert.equal(requests.length, 0);
  await activate('star');
  assert.equal(await processPendingCelebrityScenes(), 1);
  assert.equal(requests.length, 1);
  assert.equal((await db.execute("SELECT status FROM celebrity_scenes WHERE post_id='scene-post'")).rows[0].status, 'ready');
});

for (const mode of ['enhanced', 'legacy']) test(`${mode}: queued LLM work rechecks logout before sending without consuming an attempt`, async () => {
  process.env.CONTENT_PIPELINE = mode;
  const token = await activate();
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  onProviderRequest = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const first = callLLM('', 'already sent', 100, { userId: 'owner' });
  await entered;
  const queued = callLLM('', 'waiting', 100, { userId: 'owner' });
  const rejection = assert.rejects(queued, e => e.code === 'LLM_DEFERRED' && e.message === 'user_inactive');
  await api('/api/auth/logout', token, { body: {} });
  release(); await first; await rejection;
  assert.equal(requests.length, 1);
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM llm_attempts')).rows[0].n, mode === 'enhanced' ? 1 : 0);
});

test('logout during a queued refill does not impose a 30-minute retry delay on return', async () => {
  await activate('old');
  const owner = await activate();
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  onProviderRequest = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const blocking = callLLM('', 'already sent', 100, { userId: 'old' });
  await entered;
  const refill = fillPool('owner', { seed: true });
  let state;
  for (let i = 0; i < 100 && !state; i++) {
    state = (await db.execute("SELECT next_fill_at FROM content_pool_state WHERE user_id='owner'")).rows[0];
    if (!state) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(state);
  await api('/api/auth/logout', owner, { body: {} });
  onProviderRequest = null; release(); await blocking; await refill;
  assert.equal(requests.length, 1);
  assert.ok(Date.parse((await db.execute("SELECT next_fill_at FROM content_pool_state WHERE user_id='owner'")).rows[0].next_fill_at) <= Date.now());
  await activate(); await seedEnhanced('owner');
  assert.equal(requests.length, 2);
});

test('legacy generation is also stopped before external calls', async () => {
  process.env.CONTENT_PIPELINE = 'legacy';
  await assert.rejects(callLLM('', 'legacy reply', 100, { userId: 'old' }), e => e.code === 'LLM_DEFERRED' && e.message === 'user_inactive');
  await activate('old');
  await callLLM('', 'legacy reply', 100, { userId: 'old' });
  assert.equal(requests.length, 1);
});

test('returning preserves posts, characters and prepared stock without repeating initial generation', async () => {
  const token = await activate();
  await seedEnhanced('owner');
  const before = (await db.execute("SELECT id,content FROM posts WHERE user_id='owner' ORDER BY id")).rows;
  const stock = (await db.execute("SELECT id FROM content_candidates WHERE user_id='owner' ORDER BY id")).rows;
  const requestCount = requests.length;
  await api('/api/auth/logout', token, { body: {} });
  await runAllUsers();
  await activate();
  await seedEnhanced('owner');
  assert.equal(requests.length, requestCount);
  assert.deepEqual((await db.execute("SELECT id,content FROM posts WHERE user_id='owner' ORDER BY id")).rows, before);
  assert.deepEqual((await db.execute("SELECT id FROM content_candidates WHERE user_id='owner' ORDER BY id")).rows, stock);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM ai_characters WHERE user_id='owner'")).rows[0].n, 2);
});
