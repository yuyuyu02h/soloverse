// Current-behavior audit: synthetic data, temporary DB, and an entirely local LLM stub.
// Exit 1 means one or more product expectations below are unmet.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const backend = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-semantic-audit-'));
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'audit.db'), CONTENT_PIPELINE: 'enhanced',
  LLM_PROVIDER_ORDER: 'groq', GROQ_API_KEY: 'local-stub-only',
  GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', GROQ_MODELS: 'audit-stub',
  LLM_REQUEST_INTERVAL_MS: '0', LLM_DAILY_REQUEST_BUDGET: '180',
  LLM_DAILY_TOKEN_BUDGET: '150000', CONTENT_TEMPLATES: 'false',
});
const { db, initDB } = backend('./src/db/schema');
const { evaluate } = backend('./src/services/contentQuality');
const { generateReply } = backend('./src/services/contentPipeline');
const celebrity = backend('./src/services/celebrityMode');
const { scheduleReplyReactions } = backend('./src/services/reactionScheduler');
const { runTrendGeneration } = backend('./src/services/autonomousEngine');
const originalFetch = global.fetch;
const originalRandom = Math.random;
let externalRequests = 0;
const nonAnswer = 'スターウォーズは映像が美しく、映画館で観ると最後の場面まで引き込まれる。';
global.fetch = async () => {
  externalRequests++;
  return new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: nonAnswer } }],
    usage: { total_tokens: 100 },
  }), { headers: { 'content-type': 'application/json' } });
};
const findings = [];
function check(id, expectationMet, evidence) {
  findings.push({ id, result: expectationMet ? 'PASS' : 'DEFECT', evidence });
}
async function main() {
  await initDB();
  for (const [id, position] of [['community', 'empathy'], ['celebrity', 'admired']]) {
    await db.execute({ sql: 'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,1)', args: [id, `${id}@test.invalid`, 'not-a-password', id] });
    await db.execute({ sql: 'INSERT INTO world_settings VALUES(?,?,?,?,?,?)', args: [id, position, 'スターウォーズ', 'calm', '', position === 'admired' ? 'large' : 'mid'] });
  }
  await db.execute({ sql: 'INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,?,?,?,?,?,?,?,?,?)', args: ['resident', 'community', '検証住人', 'audit_resident', 'audit', '映画の場面を具体的に語る', 'スターウォーズ', '理由を添える', 'high', 'fast'] });
  const settings = (await db.execute("SELECT * FROM world_settings WHERE user_id='community'")).rows[0];
  const resident = (await db.execute("SELECT * FROM ai_characters WHERE id='resident'")).rows[0];
  const context = { settings, profile: { topics: ['スターウォーズ'], preferences: [] } };
  const unrelated = '昨日観た恋愛映画は、俳優の演技が繊細で最後まで引き込まれた。';
  const assessment = evaluate(unrelated, context);
  check('specific_theme_rejects_unrelated_movie', !assessment.accepted, { theme: settings.interests, candidate: unrelated, assessment });
  const question = 'スターウォーズで一番好きなキャラクターは誰？理由も教えて。';
  const answer = await generateReply('community', resident, settings, question);
  check('question_requires_an_answer', answer !== nonAnswer, { question, returned: answer, stubCalls: externalRequests });

  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('scene','celebrity','celebrity','user','スターウォーズの好きな人物を教えて。')");
  await celebrity.createCelebrityScene('celebrity', 'scene', 'スターウォーズの好きな人物を教えて。');
  process.env.LLM_DAILY_REQUEST_BUDGET = '1'; // The previous reply exhausted this synthetic budget.
  const before = externalRequests;
  await celebrity.processPendingCelebrityScenes();
  const scene = (await db.execute("SELECT status FROM celebrity_scenes WHERE post_id='scene'")).rows[0];
  const comments = (await db.execute("SELECT COUNT(*) n FROM celebrity_comments WHERE scene_post_id='scene'")).rows[0].n;
  check('quota_deferral_preserves_pending_scene', scene.status === 'pending', { status: scene.status, storedComments: comments, stubCallsDuringDeferral: externalRequests - before });

  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('parent','community','resident','ai','スターウォーズの映像を映画館で観たい。'),('followup','community','community','user','どの映画館がおすすめ？')");
  Math.random = () => 0.99;
  await scheduleReplyReactions('community', 'followup', 'どの映画館がおすすめ？', 'parent');
  Math.random = originalRandom;
  const queued = (await db.execute("SELECT COUNT(*) n FROM reaction_queue WHERE post_id='followup' AND reaction_type='reply'")).rows[0].n;
  check('direct_followup_reserves_an_answer', queued > 0, { question: 'どの映画館がおすすめ？', parentAuthor: 'resident', queuedReplies: queued, residentFrequency: 'high', controlledRandom: 0.99 });

  await db.execute("INSERT INTO posts(id,user_id,author_id,author_type,content) VALUES('csharp','community','community','user','C#でゲームの新しい機能を実装中。')");
  const trends = await runTrendGeneration('community');
  check('csharp_is_not_a_hashtag', !trends.some(t => t.keyword === 'でゲームの新しい機能を実装中'), { post: 'C#でゲームの新しい機能を実装中。', trends });
  console.log(JSON.stringify({ llmTransport: 'local stub; no external calls', findings }, null, 2));
  process.exitCode = findings.some(f => f.result === 'DEFECT') ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 2; }).finally(() => {
  global.fetch = originalFetch;
  Math.random = originalRandom;
  db.close();
  // Keep the tiny synthetic DB in the temporary directory for inspection.
});
