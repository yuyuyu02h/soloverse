// Opt-in live audit. Sends synthetic inputs to the configured cloud LLM providers.
if (process.env.SOLOVERSE_LIVE_AUDIT !== '1') {
  console.error('Explicit opt-in required: SOLOVERSE_LIVE_AUDIT=1 node <this file>');
  process.exit(2);
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const backendRoot = path.resolve(__dirname, '../../backend');
const backend = createRequire(path.join(backendRoot, 'package.json'));
backend('dotenv').config({ path: path.join(backendRoot, '.env') });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-live-audit-'));
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'live.db'), BACKGROUND_JOBS: 'false',
  JWT_SECRET: 'isolated-live-audit-only-signing-secret',
  CONTENT_PIPELINE: 'enhanced', CONTENT_POOL_SIZE: '8',
  CONTENT_TEMPLATES: 'false', CONTENT_REFILL_ATTEMPTS: '2',
  LLM_DAILY_REQUEST_BUDGET: '12', LLM_DAILY_TOKEN_BUDGET: '60000',
  LLM_TOTAL_TIMEOUT_MS: '90000',
});
const { startServer, shutdown } = backend('./server');
const { db } = backend('./src/db/schema');
const { processReactionQueue } = backend('./src/services/reactionScheduler');
const { processPendingCelebrityScenes, createCelebrityScene, decorateTimelinePosts, celebrityComments } = backend('./src/services/celebrityMode');
let server;
let base;
const results = { syntheticOnly: true, settings: { poolSize: 8, templates: false, dailyRequestCap: 12, backgroundJobs: false }, worlds: [] };
async function request(route, token, body) {
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route} HTTP ${response.status}: ${data.error || 'unknown error'}`);
  return data;
}
async function scenario(theme, question) {
  console.log(`[Audit] Begin synthetic theme: ${theme}`);
  const result = { theme, question, steps: {} };
  results.worlds.push(result);
  const started = Date.now();
  const auth = await request('/api/auth/register', null, { email: `audit-${randomUUID()}@test.invalid`, password: 'AuditOnly2026!', username: '検証ユーザー' });
  const token = auth.token;
  const userId = auth.userId;
  result.steps.registration = 'ok';
  await request('/api/onboarding/submit', token, { position: 'empathy', interests: theme, atmosphere: 'calm', exclusions: ['no_criticism'] });
  const world = await request('/api/onboarding/world', token);
  result.residents = world.characters.map(c => ({ name: c.name, username: c.username, bio: c.bio, personality: c.personality, interests: c.interests, reply_style: c.reply_style }));
  result.steps.onboarding = 'ok';
  console.log(`[Audit] Residents ready for ${theme}: ${result.residents.length}`);
  try {
    await request('/api/timeline/seed', token, {});
    result.steps.seed = 'ok';
  } catch (error) { result.steps.seed = error.message; }
  const timeline = await request('/api/timeline', token);
  result.initialPosts = timeline.posts.map(p => ({ author: p.author_handle, content: p.content, replies: p.reply_preview.map(r => ({ author: r.author_handle, content: r.content })) }));
  result.candidates = (await db.execute({ sql: 'SELECT a.username author,c.content,c.state,c.parent_id IS NOT NULL is_reply FROM content_candidates c JOIN ai_characters a ON a.id=c.character_id WHERE c.user_id=? ORDER BY c.scheduled_at,c.id', args: [userId] })).rows;
  console.log(`[Audit] Candidates for ${theme}: ${result.candidates.length}; visible roots: ${result.initialPosts.length}`);
  const posted = await request('/api/timeline/post', token, { content: question });
  result.scheduled = posted.scheduled;
  // Advance only one reserved reply in the disposable DB; do not wait several minutes.
  const queue = (await db.execute({ sql: "SELECT id FROM reaction_queue WHERE user_id=? AND post_id=? AND reaction_type='reply' ORDER BY scheduled_at LIMIT 1", args: [userId, posted.post.id] })).rows[0];
  if (queue) {
    await db.execute({ sql: "UPDATE reaction_queue SET scheduled_at=datetime('now','+1 day') WHERE user_id=?", args: [userId] });
    await db.execute({ sql: "UPDATE reaction_queue SET scheduled_at=datetime('now','-1 second') WHERE id=?", args: [queue.id] });
    await processReactionQueue();
  }
  const thread = await request('/api/timeline/replies/' + posted.post.id, token);
  result.actualReplies = thread.replies.map(p => ({ author: p.author_handle, content: p.content }));
  result.steps.reply = thread.replies.length ? 'ok' : 'no reply published';
  result.elapsedSeconds = Math.round((Date.now() - started) / 1000);
  console.log(`[Audit] ${theme}: ${result.steps.reply}, ${result.elapsedSeconds}s`);
  return { userId, token, result };
}
async function main() {
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ['スターウォーズ', 'スターウォーズで一番好きなキャラクターは誰？理由も教えて。'],
    ['プログラミング, VTUBER', 'Pythonのリストとタプルはどう使い分ける？初心者向けに理由も教えて。'],
  ];
  let first;
  for (const [theme, question] of cases) {
    try { const state = await scenario(theme, question); first ||= state; }
    catch (error) { results.worlds.at(-1).error = error.message; console.error('[Audit]', error.message); }
  }
  if (first) {
    console.log('[Audit] Begin synthetic celebrity question');
    await db.execute({ sql: "UPDATE world_settings SET position='admired',follower_scale='large' WHERE user_id=?", args: [first.userId] });
    const content = 'スターウォーズを初めて観るなら公開順と時系列順のどちらがおすすめ？理由も教えて。';
    const post = await request('/api/timeline/post', first.token, { content });
    await processPendingCelebrityScenes();
    const scene = (await db.execute({ sql: 'SELECT status,mood FROM celebrity_scenes WHERE post_id=?', args: [post.post.id] })).rows[0];
    const comments = (await db.execute({ sql: 'SELECT content,category FROM celebrity_comments WHERE scene_post_id=? ORDER BY created_at LIMIT 8', args: [post.post.id] })).rows;
    results.celebrity = { question: content, status: scene.status, mood: scene.mood, baseComments: comments };
    const metrics = await request('/api/timeline/diagnostics', first.token);
    first.result.diagnostics = { attempts: metrics.attempts, content: metrics.content };
  }
  results.attempts = (await db.execute('SELECT provider,model,outcome,COUNT(*) n,SUM(tokens) tokens FROM llm_attempts GROUP BY provider,model,outcome')).rows;
}
main().catch(error => { results.error = error.message; process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(__dirname, 'live-results.json'), JSON.stringify(results, null, 2));
  console.log('[Audit] Saved synthetic live results; DB:', dir);
  if (server) await shutdown(server); else db.close();
});
