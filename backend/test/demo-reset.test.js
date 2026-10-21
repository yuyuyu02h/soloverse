const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-demo-reset-'));
Object.assign(process.env, { DB_PATH: path.join(dir, 'test.db'), JWT_SECRET: 'demo-reset-test-signing-secret-long-enough', BACKGROUND_JOBS: 'false', ADMIN_USER_IDS: 'demo,other-admin', DEMO_RESET_USER_IDS: 'demo' });
const { db } = require('../src/db/schema');
const { startServer, shutdown } = require('../server');
const { generateToken } = require('../src/middleware/auth');
const { touchSession, sessionId } = require('../src/services/generationActivity');
const { hashPassword } = require('../src/services/passwords');
let server, base, hash;
const tables = ['celebrity_comments','celebrity_scenes','celebrity_notification_preferences','resident_memory','resident_profiles','content_candidates','content_pool_state','reaction_queue','notifications','likes','posts','trends','character_growth_log','ai_characters','autonomous_log','content_events','world_theme_state','world_settings'];
async function api(route, token, body) {
  const response = await fetch(base + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
async function session(user='demo', scope='user') {
  const token = generateToken(user, scope);
  if (scope === 'user') await touchSession(user, sessionId(token));
  return token;
}
async function seed(user) {
  const args = [user];
  const post = 'p-' + user, char = 'c-' + user;
  await db.execute({ sql: 'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,1)', args: [user, user+'@test.invalid', hash, user] });
  await db.batch([
    { sql: "INSERT INTO world_settings VALUES(?,'empathy','映画','calm','','small')", args },
    { sql: "INSERT INTO world_theme_state VALUES(?,'映画',3,'2000-01-01','empathy')", args },
    { sql: "INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,?,'住人','resident','seed','丁寧','映画','丁寧','low','fast')", args: [char,user] },
    { sql: "INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES(?,?,?,'user','検証投稿')", args: [post,user,user] },
    { sql: "INSERT INTO likes(id,user_id,post_id,liker_id,liker_type) VALUES(?,?,?,?,'ai')", args: ['l-'+user,user,post,char] },
    { sql: "INSERT INTO resident_profiles VALUES(?,?,'{}')", args: [char,user] },
    { sql: 'INSERT INTO resident_memory VALUES(?,?,?)', args: [char,user,post] },
    { sql: "INSERT INTO celebrity_scenes(post_id,user_id,target_likes,target_comments,started_at) VALUES(?,?,10,1,'2000-01-01')", args: [post,user] },
    { sql: "INSERT INTO celebrity_comments(id,scene_post_id,user_id,author_name,author_handle,avatar_seed,content,category,created_at) VALUES(?,?,?,'観客','audience','seed','感想','fan','2000-01-01')", args: ['cc-'+user,post,user] },
    { sql: 'INSERT INTO celebrity_notification_preferences(user_id) VALUES(?)', args },
    { sql: "INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at) VALUES(?,?,?,'生成待ち','llm','2000-01-01','2000-01-01')", args: ['stock-'+user,user,char] },
    { sql: "INSERT INTO content_pool_state(user_id,next_fill_at) VALUES(?,'2000-01-01')", args },
    { sql: "INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at) VALUES(?,?,?,?,'reply','2000-01-01')", args: ['q-'+user,user,char,post] },
    { sql: "INSERT INTO notifications(id,user_id,type) VALUES(?,?,'reply')", args: ['n-'+user,user] },
    { sql: "INSERT INTO trends(id,user_id,keyword,description) VALUES(?,?,'映画','映画の話')", args: ['t-'+user,user] },
    { sql: "INSERT INTO character_growth_log(id,user_id,trigger_reason) VALUES(?,?,'growth')", args: ['g-'+user,user] },
    { sql: 'INSERT INTO autonomous_log(user_id) VALUES(?)', args },
    { sql: "INSERT INTO content_events(user_id,job,outcome,reason,scores,created_at) VALUES(?,'test','ok','','{}','2000-01-01')", args },
    { sql: "INSERT INTO llm_attempts(id,user_id,job,priority,provider,model,outcome,tokens,estimated,created_at) VALUES(?,?,'test','interactive','groq','test','success',100,0,datetime('now'))", args: ['attempt-'+user,user] },
  ], 'write');
}
test.before(async () => { server = await startServer(0); base = `http://127.0.0.1:${server.address().port}`; hash = await hashPassword('test-password-123'); });
test.beforeEach(async () => {
  process.env.DEMO_RESET_USER_IDS = 'demo';
  await db.batch(['DELETE FROM users','DELETE FROM llm_attempts'], 'write');
  for (const user of ['demo','other-admin','normal']) await seed(user);
});
test.after(async () => { await shutdown(server); fs.rmSync(dir, { recursive: true, force: true }); });

test('confirmed demo logout clears all world history, preserves credentials and quota, revokes other devices, and next login starts onboarding', async () => {
  const first = await session(), second = await session();
  assert.equal((await api('/auth/me', first)).data.resetOnLogout, true);
  const result = await api('/auth/logout', first, { confirmDemoReset: true });
  assert.equal(result.status, 200); assert.equal(result.data.worldReset, true);
  for (const table of tables) {
    assert.equal((await db.execute({ sql: `SELECT COUNT(*) n FROM ${table} WHERE user_id=?`, args: ['demo'] })).rows[0].n, 0, table);
    assert.ok((await db.execute({ sql: `SELECT COUNT(*) n FROM ${table} WHERE user_id=?`, args: ['normal'] })).rows[0].n > 0, 'other account: '+table);
  }
  const user = (await db.execute("SELECT * FROM users WHERE id='demo'")).rows[0];
  assert.equal(user.password_hash, hash); assert.equal(user.email, 'demo@test.invalid'); assert.equal(user.onboarding_done, 0);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM llm_attempts WHERE user_id='demo'")).rows[0].n, 1);
  assert.equal((await api('/auth/me', first)).status, 401); assert.equal((await api('/auth/me', second)).status, 401);
  const login = await api('/auth/login', null, { email: user.email, password: 'test-password-123' });
  assert.equal(login.status, 200); assert.equal(login.data.onboardingDone, false); assert.equal(login.data.resetOnLogout, true);
  assert.equal((await api('/auth/me', login.data.token)).data.onboardingDone, false);
});

test('demo logout requires explicit confirmation and leaves data and session intact when absent', async () => {
  const token = await session();
  assert.equal((await api('/auth/logout', token, {})).status, 409);
  assert.equal((await api('/auth/me', token)).data.onboardingDone, true);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE user_id='demo'")).rows[0].n, 1);
});

test('disabled feature, unlisted admin, non-admin and admin-scoped logout preserve worlds', async () => {
  process.env.DEMO_RESET_USER_IDS = 'demo,normal';
  for (const [user,scope] of [['demo','admin'],['other-admin','user'],['normal','user']]) {
    const token = await session(user,scope);
    assert.equal((await api('/auth/me', token)).data.resetOnLogout, false);
    assert.equal((await api('/auth/logout', token, { confirmDemoReset: true })).data.worldReset, false);
    assert.equal((await db.execute({ sql: 'SELECT onboarding_done FROM users WHERE id=?', args: [user] })).rows[0].onboarding_done, 1);
  }
  process.env.DEMO_RESET_USER_IDS = '';
  assert.equal((await api('/auth/logout', await session(), {})).data.worldReset, false);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE user_id='demo'")).rows[0].n, 1);
});

test('failed reset is atomic, keeps the session usable, and can be retried', async () => {
  const token = await session();
  await db.execute("CREATE TRIGGER reject_demo_reset BEFORE UPDATE OF onboarding_done ON users WHEN OLD.id='demo' BEGIN SELECT RAISE(ABORT,'test reset failure'); END");
  try { assert.equal((await api('/auth/logout', token, { confirmDemoReset: true })).status, 500); }
  finally { await db.execute('DROP TRIGGER reject_demo_reset'); }
  assert.equal((await api('/auth/me', token)).data.onboardingDone, true);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE user_id='demo'")).rows[0].n, 1);
  assert.equal((await api('/auth/logout', token, { confirmDemoReset: true })).status, 200);
});
