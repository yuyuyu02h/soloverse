const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soloverse-celebrity-'));
process.env.DB_PATH = path.join(testDir, 'celebrity.db');
process.env.LLM_PROVIDER_ORDER = 'groq';
process.env.GROQ_API_KEY = 'test-only';
process.env.GROQ_MODELS = 'celebrity-test';
process.env.LLM_REQUEST_INTERVAL_MS = '0';

const { db, initDB } = require('../src/db/schema');
const {
  experienceMode,
  createCelebrityScene,
  processPendingCelebrityScenes,
  decorateTimelinePosts,
  celebrityComments,
} = require('../src/services/celebrityMode');
const { processReactionQueue } = require('../src/services/reactionScheduler');
const { runCharacterGrowth } = require('../src/services/autonomousEngine');

const originalFetch = global.fetch;
let requests = [];
global.fetch = async (_, options) => {
  requests.push(JSON.parse(options.body));
  const comments = [
    ['analysis', '最後の一文に今日の気分が全部詰まっている感じがした。'],
    ['question', 'この考えに至ったきっかけも、いつか聞いてみたい！'],
    ['empathy', 'ちょうど同じことを考えていたから、言葉にしてくれてうれしい。'],
    ['humor', '通知を見て三秒で来た人、正直に手を挙げて。'],
    ['praise', '短い言葉なのに余韻が残る投稿で、何度も読み返した。'],
    ['question', '続きがあるなら、次の投稿で少しだけ教えてほしいです。'],
    ['empathy', '今日このタイミングで読めたことが、なんだかうれしい。'],
    ['analysis', 'いつもの投稿とは少し違う温度感なのが印象に残った。'],
  ].map(([category, content]) => ({ category, content }));
  const content = JSON.stringify({
    mood: '共感を中心に質問が広がる',
    reaction_mix: { praise: 25, empathy: 30, question: 25, humor: 10, analysis: 10 },
    comments,
  });
  return new Response(JSON.stringify({
    model: 'test',
    choices: [{ finish_reason: 'stop', message: { content } }],
  }), { headers: { 'content-type': 'application/json' } });
};

test.before(async () => {
  await initDB();
  for (const [id, position] of [['star', 'admired'], ['friend', 'empathy'], ['other', 'admired']]) {
    await db.execute({
      sql: 'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,1)',
      args: [id, `${id}@test.invalid`, 'unused', id],
    });
    await db.execute({
      sql: 'INSERT INTO world_settings(user_id,position,interests,atmosphere,exclusions,follower_scale) VALUES(?,?,?,?,?,?)',
      args: [id, position, '映画', 'calm', 'no_criticism', position === 'admired' ? 'large' : 'mid'],
    });
  }
});

test.after(() => {
  global.fetch = originalFetch;
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('admiredだけが裏側で有名人モードになる', async () => {
  assert.equal(await experienceMode('star'), 'celebrity');
  assert.equal(await experienceMode('friend'), 'community');
});

test('大量のアカウントやlike行を作らず、一つの観客シーンで数字を演出する', async () => {
  const startedAt = new Date(Date.now() - 5 * 60000).toISOString();
  await db.execute({
    sql: "INSERT INTO posts(id,user_id,author_id,author_type,content,created_at,ai) VALUES('star-post','star','star','user','映画のラストが今も心に残っている。',?,0)",
    args: [startedAt],
  });
  const scheduled = await createCelebrityScene('star', 'star-post', '映画のラストが今も心に残っている。', startedAt);
  assert.equal(scheduled.mode, 'celebrity');
  assert.ok(scheduled.likeCount > 1000);
  assert.ok(scheduled.commentCount > 20);
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM likes')).rows[0].n, 0);
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM reaction_queue')).rows[0].n, 0);
  assert.equal((await db.execute('SELECT COUNT(*) AS n FROM ai_characters')).rows[0].n, 0);
});

test('司令塔を一度だけ呼び、代表コメントだけを保存する', async () => {
  requests = [];
  assert.equal(await processPendingCelebrityScenes(), 1);
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages.at(-1).content, /代表コメント8件/);
  assert.equal((await db.execute("SELECT status FROM celebrity_scenes WHERE post_id='star-post'")).rows[0].status, 'ready');
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM celebrity_comments WHERE scene_post_id='star-post'")).rows[0].n, 8);

  const decorated = await decorateTimelinePosts('star', [{ id: 'star-post', like_count: 0, reply_count: 0 }]);
  assert.equal(decorated[0].experience_mode, 'celebrity');
  assert.ok(Number(decorated[0].like_count) > 1000);
  assert.ok(Number(decorated[0].reply_count) > 20);

  const ownComments = await celebrityComments('star', ['star-post'], 8);
  assert.equal(ownComments.get('star-post').length, 8);
  assert.equal(ownComments.get('star-post')[0].synthetic, true);
  const foreignComments = await celebrityComments('other', ['star-post'], 8);
  assert.equal(foreignComments.size, 0);
});

test('有名人モードでは通常リアクションの残骸と住人増殖を止める', async () => {
  await db.execute({
    sql: `INSERT INTO reaction_queue(id,user_id,character_id,post_id,reaction_type,scheduled_at)
          VALUES('old-reaction','star','old-character','star-post','like',datetime('now'))`,
  });
  requests = [];
  await processReactionQueue();
  assert.equal((await db.execute("SELECT done FROM reaction_queue WHERE id='old-reaction'")).rows[0].done, 1);
  assert.equal(await runCharacterGrowth('star'), undefined);
  assert.equal(requests.length, 0);
});
