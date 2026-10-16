const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-theme-'));
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'test.db'), JWT_SECRET: 'theme-test-signing-secret-with-enough-characters',
  BACKGROUND_JOBS: 'false', CONTENT_PIPELINE: 'enhanced', CONTENT_POOL_SIZE: '4',
  CONTENT_REFILL_ATTEMPTS: '1', CONTENT_TEMPLATES: 'false', LLM_PROVIDER_ORDER: 'groq',
  CONTENT_REVIEW: 'false',
  GROQ_API_KEY: 'test-only', GROQ_MODELS: 'theme-test', LLM_REQUEST_INTERVAL_MS: '0',
});
const { db, initDB } = require('../src/db/schema');
const { startServer, shutdown } = require('../server');
const { generateToken } = require('../src/middleware/auth');
const { evaluate } = require('../src/services/contentQuality');
const { themeState } = require('../src/services/worldTheme');
const { residentContext } = require('../src/services/residentContext');
const { fillPool, publishPool, seedEnhanced, generateReply } = require('../src/services/contentPipeline');
const { generateAICharacters } = require('../src/services/worldGenerator');
const { scheduleReplyReactions, processReactionQueue } = require('../src/services/reactionScheduler');
const celebrity = require('../src/services/celebrityMode');
const { runTrendGeneration } = require('../src/services/autonomousEngine');
const originalFetch = global.fetch;
let server, base, responses, calls, batches;
const starPosts = [
  'ヨーダの言葉を字幕と吹き替えで比べた。表現の違いで受け取る印象が変わる。',
  'オビワンの表情が気になって同じ場面を見直した。間の取り方がとても好き。',
  'ライトセーバーの模型を棚に飾った。光らせた時の色の違いを比べている。',
  'ジェダイの帰還を観た後、家族というテーマについて友人と話し合った。',
];
const moviePosts = [
  '映画の小道具がラストで再登場していた。最初から見直すと意味が分かって面白い。',
  '監督のインタビューを読んだ。撮影場所を選んだ理由が意外で印象に残る。',
  '好きな俳優の昔の作品を借りてきた。声の出し方が今と違って新鮮だった。',
  '映画館の音響が良くて、静かな場面で聞こえる足音までじっくり楽しめた。',
];
global.fetch = async (url, options) => {
  if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(String(url))) return originalFetch(url, options);
  const body = JSON.parse(options.body);
  calls.push(body);
  const prompt = body.messages.at(-1).content;
  let next = responses.shift();
  if (!next) {
    const theme = body.messages[0].content.match(/【テーマ・趣味[^\n]*\n([^\n]+)/)?.[1] || '映画';
    if (prompt.includes('AIキャラクターを5人')) {
      const offset = batches++ * 5;
      next = { content: Array.from({ length: 5 }, (_, i) => ({ name: `住人${offset+i}`,username: `resident_${offset+i}`,bio: `${theme}の感想を話す`,personality: '穏やか',interests: theme,reply_style: '理由を添える',reaction_frequency: 'high',delay_profile: 'fast' })) };
    } else if (prompt.includes('日常投稿を')) {
      const usernames = [...new Set([...prompt.matchAll(/"username":"([a-z0-9_]+)"/g)].map(m => m[1]))];
      next = { content: (theme === 'スターウォーズ' ? starPosts : moviePosts).map((content,i) => ({ username: usernames[i % usernames.length],content })) };
    } else next = { content: 'ヨーダが好きです。小さくても相手に向き合う姿勢が印象に残ったから。' };
  }
  return new Response(JSON.stringify({ model: 'test',choices: [{ finish_reason:'stop',message:{ content: typeof next.content === 'string' ? next.content : JSON.stringify(next.content) } }],usage:{ total_tokens:100 } }), { status:next.status || 200,headers:next.headers || {} });
};
async function api(route, { user = 'owner', body } = {}) {
  const response = await fetch(base+route, { method: body === undefined ? 'GET' : 'POST',headers:{ authorization:`Bearer ${generateToken(user)}`,'content-type':'application/json' },...(body === undefined ? {} : { body:JSON.stringify(body) }) });
  return { status:response.status,data:await response.json() };
}
async function post(id, author, content, parent = null, version = 1) {
  await db.execute({ sql: 'INSERT INTO posts(id,user_id,author_id,author_type,content,reply_to,theme_version) VALUES(?,?,?,?,?,?,?)',args:[id,'owner',author,author === 'owner' ? 'user' : 'ai',content,parent,version] });
}
test.before(async () => { server = await startServer(0); base = `http://127.0.0.1:${server.address().port}`; });
test.beforeEach(async () => {
  responses=[]; calls=[]; batches=0;
  process.env.CONTENT_REVIEW='false';
  process.env.GROQ_MODELS=`theme-${randomUUID()}`;
  process.env.LLM_DAILY_REQUEST_BUDGET='180'; process.env.LLM_DAILY_TOKEN_BUDGET='150000';
  await db.batch(['DELETE FROM users','DELETE FROM llm_attempts','DELETE FROM llm_provider_limits'],'write');
  for (const user of ['owner','other']) {
    await db.execute({ sql:'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,1)',args:[user,`${user}@test.invalid`,'unused',user] });
    await db.execute({ sql:'INSERT INTO world_settings VALUES(?,?,?,?,?,?)',args:[user,'empathy','スターウォーズ','calm','','mid'] });
    for (let i=0;i<2;i++) await db.execute({ sql:'INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[user+i,user,'住人'+i,`resident_${i}`,'seed','スターウォーズの感想を語る','スターウォーズ,自転車,料理','理由を添える','high','fast'] });
    await themeState(user);
  }
});
test.after(async () => { global.fetch=originalFetch; await shutdown(server); fs.rmSync(dir,{ recursive:true,force:true }); });

test('world theme is independent of hobbies; entities do not expand to every movie', () => {
  const ctx={ settings:{ interests:'スターウォーズ' },profile:{ topics:['自転車','料理'],preferences:[] } };
  assert.equal(evaluate('天気が良いので自転車で出かけた。近所の公園のベンチで休憩した。',ctx).reason,'off_topic');
  assert.equal(evaluate('昨日観た恋愛映画は俳優の演技が自然で、最後まで引き込まれた。',ctx).reason,'off_topic');
  assert.equal(evaluate(starPosts[0],ctx).accepted,true);
  assert.equal(evaluate('ライトセーバーを振り回してみたけど、まだ初心者。練習が必要だね。',ctx).reason,'roleplay');
  assert.equal(evaluate('ヨーダの「大丈夫、フォースはあなたと共に」って言葉に心が癒される。',ctx).reason,'unverified_quote');
  const programming={ ...ctx,settings:{ interests:'プログラミング, VTUBER' } };
  assert.equal(evaluate('Pythonで自動デプロイのスクリプトを書いた。入力ミスを減らせて便利。',programming).accepted,true);
  assert.equal(evaluate('水族館のBGMに合わせてサウンドデザインを仕上げた。落ち着く音になった。',programming).reason,'off_topic');
});

test('unanswered character questions retry; a concrete selection succeeds', async () => {
  const char=(await db.execute("SELECT * FROM ai_characters WHERE id='owner0'")).rows[0];
  responses=[{ content:'スターウォーズは映像が美しく、映画館で観ると最後まで引き込まれる。' },{ content:'ヨーダです。小さな体でも仲間に向き合う姿が好きだから。' }];
  process.env.CONTENT_REFILL_ATTEMPTS='2';
  try { assert.match(await generateReply('owner',char,await themeState('owner'),'一番好きなキャラクターは誰？理由も教えて。'),/ヨーダ/); assert.equal(calls.length,2); }
  finally { process.env.CONTENT_REFILL_ATTEMPTS='1'; }
});

test('a follow-up is assessed against the latest question, not an earlier who question', () => {
  const question='そのキャラクターの魅力を知るには、どの場面を見直すといい？';
  const ctx={ settings:{ interests:'スターウォーズ' },profile:{ topics:['スターウォーズ'],preferences:[] },
    target:`好きなキャラクターは誰？\nダース・ベイダーが好き。\n今答える投稿: ${question}`,question,interactive:true };
  assert.equal(evaluate('帝国の逆襲の終盤がおすすめ。ダース・ベイダーの言葉と表情に注目すると葛藤が伝わるよ。',ctx).accepted,true);
});

test('off-topic residents are rejected rather than relabeled as enthusiasts', async () => {
  const bad=Array.from({ length:5 },(_,i)=>({ name:'検証'+i,username:'bad_'+i,interests:'自転車,料理',personality:'穏やか' }));
  responses=[{ content:bad },{ content:bad }];
  await assert.rejects(generateAICharacters({ userId:'owner',position:'empathy',interests:'スターウォーズ',atmosphere:'calm',exclusions:[] }),/十分に生成/);
});

test('pool drops hobby-only candidates and can continue an existing conversation', async () => {
  await post('root','owner1','ヨーダのどの場面が好き？理由も教えて。');
  responses=[{ content:[
    { username:'resident_0',content:'自転車で公園へ出かけた。帰りにカフェで休憩してきた。' },
    { username:'resident_0',content:starPosts[0],reply_to_id:'root' },
    { username:'resident_1',content:starPosts[1] },
    { username:'resident_0',content:starPosts[2],reply_to_id:'other-private-root' },
  ] }];
  assert.equal(await fillPool('owner',{ seed:true }),2);
  assert.equal(await publishPool('owner'),2);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE reply_to='root'")).rows[0].n,1);
  const reasons=(await db.execute("SELECT reason FROM content_events WHERE outcome='rejected'")).rows.map(r=>r.reason);
  assert.ok(reasons.includes('off_topic')); assert.ok(reasons.includes('invalid_parent'));
});

test('profile refresh and publication guard protect against a settings-only edit', async () => {
  let char=(await db.execute("SELECT * FROM ai_characters WHERE id='owner0'")).rows[0];
  await residentContext('owner',char);
  await post('old-memory','owner0',starPosts[0]);
  await db.execute({ sql:"INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at) VALUES('old','owner','owner0',?,'llm',?,?)",args:[starPosts[1],new Date().toISOString(),new Date().toISOString()] });
  await db.execute("UPDATE world_settings SET interests='映画' WHERE user_id='owner'");
  await db.execute("UPDATE ai_characters SET interests='映画' WHERE id='owner0'");
  char=(await db.execute("SELECT * FROM ai_characters WHERE id='owner0'")).rows[0];
  const ctx=await residentContext('owner',char);
  assert.deepEqual(ctx.profile.topics,['映画']); assert.deepEqual(ctx.memory,[]);
  assert.equal(await publishPool('owner'),0);
  assert.equal((await db.execute("SELECT state FROM content_candidates WHERE id='old'")).rows[0].state,'discarded');
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE id='old-memory'")).rows[0].n,1);
});

test('theme API archives complete threads, cancels old work, seeds new world, and is idempotent', async () => {
  await post('old-root','owner0',starPosts[0]);
  await post('old-user-reply','owner','自分もその場面が好きです。','old-root');
  await celebrity.createCelebrityScene('owner','old-root',starPosts[0]);
  await db.execute("INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at) VALUES('old-work','owner','owner0','old-user-reply','reply',datetime('now'))");
  const switched=await api('/api/onboarding/theme',{ body:{ interests:'映画' } });
  assert.equal(switched.status,200); assert.equal(switched.data.themeVersion,2);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE user_id='owner'")).rows[0].n,2);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM ai_characters WHERE user_id='owner' AND theme_version=1")).rows[0].n,2);
  assert.equal((await db.execute("SELECT done FROM reaction_queue WHERE id='old-work'")).rows[0].done,1);
  assert.equal((await api('/api/timeline')).data.posts.length,0);
  const history=await api('/api/timeline?history=true');
  assert.equal(history.data.posts.length,1); assert.equal(history.data.posts[0].archived,true);
  assert.equal((await api('/api/timeline/replies/old-root')).data.replies.length,1);
  assert.equal((await api('/api/timeline/post',{ body:{ content:'前の話への返信',replyTo:'old-root' } })).status,409);
  assert.equal((await api('/api/timeline/characters')).data.characters.length,10);
  assert.equal((await api('/api/onboarding/world',{ user:'other' })).data.settings.theme_version,1);
  const before=calls.length;
  assert.equal((await api('/api/onboarding/theme',{ body:{ interests:'映画' } })).data.unchanged,true);
  assert.equal(calls.length,before);
  assert.ok(await seedEnhanced('owner')>0);
  assert.ok((await api('/api/timeline')).data.posts.every(p=>p.theme_version===2 && !p.archived));
  assert.equal((await api('/api/onboarding/regenerate',{body:{}})).status,200);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM celebrity_scenes WHERE post_id='old-root'")).rows[0].n,1);
  await initDB();
  assert.equal((await themeState('owner')).theme_version,2);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE id IN ('old-root','old-user-reply')")).rows[0].n,2);
});

test('failed theme preparation leaves current world and history intact; bad input uses no LLM', async () => {
  await post('keep','owner0',starPosts[0]);
  assert.equal((await api('/api/onboarding/theme',{ body:{ interests:['映画',{}] } })).status,400);
  assert.equal(calls.length,0);
  responses=[{ content:[] },{ content:[] }];
  assert.equal((await api('/api/onboarding/theme',{ body:{ interests:'映画' } })).status,503);
  assert.equal((await themeState('owner')).interests,'スターウォーズ');
  assert.equal((await themeState('owner')).theme_version,1);
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE id='keep'")).rows[0].n,1);
});

test('follow-up prioritizes its author even in celebrity mode and passes the thread context', async () => {
  await db.execute("UPDATE world_settings SET position='admired' WHERE user_id='owner'");
  const version=(await themeState('owner')).theme_version;
  await db.execute({sql:"UPDATE ai_characters SET theme_version=? WHERE user_id='owner'",args:[version]});
  await post('root','owner0','ヨーダのセリフを字幕で比べてみた。表現が違うところが面白い。',null,version);
  await post('followup','owner','どの表現が特に好き？理由を教えて。','root',version);
  const originalRandom=Math.random; Math.random=()=>0.99;
  try { const reserved=await scheduleReplyReactions('owner','followup','どの表現が特に好き？理由を教えて。','root',version); assert.equal(reserved.directReply,true); }
  finally { Math.random=originalRandom; }
  const queue=(await db.execute("SELECT * FROM reaction_queue WHERE post_id='followup'")).rows;
  assert.equal(queue.length,1); assert.equal(queue[0].character_id,'owner0');
  assert.ok(Date.parse(queue[0].scheduled_at)<=Date.now()+3*60000);
  await db.execute("UPDATE reaction_queue SET scheduled_at=datetime('now','-1 second')");
  await processReactionQueue();
  assert.equal((await db.execute("SELECT COUNT(*) n FROM posts WHERE reply_to='followup' AND author_id='owner0'")).rows[0].n,1);
  assert.match(calls.at(-1).messages.at(-1).content,/ヨーダのセリフ/);
  assert.match(calls.at(-1).messages.at(-1).content,/今答える投稿/);
});

test('quota waiting stays pending and invisible replies are not counted', async () => {
  await db.execute("UPDATE world_settings SET position='admired' WHERE user_id='owner'");
  await post('star','owner','スターウォーズは公開順と時系列順のどちらがいい？');
  await celebrity.createCelebrityScene('owner','star','スターウォーズは公開順と時系列順のどちらがいい？',new Date(Date.now()-2*3600000).toISOString());
  responses=[{ status:429,content:'limited',headers:{ 'retry-after':'60' } }];
  assert.equal(await celebrity.processPendingCelebrityScenes(),0);
  assert.equal((await db.execute("SELECT status FROM celebrity_scenes WHERE post_id='star'")).rows[0].status,'pending');
  assert.equal((await db.execute('SELECT COUNT(*) n FROM celebrity_comments')).rows[0].n,0);
  const [decorated]=await celebrity.decorateTimelinePosts('owner',[{ id:'star',like_count:0,reply_count:0 }]);
  assert.equal(decorated.reply_count,0); assert.ok(decorated.audience_reaction_count>100);
});

test('C# is not a hashtag while ordinary Japanese and English tags still count', async () => {
  await post('tags','owner','C#でゲームを作った。#スターウォーズ #Python');
  const trends=await runTrendGeneration('owner');
  assert.deepEqual(trends.map(t=>t.keyword).sort(),['Python','スターウォーズ']);
});

test('legacy fallback still attaches replies to the current theme after a switch', async () => {
  await api('/api/onboarding/theme',{body:{interests:'映画'}});
  process.env.CONTENT_PIPELINE='legacy';
  try {
    const created=await api('/api/timeline/post',{body:{content:'映画のどの場面が印象に残った？'}});
    const queued=(await db.execute({sql:"SELECT id FROM reaction_queue WHERE post_id=? AND reaction_type='reply' ORDER BY scheduled_at LIMIT 1",args:[created.data.post.id]})).rows[0];
    await db.execute("UPDATE reaction_queue SET scheduled_at=datetime('now','+1 day')");
    await db.execute({sql:"UPDATE reaction_queue SET scheduled_at=datetime('now','-1 second') WHERE id=?",args:[queued.id]});
    responses=[{content:'映画のラストで小道具が再登場する場面が好きです。伏線の意味が伝わったから。'}];
    await processReactionQueue();
    const replies=(await api('/api/timeline/replies/'+created.data.post.id)).data.replies;
    assert.equal(replies.length,1);assert.equal(replies[0].theme_version,2);
  } finally {process.env.CONTENT_PIPELINE='enhanced';}
});

test('one batch review removes unnatural keyword stuffing and orphaned replies', async () => {
  process.env.CONTENT_REVIEW='true';
  responses=[{content:[
    {username:'resident_0',content:'新たなる希望のカフェでミレニアムファルコンを眺めながらコーヒーを飲んだ。'},
    {username:'resident_1',content:'ミレニアムファルコンを眺められるカフェ、行ってみたい。',reply_to_index:0},
    {username:'resident_0',content:starPosts[0]},
    {username:'resident_1',content:starPosts[1]},
  ]},{content:[
    {index:0,accepted:false,reason:'unnatural_content'},
    {index:1,accepted:true,reason:'accepted'},
    {index:2,accepted:true,reason:'accepted'},
    {index:3,accepted:true,reason:'accepted'},
  ]}];
  assert.equal(await fillPool('owner',{seed:true}),2);
  assert.equal(calls.length,2);
  assert.equal(await publishPool('owner'),2);
  assert.equal(calls.length,2); // Already-reviewed candidates do not need another judge call.
  const rows=(await db.execute('SELECT content,reviewed FROM content_candidates')).rows;
  assert.ok(rows.every(row=>row.reviewed===1 && !row.content.includes('カフェ')));
});

test('incomplete review never silently approves candidates, and old pending content is reviewed before publication', async () => {
  process.env.CONTENT_REVIEW='true';
  responses=[{content:starPosts.map((content,i)=>({username:`resident_${i%2}`,content}))},{content:[{index:0,accepted:true}]}];
  assert.equal(await fillPool('owner',{seed:true}),0);
  assert.equal((await db.execute('SELECT COUNT(*) n FROM content_candidates')).rows[0].n,0);
  await db.execute({sql:"INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at) VALUES('legacy-pending','owner','owner0',?,'llm',?,?)",args:[starPosts[0],new Date().toISOString(),new Date().toISOString()]});
  responses=[{content:[{index:0,accepted:false,reason:'unnatural_content'}]}];
  assert.equal(await publishPool('owner'),0);
  assert.equal((await db.execute("SELECT state FROM content_candidates WHERE id='legacy-pending'")).rows[0].state,'discarded');
});
