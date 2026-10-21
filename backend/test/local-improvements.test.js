const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-local-improvements-'));
Object.assign(process.env, { SOLOVERSE_RUNTIME:'local', DB_PATH:path.join(dir,'test.db'), JWT_SECRET:'fictional-local-improvements-secret-32chars', BACKGROUND_JOBS:'false', GROQ_API_KEY:'', GEMINI_API_KEY:'', OPENROUTER_API_KEY:'' });
const { db } = require('../src/db/schema');
const { startServer, shutdown } = require('../server');
const { generateToken } = require('../src/middleware/auth');
let server, base, token;
async function request(route, body) {
  const res = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Authorization:'Bearer '+token, 'Content-Type':'application/json' }, ...(body ? { body:JSON.stringify(body) } : {}) });
  return { status:res.status, data:await res.json() };
}
test.before(async () => {
  server = await startServer(0); base = 'http://127.0.0.1:'+server.address().port;
  await db.execute("INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES('owner','owner@example.invalid','unused','owner',1),('other','other@example.invalid','unused','other',1)");
  await db.execute("INSERT INTO world_settings VALUES('owner','empathy','映画','calm','','small'),('other','empathy','映画','calm','','small')");
  await db.execute("INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES('resident','owner','住人','resident','seed','映画好き','映画','短い','mid','fast')");
  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('parent','owner','resident','ai','映画について話そう')");
  token = generateToken('owner');
});
test.after(async () => { await shutdown(server); fs.rmSync(dir,{recursive:true,force:true}); });

test('reply preparation failure saves neither text nor reservations; retry creates one of each', async () => {
  const original = db.execute;
  db.execute = input => {
    if (typeof input === 'object' && input.sql.includes('ORDER BY CASE WHEN id=')) throw new Error('fictional scheduling read outage');
    return original(input);
  };
  try { assert.equal((await request('/api/timeline/post',{content:'どの映画がおすすめ？',replyTo:'parent'})).status,500); }
  finally { db.execute = original; }
  assert.equal((await db.execute("SELECT count(*) n FROM posts WHERE reply_to='parent'")).rows[0].n,0);
  assert.equal((await db.execute('SELECT count(*) n FROM reaction_queue')).rows[0].n,0);
  const saved = await request('/api/timeline/post',{content:'どの映画がおすすめ？',replyTo:'parent'});
  assert.equal(saved.status,200); assert.equal(saved.data.scheduled.directReply,true);
  assert.equal((await db.execute("SELECT count(*) n FROM posts WHERE reply_to='parent'")).rows[0].n,1);
  const queued=(await db.execute({sql:'SELECT * FROM reaction_queue WHERE post_id=?',args:[saved.data.post.id]})).rows;
  assert.equal(queued.length,1); assert.equal(queued[0].character_id,'resident'); assert.equal(queued[0].reply_priority,1);
  const minutes=(Date.parse(queued[0].scheduled_at)-Date.now())/60000;
  assert.ok(minutes>0 && minutes<=3);
});

test('reservation write failure rolls back the reply too; retry does not duplicate it', async () => {
  await db.execute("CREATE TRIGGER reject_test_reservation BEFORE INSERT ON reaction_queue BEGIN SELECT RAISE(ABORT,'fictional reservation outage'); END");
  try { assert.equal((await request('/api/timeline/post',{content:'@resident 映画の音楽を教えて',replyTo:'parent'})).status,500); }
  finally { await db.execute('DROP TRIGGER reject_test_reservation'); }
  assert.equal((await db.execute("SELECT count(*) n FROM posts WHERE content='@resident 映画の音楽を教えて'")).rows[0].n,0);
  const saved = await request('/api/timeline/post',{content:'@resident 映画の音楽を教えて',replyTo:'parent'});
  assert.equal(saved.status,200);
  assert.equal((await db.execute("SELECT count(*) n FROM posts WHERE content='@resident 映画の音楽を教えて'")).rows[0].n,1);
  assert.equal((await db.execute({sql:'SELECT count(*) n FROM reaction_queue WHERE post_id=? AND reply_priority=2',args:[saved.data.post.id]})).rows[0].n,1);
});

test('bounded delta pages preserve every same-second post, ordering, themes and account boundaries', async () => {
  const timestamp='2026-10-01T00:00:00.123Z';
  await db.batch(Array.from({length:103},(_,i)=>({sql:"INSERT INTO posts(id,user_id,author_id,author_type,content,created_at) VALUES(?,'owner','owner','user','映画',?)",args:['delta-'+String(i).padStart(4,'0'),timestamp]})),'write');
  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content,created_at,theme_version) VALUES('archived','owner','owner','user','昔の映画','2026-10-01T00:00:00.000Z',2),('other-post','other','other','user','別世界','2026-10-01T00:00:00.000Z',1),('too-old','owner','owner','user','古い映画','2026-09-01T00:00:00.000Z',1)");
  const legacyStart='/api/timeline?since='+encodeURIComponent('2026-10-01T00:00:00.000Z');
  const start=legacyStart+'&delta=true';
  const expected=(await db.execute("SELECT id FROM posts WHERE user_id='owner' AND reply_to IS NULL AND theme_version=1 AND datetime(created_at)>=datetime('2026-10-01') ORDER BY datetime(created_at) DESC,id DESC")).rows.map(p=>p.id);
  const legacy=await request(legacyStart);
  assert.deepEqual(legacy.data.posts.map(p=>p.id),expected);
  assert.equal(legacy.data.deltaCursor,null);
  const actual=[]; let suffix='', pages=0;
  do {
    const r=await request(start+suffix); assert.equal(r.status,200); assert.ok(r.data.posts.length<=30);
    actual.push(...r.data.posts.map(p=>p.id)); pages++;
    const cursor=r.data.deltaCursor;
    suffix=cursor ? '&before='+encodeURIComponent(cursor.before)+'&beforeId='+encodeURIComponent(cursor.beforeId) : '';
    assert.ok(pages<10);
  } while(suffix);
  assert.deepEqual(actual,expected); assert.equal(new Set(actual).size,expected.length); assert.ok(pages>1);
  assert.ok(!actual.includes('archived') && !actual.includes('other-post') && !actual.includes('too-old'));
  let foundArchive=false; suffix='';
  do {
    const r=await request(start+'&history=true'+suffix); foundArchive ||= r.data.posts.some(p=>p.id==='archived');
    assert.ok(!r.data.posts.some(p=>p.id==='other-post'));
    const c=r.data.deltaCursor; suffix=c?'&before='+encodeURIComponent(c.before)+'&beforeId='+encodeURIComponent(c.beforeId):'';
  } while(suffix);
  assert.equal(foundArchive,true);
  const latest=await request('/api/timeline?page=0'); assert.equal(latest.data.posts.length,30);
  const byIds=await request('/api/timeline?ids='+actual.slice(0,50).join(',')); assert.equal(byIds.data.posts.length,50); assert.equal(byIds.data.deltaCursor,null);
});
