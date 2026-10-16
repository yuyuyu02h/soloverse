const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-modes-'));
Object.assign(process.env, { DB_PATH:path.join(dir,'test.db'),JWT_SECRET:'experience-mode-test-signing-secret-long',
  BACKGROUND_JOBS:'false',CONTENT_PIPELINE:'enhanced',CONTENT_POOL_SIZE:'4',CONTENT_REFILL_ATTEMPTS:'1',CONTENT_REVIEW:'false',CONTENT_TEMPLATES:'true',
  LLM_PROVIDER_ORDER:'groq',GROQ_API_KEY:'test-only',GROQ_MODELS:'modes-test',LLM_REQUEST_INTERVAL_MS:'0',ADMIN_USER_IDS:'admin' });
const { db } = require('../src/db/schema');
const { startServer, shutdown } = require('../server');
const { generateToken } = require('../src/middleware/auth');
const { buildWorldSystemPrompt } = require('../src/services/llm');
const { themeState } = require('../src/services/worldTheme');
const { readSetup, resolveMode } = require('../src/services/worldModes');
const { planRoles } = require('../src/services/worldGenerator');
const { residentContext } = require('../src/services/residentContext');
const { evaluate } = require('../src/services/contentQuality');
const { fillPool, publishPool } = require('../src/services/contentPipeline');
const { processPendingCelebrityScenes } = require('../src/services/celebrityMode');
const { runCharacterGrowth } = require('../src/services/autonomousEngine');
const originalFetch = global.fetch;
let server, base, calls, batch, unavailable, passwordHash;
global.fetch = async (url, options) => {
  if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(String(url))) return originalFetch(url,options);
  const body = JSON.parse(options.body); calls.push(body);
  if (unavailable) return new Response('{}',{ status:503 });
  const prompt=body.messages.at(-1).content, system=body.messages[0].content;
  const theme=system.match(/【テーマ・趣味[^\n]*\n([^\n]+)/)?.[1] || 'VTuber界隈';
  const match=prompt.match(/AIキャラクターを(\d+)人/);
  let content;
  if (match) {
    const offset=batch++*5;
    content=Array.from({length:Number(match[1])},(_,i)=>({name:'検証住人'+(offset+i),username:'resident_'+(offset+i),avatar_seed:'seed',bio:`${theme}を楽しんでいます`,
      personality:`${theme}の話題${offset+i}を実際に試して話す`,interests:theme,reply_style:`切り口${offset+i}について短く尋ねる`,reaction_frequency:'mid',delay_profile:'normal'}));
  } else if(system.includes('観客反応ディレクター')) {
    content={mood:'感想と質問',comments:[{category:'analysis',content:'声が安定しているのは最近のボイストレーニングの成果だね。'},{category:'question',content:'リハーサルで気持ちよく歌えた曲はどれですか？'}]};
  } else if (prompt.includes('検査対象: ')) {
    const rows=JSON.parse(prompt.split('検査対象: ')[1].split('\n各index')[0]);
    content=rows.map((row,index)=>({index,accepted:!(/カレー|ボイストレーニング/.test(row.content)),reason:/カレー|ボイストレーニング/.test(row.content)?'unnatural_content':'accepted'}));
  } else content=`${theme}の話を聞きたくて参加しました。最近の楽しみ方も教えてください。`;
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof content==='string'?content:JSON.stringify(content)}}],usage:{total_tokens:100}}),{headers:{'content-type':'application/json'}});
};
async function api(route,body,user='owner',token=generateToken(user)) {
  const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json()};
}
async function setup(mode,context) {
  const key={hobby:'hobbies',celebrity:'celebrityRole',community:'community'}[mode];
  const result=await api('/api/onboarding/submit',{mode,[key]:context,atmosphere:'active',exclusions:[]});
  assert.equal(result.status,200,JSON.stringify(result.data)); return result.data;
}
test.before(async()=>{passwordHash=await bcrypt.hash('TestOnly2026!',4);server=await startServer(0);base=`http://127.0.0.1:${server.address().port}`;});
test.beforeEach(async()=>{
  calls=[];batch=0;unavailable=false;process.env.CONTENT_REVIEW='false';
  process.env.ADMIN_USER_IDS='admin';process.env.GROQ_MODELS='mode-'+randomUUID();process.env.LLM_DAILY_REQUEST_BUDGET='180';process.env.LLM_DAILY_TOKEN_BUDGET='150000';
  await db.batch(['DELETE FROM users','DELETE FROM llm_attempts','DELETE FROM llm_provider_limits'],'write');
  for(const id of ['owner','admin']) await db.execute({sql:'INSERT INTO users(id,email,password_hash,username) VALUES(?,?,?,?)',args:[id,`${id}@test.invalid`,passwordHash,id]});
});
test.after(async()=>{global.fetch=originalFetch;await shutdown(server);fs.rmSync(dir,{recursive:true,force:true});});

for(const [mode,context] of [['hobby','自作キーボード'],['celebrity','ロックミュージシャン'],['community','V系界隈']]) {
  test(`${mode}: dedicated setup input survives generation and reaches the posting profile`,async()=>{
    await setup(mode,context);
    const world=(await api('/api/onboarding/world')).data;
    assert.equal(world.settings.mode,mode);assert.equal(world.settings.interests,context);assert.equal(world.characters.length,10);
    const counts={};for(const c of world.characters) counts[c.participation_role]=(counts[c.participation_role]||0)+1;
    assert.equal(Object.keys(counts).length,5);assert.deepEqual(Object.values(counts),[2,2,2,2,2]);
    assert.ok(calls[1].messages.at(-1).content.includes(world.characters[0].personality));
    assert.ok(calls[1].messages.at(-1).content.includes(world.characters[0].reply_style));
    const ctx=await residentContext('owner',world.characters[0]);assert.equal(ctx.profile.mode,mode);assert.equal(ctx.profile.participation,world.characters[0].participation_role);
    const timeline=await api('/api/timeline');assert.equal(timeline.data.mode,mode);assert.ok(timeline.data.modeLabel);
  });
}
test('wrong mode inputs are rejected before generation; hobby selection does not substitute for role/community',async()=>{
  for(const body of [{mode:'observer',hobbies:'映画'},{mode:'celebrity',hobbies:'映画'},{mode:'community',hobbies:'映画'},{mode:'community',community:['V系',{}]}]) {
    assert.equal((await api('/api/onboarding/submit',{...body,atmosphere:'active'})).status,400);
  }
  assert.equal(calls.length,0);assert.equal((await db.execute('SELECT COUNT(*) n FROM world_settings')).rows[0].n,0);
});
test('generation prompts separate hobby support from realistic role and community experiences',()=>{
  const prompt=mode=>buildWorldSystemPrompt({mode,interests:'検証',atmosphere:'active',exclusions:''});
  assert.match(prompt('hobby'),/ニッチな趣味や専門分野/);
  assert.match(prompt('community'),/ユーザーを会話の中心に固定せず/);
  assert.match(prompt('celebrity'),/異なる距離感/);
  for(const mode of ['celebrity','community']) {
    assert.match(prompt(mode),/全員に共感・称賛・励ましを強制しない/);
    assert.doesNotMatch(prompt(mode),/必ず共感の言葉で反応|批判的な人物.*生成しない/);
  }
});
test('community vocabulary and ordinary celebrity posts pass without forcing hobby terms',()=>{
  const ctx={profile:{preferences:[]}};
  assert.equal(evaluate('セトリの流れが好きで、音源も同じ順番に並べて聴いてる。',{...ctx,settings:{position:'community',interests:'V系界隈'}}).accepted,true);
  assert.equal(evaluate('歌枠のアーカイブ見てたら、あのサビだけ何度も戻してしまう。',{...ctx,settings:{position:'community',interests:'VTuber界隈'}}).accepted,true);
  const daily='夕飯のカレーを作りすぎた。明日も食べることになりそう。';
  assert.equal(evaluate(daily,{...ctx,settings:{position:'admired',interests:'ロックミュージシャン'}}).accepted,true);
  assert.equal(evaluate(daily,{...ctx,settings:{position:'empathy',interests:'自作キーボード'}}).reason,'off_topic');
});
test('mode change with the same context archives history, carries roles, and is idempotent',async()=>{
  await setup('hobby','VTuber');
  await api('/api/timeline/post',{content:'Live2Dを触り始めました。'});
  const old=(await db.execute("SELECT id,content FROM posts WHERE user_id='owner'")).rows;
  const change=await api('/api/onboarding/theme',{mode:'community',community:'VTuber'});
  assert.equal(change.status,200);assert.equal(change.data.themeVersion,2);
  assert.equal((await themeState('owner')).mode,'community');
  assert.equal((await db.execute("SELECT COUNT(*) n FROM ai_characters WHERE theme_version=2 AND participation_role!=''")).rows[0].n,10);
  assert.deepEqual((await db.execute("SELECT id,content FROM posts WHERE user_id='owner' AND theme_version=1")).rows,old);
  assert.equal((await api('/api/timeline')).data.posts.length,0);
  assert.ok((await api('/api/timeline?history=true')).data.posts[0].archived);
  const before=calls.length;assert.equal((await api('/api/onboarding/theme',{mode:'community',community:'VTuber'})).data.unchanged,true);assert.equal(calls.length,before);
});
test('failed mode change preserves mode, residents, and history',async()=>{
  await setup('hobby','VTuber');unavailable=true;
  assert.equal((await api('/api/onboarding/theme',{mode:'celebrity',celebrityRole:'歌手'})).status,503);
  assert.equal((await themeState('owner')).mode,'hobby');assert.equal((await themeState('owner')).theme_version,1);
  assert.equal((await api('/api/onboarding/world')).data.characters.length,10);
});
test('legacy observer is read as community without overwriting saved settings',async()=>{
  await db.execute("INSERT INTO world_settings VALUES('owner','observer','VTuber','active','','small')");
  assert.equal((await themeState('owner')).mode,'community');assert.equal((await db.execute("SELECT position FROM world_settings WHERE user_id='owner'")).rows[0].position,'observer');
  assert.equal(resolveMode({position:'empathy'}),'hobby');assert.equal(readSetup({position:'observer',interests:'映画'}).mode,'community');
});
test('later arrivals use the same generator and include existing residents in the prompt',async()=>{
  await setup('community','VTuber界隈');
  await db.execute("UPDATE autonomous_log SET last_growth_at=datetime('now','-7 hours') WHERE user_id='owner'");
  const start=calls.length,random=Math.random;Math.random=()=>0.9;
  try {assert.equal(await runCharacterGrowth('owner'),2);}finally{Math.random=random;}
  const generation=calls.slice(start).find(c=>c.messages.at(-1).content.includes('AIキャラクターを2人'));
  assert.ok(generation);assert.match(generation.messages.at(-1).content,/切り口0/);assert.match(generation.messages[0].content,/架空の利用者を設計/);
  const added=(await db.execute("SELECT participation_role FROM ai_characters WHERE user_id='owner' ORDER BY created_at")).rows;
  assert.equal(added.length,12);assert.ok(added.every(c=>c.participation_role));
  assert.deepEqual(planRoles({mode:'hobby'},[{participation_role:'初心者'},{participation_role:'詳しい人'}],1),['実践する人']);
});
test('realistic modes do not replace unavailable AI with generic encouragement templates',async()=>{
  await setup('community','VTuber界隈');process.env.LLM_DAILY_TOKEN_BUDGET='100';
  const before=calls.length;await fillPool('owner');
  assert.equal(calls.length,before);assert.equal((await db.execute("SELECT COUNT(*) n FROM content_candidates WHERE source='template'")).rows[0].n,0);
});
test('admin requires separate scoped login and server-side user ID allowlist',async()=>{
  assert.equal((await api('/api/admin/overview',undefined,'admin')).status,403);
  assert.equal((await api('/api/admin/overview',undefined,'owner',generateToken('owner','admin'))).status,403);
  const denied=await api('/api/auth/admin/login',{email:'owner@test.invalid',password:'TestOnly2026!',role:'admin'});assert.equal(denied.status,403);assert.equal(denied.data.token,undefined);
  assert.equal((await api('/api/auth/admin/login',{email:'admin@test.invalid',password:'incorrect'})).status,401);
  const logged=await api('/api/auth/admin/login',{email:'admin@test.invalid',password:'TestOnly2026!'});assert.equal(logged.status,200);
  const overview=await api('/api/admin/overview',undefined,'admin',logged.data.token);assert.equal(overview.status,200);assert.equal(overview.data.users,2);
  assert.equal(overview.data.modes.length,3);assert.doesNotMatch(JSON.stringify(overview.data),/password_hash|JWT_SECRET|test-only|owner@test/);
  process.env.ADMIN_USER_IDS='';assert.equal((await api('/api/admin/overview',undefined,'admin',logged.data.token)).status,403);
});

test('unknown niche subjects are semantically reviewed and rejected candidates never publish',async()=>{
  await setup('hobby','自作キーボード');process.env.CONTENT_REVIEW='true';
  const char=(await db.execute("SELECT id FROM ai_characters WHERE user_id='owner' LIMIT 1")).rows[0].id;
  for(const [id,content] of [['niche','スイッチを交換したら打鍵音が軽くなった。キーキャップの厚さも比べてみたい。'],['unrelated','夕飯のカレーを作りすぎた。明日も同じ料理を食べることになりそう。']]) {
    await db.execute({sql:"INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at) VALUES(?,'owner',?,?,'llm',datetime('now','-1 second'),datetime('now'))",args:[id,char,content]});
  }
  assert.equal(await publishPool('owner'),1);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE id='niche'")).rows[0].n,1);
  assert.equal((await db.execute("SELECT state FROM content_candidates WHERE id='unrelated'")).rows[0].state,'discarded');
  const noReview=evaluate('スイッチを交換したら打鍵音が軽くなった。キーキャップの厚さも比べてみたい。',{settings:{interests:'自作キーボード'},profile:{preferences:[]}});
  assert.equal(noReview.reason,'off_topic');
});

test('celebrity comments are batch-reviewed before invented achievements become visible',async()=>{
  await setup('celebrity','ロックミュージシャン');process.env.CONTENT_REVIEW='true';
  const posted=await api('/api/timeline/post',{content:'リハーサル終わり。今日は声がよく出て気持ちよかった。'});
  const before=calls.length;assert.equal(await processPendingCelebrityScenes(),1);assert.equal(calls.length-before,2);
  const comments=(await db.execute({sql:'SELECT content FROM celebrity_comments WHERE scene_post_id=?',args:[posted.data.post.id]})).rows;
  assert.equal(comments.length,150);assert.ok(comments.every(c=>!c.content.includes('ボイストレーニング')));
  assert.ok(comments.some(c=>c.content.includes('気持ちよく歌えた曲')));
});

test('concurrent onboarding submissions generate and save only one world',async()=>{
  const body={mode:'community',community:'VTuber界隈',atmosphere:'active',exclusions:[]};
  const results=await Promise.all([api('/api/onboarding/submit',body),api('/api/onboarding/submit',body)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(calls.length,2);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM ai_characters WHERE user_id='owner'")).rows[0].n,10);
});
