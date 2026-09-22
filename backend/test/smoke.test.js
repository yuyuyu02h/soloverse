const test = require('node:test');
process.env.CONTENT_PIPELINE ||= 'legacy';
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { v4: uuidv4 } = require('uuid');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloverse-test-'));
process.env.JWT_SECRET = 'test-only-secret-with-more-than-32-characters';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.OPENROUTER_MODELS = 'openrouter/free';
process.env.LLM_PROVIDER_ORDER = 'openrouter';
process.env.LLM_REQUEST_INTERVAL_MS = '0';
process.env.BACKGROUND_JOBS = 'false';
process.env.DB_PATH = path.join(testDir, 'smoke.db');

let generationBatch = 0;
const llmServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    const prompt = body.messages.at(-1)?.content || '';
    let content;
    if (prompt.includes('AIキャラクターを5人')) {
      const offset = generationBatch++ * 5;
      content = JSON.stringify(Array.from({ length: 5 }, (_, index) => ({
        name: `住人${offset + index}`,
        username: `resident_${offset + index}`,
        avatar_seed: `seed_${offset + index}`,
        bio: 'テスト用の住人',
        personality: '明るい',
        interests: '音楽',
        reply_style: '短く共感する',
        reaction_frequency: 'mid',
        delay_profile: 'normal',
      })));
    } else if (prompt.includes('日常投稿を')) {
      const latestBatchStart = Math.max(0, generationBatch * 5 - 10);
      content = JSON.stringify([{ username: `resident_${latestBatchStart}`, content: '音楽を聴いています #音楽' }]);
    } else {
      content = 'いいですね！';
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'test/model', choices: [{ message: { content } }] }));
  });
});

let server;
let baseUrl;

async function api(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  return { status: response.status, data };
}

test.before(async () => {
  await new Promise(resolve => llmServer.listen(0, '127.0.0.1', resolve));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${llmServer.address().port}`;
  const backend = require('../server');
  server = await backend.startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  const { shutdown } = require('../server');
  await shutdown(server);
  await new Promise(resolve => llmServer.close(resolve));
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('主要ユーザーフローとテナント境界が動作する', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.llm.configured, true);

  const registered = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'USER@example.com', password: 'password123', username: 'テストユーザー' },
  });
  assert.equal(registered.status, 200);
  const token = registered.data.token;

  const onboarding = await api('/api/onboarding/submit', {
    method: 'POST', token,
    body: { position: 'empathy', interests: '音楽', atmosphere: 'calm', exclusions: ['no_criticism'] },
  });
  assert.equal(onboarding.status, 200);
  assert.equal(onboarding.data.characterCount, 10);

  const me = await api('/api/auth/me', { token });
  assert.equal(me.data.onboardingDone, true);

  const seeded = await api('/api/timeline/seed', { method: 'POST', token, body: {} });
  assert.equal(seeded.status, 200);

  const created = await api('/api/timeline/post', {
    method: 'POST', token, body: { content: '初めての投稿' },
  });
  assert.equal(created.status, 200);
  const postId = created.data.post.id;

  assert.equal((await api(`/api/timeline/like/${postId}`, { method: 'POST', token, body: {} })).data.liked, true);
  assert.equal((await api(`/api/timeline/like/${postId}`, { method: 'POST', token, body: {} })).data.liked, false);

  const directReply = await api('/api/timeline/post', {
    method: 'POST', token, body: { content: '直接返信', replyTo: postId },
  });
  assert.equal(directReply.status, 200);

  const { db } = require('../src/db/schema');
  // Enhanced seeds are published now, not backdated; make the older-page fixture explicit.
  await db.execute({
    sql: "UPDATE posts SET created_at=? WHERE user_id=? AND author_type='ai' AND reply_to IS NULL",
    args: [new Date(Date.now() - 60000).toISOString(), registered.data.userId],
  });
  const character = await db.execute({ sql: 'SELECT id FROM ai_characters WHERE user_id = ? LIMIT 1', args: [registered.data.userId] });
  await db.execute({
    sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, reply_to, ai)
          VALUES (?, ?, ?, 'ai', '入れ子の返信', ?, 1)`,
    args: [uuidv4(), registered.data.userId, character.rows[0].id, directReply.data.post.id],
  });
  const thread = await api(`/api/timeline/replies/${postId}`, { token });
  assert.equal(thread.status, 200);
  assert.equal(thread.data.replies.length, 2);

  await db.execute({
    sql: `INSERT INTO reaction_queue (id, user_id, character_id, post_id, reaction_type, scheduled_at)
          VALUES (?, ?, ?, ?, 'like', ?)`,
    args: [uuidv4(), registered.data.userId, character.rows[0].id, postId, new Date(Date.now() - 1000).toISOString()],
  });
  const { processReactionQueue } = require('../src/services/reactionScheduler');
  await processReactionQueue();
  const afterQueue = await api('/api/timeline?page=0', { token });
  assert.equal(Number(afterQueue.data.posts.find(post => post.id === postId).like_count), 1);
  const refreshed = await api('/api/timeline?ids=' + postId, { token });
  assert.equal(refreshed.data.posts.length, 1);
  assert.equal(Number(refreshed.data.posts[0].like_count), 1);
  assert.ok(refreshed.data.posts[0].reply_preview.length > 0);
  const sameSecond = await api('/api/timeline?since=' + encodeURIComponent(created.data.post.created_at), { token });
  assert.ok(sameSecond.data.posts.some(post => post.id === postId));
  const older = await api('/api/timeline?before=' + encodeURIComponent(created.data.post.created_at) + '&beforeId=' + postId, { token });
  assert.ok(!older.data.posts.some(post => post.id === postId));
  assert.ok(older.data.posts.length > 0);

  const regenerated = await api('/api/onboarding/regenerate', { method: 'POST', token, body: {} });
  assert.equal(regenerated.status, 200);
  assert.equal(regenerated.data.characterCount, 10);
  assert.ok(regenerated.data.seedCount > 0);
  const afterRegenerate = await api('/api/timeline?page=0', { token });
  assert.ok(afterRegenerate.data.posts.some(post => post.id === postId));
  assert.ok(afterRegenerate.data.posts.some(post => post.author_type === 'ai'));
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM posts WHERE content='入れ子の返信'")).rows[0].n, 0);
  const preservedThread = await api(`/api/timeline/replies/${postId}`, { token });
  assert.ok(preservedThread.data.replies.some(post => post.id === directReply.data.post.id));

  const other = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'other@example.com', password: 'password123', username: '別ユーザー' },
  });
  assert.equal((await api(`/api/timeline/like/${postId}`, { method: 'POST', token: other.data.token, body: {} })).status, 404);
  assert.equal((await api('/api/timeline/post', {
    method: 'POST', token: other.data.token, body: { content: '不正返信', replyTo: postId },
  })).status, 404);
  assert.equal((await api('/api/timeline?ids=' + postId, { token: other.data.token })).data.posts.length, 0);
  assert.equal((await api('/api/timeline/diagnostics')).status, 401);
  const ownMetrics = await api('/api/timeline/diagnostics', { token });
  assert.equal(ownMetrics.status, 200);
  const otherMetrics = await api('/api/timeline/diagnostics?userId=' + registered.data.userId, { token: other.data.token });
  assert.equal(otherMetrics.status, 200);
  assert.equal(otherMetrics.data.attempts.length, 0);
  assert.equal(otherMetrics.data.pool.length, 0);
  assert.equal(otherMetrics.data.profiles.length, 0);
  if (process.env.CONTENT_PIPELINE === 'enhanced') {
    assert.ok(ownMetrics.data.attempts.length > 0);
    assert.ok(ownMetrics.data.profiles.length > 0);
    assert.equal((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM content_candidates WHERE character_id=?', args: [character.rows[0].id] })).rows[0].n, 0);
  }

  const celebrity = await api('/api/auth/register', {
    method: 'POST',
    body: { email: 'celebrity@example.com', password: 'password123', username: '有名人体験' },
  });
  assert.equal((await api('/api/onboarding/submit', {
    method: 'POST', token: celebrity.data.token,
    body: { position: 'admired', interests: '映画', atmosphere: 'calm', exclusions: ['no_criticism'] },
  })).status, 200);
  const celebrityPost = await api('/api/timeline/post', {
    method: 'POST', token: celebrity.data.token, body: { content: '新しい映画について話します' },
  });
  assert.equal(celebrityPost.status, 200);
  assert.equal(celebrityPost.data.scheduled.mode, 'celebrity');
  assert.equal(Number(celebrityPost.data.post.like_count), 0);
  assert.equal(Number(celebrityPost.data.post.reply_count), 0);
  assert.equal((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM celebrity_scenes WHERE post_id=?', args: [celebrityPost.data.post.id] })).rows[0].n, 1);
  assert.equal((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM reaction_queue WHERE post_id=?', args: [celebrityPost.data.post.id] })).rows[0].n, 0);
  const celebrityTimeline = await api('/api/timeline?page=0', { token: celebrity.data.token });
  const celebrityRoot = celebrityTimeline.data.posts.find(post => post.id === celebrityPost.data.post.id);
  assert.equal(celebrityRoot.experience_mode, 'celebrity');
  assert.ok(Number(celebrityRoot.like_count) >= Number(celebrityPost.data.post.like_count));
  await db.execute({ sql: 'UPDATE celebrity_scenes SET started_at=? WHERE post_id=?', args: [new Date(Date.now() - 2 * 60 * 60000).toISOString(), celebrityPost.data.post.id] });
  await require('../src/services/celebrityMode').processPendingCelebrityScenes();
  const celebrityReplies = await api('/api/timeline/replies/' + celebrityPost.data.post.id, { token: celebrity.data.token });
  assert.equal(celebrityReplies.status, 200);
  assert.equal(celebrityReplies.data.replies.filter(reply => reply.synthetic).length, 150);
  const celebrityNotifications = await api('/api/timeline/notifications', { token: celebrity.data.token });
  assert.equal(celebrityNotifications.data.celebrityMode, true);
  assert.ok(celebrityNotifications.data.notifications.some(notification => notification.type === 'celebrity_reply'));
  assert.equal((await api('/api/timeline/notifications/celebrity-settings', { method: 'POST', token: celebrity.data.token, body: { enabled: false } })).data.enabled, false);
  const mutedNotifications = await api('/api/timeline/notifications', { token: celebrity.data.token });
  assert.equal(mutedNotifications.data.notifications.some(notification => notification.type === 'celebrity_reply'), false);
});

test('LLM JSONのコードフェンスと途中切れを復旧できる', () => {
  const { safeParseJSON } = require('../src/services/llm');
  assert.deepEqual(safeParseJSON('```json\n[{"ok":true}]\n```'), [{ ok: true }]);
  assert.deepEqual(safeParseJSON('[{"ok":true},{"ok":false'), [{ ok: true }]);
});
