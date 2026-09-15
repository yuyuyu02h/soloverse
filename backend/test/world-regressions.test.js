const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloverse-world-'));
process.env.DB_PATH = path.join(testDir, 'world.db');
process.env.LLM_PROVIDER_ORDER = 'openrouter';
process.env.OPENROUTER_API_KEY = 'test-only';
process.env.OPENROUTER_MODELS = 'openrouter/free';
process.env.LLM_REQUEST_INTERVAL_MS = '0';
const { db, initDB } = require('../src/db/schema');
const {
  analyzeEngagementIntent,
  generateAITimelinePosts,
  scheduleReactions,
  backfillDirectReplies,
} = require('../src/services/reactionScheduler');
const { runAutonomousTimeline, runTrendGeneration, runCharacterGrowth } = require('../src/services/autonomousEngine');
const originalFetch = global.fetch;
let calls = 0;
let output;
global.fetch = async () => {
  calls++;
  await new Promise(resolve => setTimeout(resolve, 10));
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof output === 'string' ? output : JSON.stringify(output) } }] }));
};

test.before(async () => {
  await initDB();
  for (const userId of ['owner', 'other']) {
    await db.execute({ sql: 'INSERT INTO users (id,email,password_hash,username,onboarding_done) VALUES (?,?,?,?,1)', args: [userId, userId + '@test.invalid', 'unused', userId] });
    await db.execute({ sql: 'INSERT INTO world_settings VALUES (?,?,?,?,?,?)', args: [userId, 'observer', '映画', 'vent', '', 'small'] });
    for (let i = 0; i < 3; i++) await db.execute({
      sql: 'INSERT INTO ai_characters (id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES (?,?,?,?,?,?,?,?,?,?)',
      args: [userId + i, userId, '住人' + i, 'resident_' + i, 'seed', '映画の感想を話す', '映画', '具体的に答える', 'low', 'normal'],
    });
  }
});
test.after(async () => { global.fetch = originalFetch; db.close(); fs.rmSync(testDir, { recursive: true, force: true }); });

test('初期生成の同時リクエストと再試行で重複保存・API二重消費をしない', async () => {
  output = [{ username: 'resident_0', content: '映画を見た #映画' }, { username: 'resident_0', content: '同じ人の余分な投稿' }];
  calls = 0;
  await Promise.all([generateAITimelinePosts('owner'), generateAITimelinePosts('owner')]);
  await generateAITimelinePosts('owner');
  assert.equal(calls, 1);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM posts WHERE user_id='owner'")).rows[0].n, 1);
});

test('返信は指定した投稿へ付き、質問や親投稿より前の時刻にならない', async () => {
  await db.execute({ sql: "INSERT INTO posts (id,user_id,author_id,author_type,content,created_at) VALUES ('question','owner','owner','user','どちらが好き？',?)", args: [new Date(Date.now() - 60000).toISOString()] });
  output = [
    { username: 'resident_1', content: 'ルーク派。最後まで父を信じるところが好き', reply_to_id: 'question' },
    { username: 'resident_2', content: 'あの場面が好きなのはわかる', reply_to_index: 0 },
    { username: 'resident_0', content: '存在しない返信先', reply_to_id: 'foreign-post' },
    { username: 'resident_0', content: '未来の要素への返信', reply_to_index: 9 },
  ];
  assert.equal(await runAutonomousTimeline('owner'), 2);
  const rows = await db.execute("SELECT child.*, parent.created_at AS parent_time FROM posts child JOIN posts parent ON child.reply_to=parent.id WHERE child.user_id='owner'");
  assert.equal(rows.rows.length, 2);
  for (const row of rows.rows) assert.ok(new Date(row.created_at) >= new Date(row.parent_time));
});

test('トレンドは実投稿件数を集計し、他ユーザー・同一投稿の重複タグを混ぜずLLMを呼ばない', async () => {
  await db.execute("INSERT INTO posts (id,user_id,author_id,author_type,content) VALUES ('tag-owner','owner','owner','user','#映画 #映画 #StarWars')");
  await db.execute("INSERT INTO posts (id,user_id,author_id,author_type,content) VALUES ('tag-other','other','other','user','#別の世界')");
  calls = 0;
  const before = (await db.execute('SELECT COUNT(*) AS n FROM posts')).rows[0].n;
  const trends = await runTrendGeneration('owner');
  assert.equal(calls, 0);
  assert.equal(trends.find(t => t.keyword === '映画').post_count, 2);
  assert.ok(!trends.some(t => t.keyword === '別の世界'));
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM posts')).rows[0].n, before);
});

test('疑問符なしの質問・呼びかけも認識する', () => {
  assert.equal(analyzeEngagementIntent('Starwarsなら誰が好きみんな').wantsReply, true);
  assert.equal(analyzeEngagementIntent('無視しないでーみんなー').wantsReply, true);
  assert.equal(analyzeEngagementIntent('映画を見た').wantsReply, false);
});

test('smallでも直接の質問には数分以内の返信が予約される', async () => {
  const before = Date.now();
  const scheduled = await scheduleReactions('owner', 'question', 'Starwarsなら誰が好きみんな');
  const result = await db.execute("SELECT scheduled_at FROM reaction_queue WHERE post_id='question' AND reaction_type='reply'");
  assert.ok(result.rows.length >= 1);
  assert.equal(scheduled.directReply, true);
  assert.ok(new Date(result.rows[0].scheduled_at).getTime() <= before + 4 * 60000);
});

test('旧判定で取りこぼした直近の呼びかけをDB削除なしで救済する', async () => {
  await db.execute({
    sql: "INSERT INTO posts (id,user_id,author_id,author_type,content,created_at) VALUES ('missed-call','other','other','user','無視しないでーみんなー',?)",
    args: [new Date(Date.now() - 3 * 60000).toISOString()],
  });
  assert.equal(await backfillDirectReplies(), 1);
  const result = await db.execute("SELECT COUNT(*) AS n FROM reaction_queue WHERE post_id='missed-call' AND reaction_type='reply'");
  assert.equal(result.rows[0].n, 1);
  assert.equal(await backfillDirectReplies(), 0);
});

test('成長履歴のない既存ユーザーも起動直後に住人が増えない', async () => {
  calls = 0;
  await runCharacterGrowth('other');
  assert.equal(calls, 0);
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM ai_characters WHERE user_id='other'")).rows[0].n, 3);
});
