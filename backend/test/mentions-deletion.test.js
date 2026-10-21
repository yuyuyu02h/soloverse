const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-mentions-delete-'));
Object.assign(process.env, { DB_PATH:path.join(dir,'test.db'),JWT_SECRET:'mentions-delete-test-only-secret-more-than-32-characters',BACKGROUND_JOBS:'false',SOLOVERSE_RUNTIME:'local',DEMO_RESET_USER_IDS:'',CONTENT_PIPELINE:'enhanced',REGISTRATION_CLOSED:'false' });
const { db } = require('../src/db/schema');
const { startServer, shutdown } = require('../server');
const { generateToken } = require('../src/middleware/auth');
const { scheduleReactions, scheduleReplyReactions } = require('../src/services/reactionScheduler');
let server, base, owner, other;
async function api(route, token = owner, body, method) {
  const r=await fetch(base+route,{method:method||(body===undefined?'GET':'POST'),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return { status:r.status,data:await r.json() };
}
async function post(id, author='owner', parent=null, user='owner') {
  await db.execute({sql:'INSERT INTO posts(id,user_id,author_id,author_type,content,reply_to) VALUES(?,?,?,?,?,?)',args:[id,user,author,author===user?'user':'ai',`映画の感想 ${id}`,parent]});
}
test.before(async()=>{
  server=await startServer(0);base=`http://127.0.0.1:${server.address().port}`;
  for(const user of ['owner','other']) {
    await db.execute({sql:'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,1)',args:[user,`${user}@test.invalid`,'unused',user]});
    await db.execute({sql:"INSERT INTO world_settings VALUES(?,'empathy','映画','calm','','small')",args:[user]});
  }
  const cast=[['target','misaki_star','owner',1],['other-resident','sayaka_fan','owner',1],['long-handle','misaki_star_extra','owner',1],['old-resident','retired','owner',0],['foreign-resident','outsider','other',1]];
  for(const [id,handle,user,version] of cast)await db.execute({sql:"INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile,theme_version) VALUES(?,?,?,?,'seed','映画が好き','映画','短く話す','low','slow',?)",args:[id,user,handle,handle,version]});
  owner=generateToken('owner');other=generateToken('other');
});
test.after(async()=>{await shutdown(server);});

test('mentions choose the named current resident, deduplicate handles and outrank ordinary reactions',async()=>{
  await post('mention');const before=Date.now();
  const result=await scheduleReactions('owner','mention','みさき@MISAKI_STAR、音楽を聴いています。@misaki_star');
  assert.equal(result.directReply,true);
  const rows=(await db.execute("SELECT character_id,reply_priority,scheduled_at FROM reaction_queue WHERE post_id='mention' AND reaction_type='reply' ORDER BY reply_priority DESC,scheduled_at")).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].character_id,'target');assert.equal(rows[0].reply_priority,2);
  assert.ok(Date.parse(rows[0].scheduled_at)<=before+61000);
  await post('two-mentions');await scheduleReactions('owner','two-mentions','@misaki_star @sayaka_fan 音楽を聴いています。');
  assert.equal((await db.execute("SELECT COUNT(*) n FROM reaction_queue WHERE post_id='two-mentions' AND reply_priority=2")).rows[0].n,2);
});

test('unknown, old-world and email handles are not targeted; longer handles match exactly',async()=>{
  await post('not-mentions');await scheduleReactions('owner','not-mentions','contact@misaki_star.invalid @outsider @retired');
  assert.equal((await db.execute("SELECT COUNT(*) n FROM reaction_queue WHERE post_id='not-mentions' AND reply_priority=2")).rows[0].n,0);
  await post('exact-handle');await scheduleReactions('owner','exact-handle','@misaki_star_extra 音楽を聴いています。');
  assert.equal((await db.execute("SELECT character_id FROM reaction_queue WHERE post_id='exact-handle' AND reply_priority=2")).rows[0].character_id,'long-handle');
});

test('a mention in a thread prioritizes the named resident over the parent author',async()=>{
  await post('ai-parent','other-resident');await post('mention-reply','owner','ai-parent');
  await scheduleReplyReactions('owner','mention-reply','@misaki_star 音楽を聴いています。','ai-parent');
  const rows=(await db.execute("SELECT character_id,reply_priority FROM reaction_queue WHERE post_id='mention-reply' ORDER BY reply_priority DESC")).rows;
  assert.equal(rows[0].character_id,'target');assert.equal(rows[0].reply_priority,2);
});

test('the owner can erase a post while preserving its replies and cancelling pending responses',async()=>{
  await post('delete-root');await post('kept-ai','target','delete-root');await post('own-reply','owner','delete-root');await post('kept-child','other-resident','own-reply');
  await db.execute("INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at) VALUES('cancelled','owner','target','delete-root','reply','2000-01-01')");
  await db.execute("INSERT INTO content_candidates(id,user_id,character_id,content,parent_id,source,scheduled_at,created_at) VALUES('cancelled-candidate','owner','target','映画の返信','delete-root','llm','2000-01-01','2000-01-01')");
  await db.execute("INSERT INTO likes(id,user_id,post_id,liker_id,liker_type) VALUES('like-delete','owner','delete-root','target','ai')");
  assert.equal((await api('/api/timeline/post/delete-root',owner,undefined,'DELETE')).status,200);
  const stored=(await db.execute("SELECT content,deleted_at FROM posts WHERE id='delete-root'")).rows[0];assert.equal(stored.content,'');assert.ok(stored.deleted_at);
  assert.equal((await db.execute("SELECT done FROM reaction_queue WHERE id='cancelled'")).rows[0].done,1);
  assert.equal((await db.execute("SELECT state FROM content_candidates WHERE id='cancelled-candidate'")).rows[0].state,'discarded');
  assert.equal((await db.execute("SELECT COUNT(*) n FROM likes WHERE post_id='delete-root'")).rows[0].n,0);
  const timeline=await api('/api/timeline?ids=delete-root');assert.equal(timeline.data.posts.length,1);assert.ok(timeline.data.posts[0].deleted_at);assert.equal(timeline.data.posts[0].reply_preview.length,2);
  assert.equal((await api('/api/timeline/replies/delete-root')).data.replies.length,3);
  assert.equal((await api('/api/timeline/post',owner,{content:'返信します',replyTo:'delete-root'})).status,404);
  assert.equal((await api('/api/timeline/like/delete-root',owner,{})).status,404);
  assert.equal((await api('/api/timeline/post/delete-root',owner,undefined,'DELETE')).status,200);
  assert.equal((await api('/api/timeline/post/own-reply',owner,undefined,'DELETE')).status,200);
  const thread=(await api('/api/timeline/replies/delete-root')).data.replies;
  assert.ok(thread.find(p=>p.id==='own-reply').deleted_at);assert.ok(thread.some(p=>p.id==='kept-child'));
});

test('AI posts and other accounts cannot be deleted; an own post without replies disappears',async()=>{
  assert.equal((await api('/api/timeline/post/kept-ai',owner,undefined,'DELETE')).status,403);
  assert.equal((await api('/api/timeline/post/delete-root',other,undefined,'DELETE')).status,404);
  await post('leaf');assert.equal((await api('/api/timeline/post/leaf',owner,undefined,'DELETE')).status,200);
  assert.equal((await api('/api/timeline?ids=leaf')).data.posts.length,0);
  assert.equal((await api('/api/timeline/post/kept-ai',owner,undefined,'DELETE')).status,403);
});

test('deleting a celebrity post cancels future audience work and retains comments already shown',async()=>{
  await post('celebrity-delete');
  await db.execute("INSERT INTO celebrity_scenes(post_id,user_id,target_likes,target_comments,started_at) VALUES('celebrity-delete','owner',12000,420,datetime('now'))");
  for(const [id,date] of [['shown','2000-01-01'],['future','2999-01-01']])await db.execute({sql:"INSERT INTO celebrity_comments(id,scene_post_id,user_id,author_name,author_handle,avatar_seed,content,category,like_count,created_at) VALUES(?,'celebrity-delete','owner','観客','audience','seed','映画の感想','question',0,?)",args:[id,date]});
  assert.equal((await api('/api/timeline/post/celebrity-delete',owner,undefined,'DELETE')).status,200);
  assert.equal((await db.execute("SELECT status FROM celebrity_scenes WHERE post_id='celebrity-delete'")).rows[0].status,'ready');
  const comments=(await db.execute("SELECT id FROM celebrity_comments WHERE scene_post_id='celebrity-delete'")).rows;assert.deepEqual(comments.map(r=>r.id),['shown']);
});
