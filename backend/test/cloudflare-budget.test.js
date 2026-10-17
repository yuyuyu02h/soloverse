const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
Object.assign(process.env, {
  SOLOVERSE_RUNTIME: 'cloudflare', JWT_SECRET: 'fictional-budget-test-secret-long-enough', ADMIN_USER_IDS: 'owner',
  LLM_PROVIDER_ORDER: 'groq,gemini,openrouter', GROQ_API_KEY: 'fictional', GEMINI_API_KEY: 'fictional', OPENROUTER_API_KEY: 'fictional',
  LLM_REQUEST_INTERVAL_MS: '0', LLM_DAILY_TOKEN_BUDGET: '1000000', CONTENT_REVIEW: 'true', CONTENT_TEMPLATES: 'false',
  CONTENT_POOL_SIZE: '12', CONTENT_REFILL_ATTEMPTS: '1',
});
const { createClient } = require('@libsql/client');
const { db, withDatabase, queryCount } = require('../src/db/client');
const runtime = require('../src/services/llmRuntime');
runtime.attachDatabase(db);
const { serializeWorldTask } = require('../src/services/worldTasks');
const { runScheduledJobs } = require('../src/services/cloudflareJobs');
const { app } = require('../server');
const { generateToken } = require('../src/middleware/auth');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-worker-budget-'));
const client = createClient({ url: 'file:' + path.join(dir, 'test.db') });
let queries = 0, network = 0, phase = 0, generation = 0, completed, server;
const counts = [];
function charge(n = 1) {
  queries += n;
  if (queries > 50) throw new Error(`Free D1 query limit exceeded: ${queries}`);
}
const result = r => ({ results: r.rows, meta: { changes: r.rowsAffected } });
const binding = {
  prepare(sql) { return { bind(...args) { return { sql, args,
    async all() { charge(); return result(await client.execute({ sql, args })); },
    async run() { return this.all(); },
  }; } }; },
  async batch(statements) {
    charge(statements.length);
    return (await client.batch(statements.map(({ sql, args }) => ({ sql, args })), 'write')).map(result);
  },
};
const nativeFetch = global.fetch;
const contents = [
  '映画の撮影場所を調べてみた。画面で見た風景と実際の街並みを比べるのが面白い。',
  '好きな俳優の昔のインタビューを読んだ。役作りの話が具体的で印象に残った。',
  '映画館の音響が良かった。静かな場面の足音まで自然に聞こえて驚いた。',
  '昨日観た作品の音楽が忘れられない。ピアノの旋律が帰り道も頭の中で続いていた。',
];
global.fetch = async (_, options) => {
  network++;
  const body = JSON.parse(options.body), prompt = body.messages.at(-1).content;
  if (body.model.startsWith('fail-')) return new Response('{}', { status: 503 });
  let content;
  if (prompt.includes('AIキャラクターを')) {
    const start = generation++ * 5;
    content = Array.from({ length: 5 }, (_, i) => ({ name: '住人' + (start + i), username: 'resident_' + (start + i),
      avatar_seed: 'seed', bio: '映画の鑑賞記録', personality: '映画の細部に注目する', interests: '映画', reply_style: '短い感想', reaction_frequency: 'mid', delay_profile: 'fast' }));
  } else if (prompt.includes('検査対象: ')) {
    content = JSON.parse(prompt.split('検査対象: ')[1].split('\n各index')[0]).map((_, index) => ({ index, accepted: true, reason: 'accepted' }));
  } else if (prompt.includes('構造化プロフィール:')) {
    content = '映画館で観るなら、静かな場面に自然な足音が響くところに注目してほしいです。';
  } else {
    const names = [...prompt.matchAll(/"username":"([^"]+)"/g)].map(m => m[1]);
    content = contents.map((content, i) => ({ username: names[i % names.length], content }));
  }
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { total_tokens: 100 } }));
};
function freshWaterfall() {
  phase++;
  process.env.GROQ_MODELS = `fail-groq-${phase}`;
  process.env.GEMINI_MODELS = `fail-gemini-${phase}`;
  process.env.OPENROUTER_MODELS = `surviving-${phase}`;
}
async function invocation(task) {
  queries = 0; network = 0;
  const pending = [];
  await withDatabase(binding, task, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  assert.ok(queries <= 48, `queries including locks/telemetry: ${queries}`);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM deployment_locks')).rows[0].n, 0);
  counts.push({ queries, network });
}
async function request(route, body = {}) {
  const response = await nativeFetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateToken('owner')}`, 'X-SoloVerse-Active': '1' }, body: JSON.stringify(body) });
  const data = await response.json(); await completed;
  return { status: response.status, data };
}
async function clearWorld() {
  await client.executeMultiple('DELETE FROM content_candidates; DELETE FROM content_pool_state; DELETE FROM posts; DELETE FROM llm_attempts; DELETE FROM llm_provider_limits; DELETE FROM resident_profiles; DELETE FROM content_events;');
}
test.before(async () => {
  await client.execute('PRAGMA foreign_keys=ON');
  for (const f of ['0001_initial.sql', '0002_seed_wait.sql']) await client.executeMultiple(fs.readFileSync(path.join(__dirname, '../../cloudflare/migrations', f), 'utf8'));
  await client.execute("INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES('owner','owner@test.invalid','unused','owner',1)");
  await client.execute("INSERT INTO world_settings VALUES('owner','admired','映画俳優','calm','','large')");
  await client.execute({ sql: 'INSERT INTO generation_sessions VALUES(?,?,?,NULL)', args: ['s', 'owner', Date.now() + 300000] });
  await client.execute("INSERT INTO autonomous_log(user_id,last_autonomous_at,last_trend_at,last_growth_at) VALUES('owner','2000-01-01','2000-01-01','2000-01-01')");
  for (let i = 0; i < 10; i++) await client.execute({ sql: "INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,'owner','住人',?,'seed','映画を楽しむ','映画','短い','mid','fast')", args: ['c' + i, 'resident_' + i] });
  server = http.createServer((req, res) => {
    completed = invocation(() => new Promise(resolve => { res.once('finish', resolve); app(req, res); }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
});
test.after(async () => {
  global.fetch = nativeFetch;
  await new Promise(resolve => server.close(resolve));
  client.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('Worker query counts (including cleanup):', JSON.stringify(counts));
});

test('regeneration and automatic seed continuation each fit Free D1 even through three providers', async () => {
  freshWaterfall();
  const rebuilt = await request('/api/onboarding/regenerate');
  assert.equal(rebuilt.status, 200); assert.equal(rebuilt.data.seedPending, true); assert.equal(rebuilt.data.warning, null);
  assert.equal((await client.execute("SELECT COUNT(*) n FROM llm_attempts WHERE job='seed_pool'")).rows[0].n, 0);
  freshWaterfall();
  assert.equal((await request('/api/timeline/seed')).data.reason, 'initial_posts_review'); assert.equal(network, 3);
  freshWaterfall();
  assert.equal((await request('/api/timeline/seed')).data.reason, 'initial_posts_publish'); assert.equal(network, 3);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n, 0);
  const published = await request('/api/timeline/seed');
  assert.equal(published.status, 200); assert.equal(network, 0);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n, 4);
  await request('/api/timeline/seed'); assert.equal(network, 0);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n, 4);
});

test('actual Cron path separates refill, review and publication and continues on the next minute', async () => {
  await clearWorld();
  await client.execute("UPDATE autonomous_log SET last_autonomous_at='2000-01-01'");
  freshWaterfall();
  await invocation(() => runScheduledJobs(2 * 60000)); assert.equal(network, 3);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n, 0);
  freshWaterfall();
  await invocation(() => runScheduledJobs(3 * 60000)); assert.equal(network, 3);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n, 0);
  await invocation(() => runScheduledJobs(4 * 60000)); assert.equal(network, 0);
  assert.equal((await client.execute('SELECT COUNT(*) n FROM posts')).rows[0].n, 1);
});

test('admission defers an entire write batch and preserves budget for lock release and telemetry', async () => {
  await clearWorld();
  await invocation(async () => {
    await assert.rejects(serializeWorldTask('owner', async () => {
      while (queryCount() < 43) await db.execute('SELECT 1');
      await runtime.recordContent('owner', 'budget_test', 'deferred', 'worker_budget');
      await db.batch(Array.from({ length: 3 }, (_, i) => `INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('budget-${i}','owner','owner','user','映画')`), 'write');
    }), error => error.code === 'LLM_DEFERRED' && error.message === 'worker_budget');
  });
  assert.equal((await client.execute("SELECT COUNT(*) n FROM posts WHERE id LIKE 'budget-%'")).rows[0].n, 0);
  assert.equal((await client.execute("SELECT COUNT(*) n FROM content_events WHERE job='budget_test'")).rows[0].n, 1);
});

test('direct replies with eight remembered posts keep priority and finish through three providers', async () => {
  await clearWorld();
  const char = (await client.execute('SELECT id FROM ai_characters LIMIT 1')).rows[0];
  for (let i = 0; i < 8; i++) await client.execute({ sql: "INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES(?,'owner',?,'ai',?)", args: ['memory-' + i, char.id, '映画の構図やカメラの動きが印象的でした。' + i] });
  await client.execute("INSERT INTO posts(id,user_id,author_id,author_type,content,reply_to) VALUES('question','owner','owner','user','映画のどんな場面に注目すればいい？','memory-0')");
  await client.execute({ sql: "INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at) VALUES('direct-reply','owner',?,'question','reply','2000-01-01')", args: [char.id] });
  freshWaterfall();
  await invocation(() => runScheduledJobs(2 * 60000));
  assert.equal(network, 3);
  assert.equal((await client.execute("SELECT done FROM reaction_queue WHERE id='direct-reply'")).rows[0].done, 1);
  assert.equal((await client.execute("SELECT COUNT(*) n FROM posts WHERE reply_to='question' AND author_type='ai'")).rows[0].n, 1);
});
