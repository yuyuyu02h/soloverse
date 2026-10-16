// Causal investigation of the current implementation. Synthetic data only.
// Assertions confirm reproducibility of defects, not correctness of product behavior.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const backend = createRequire(path.join(root, 'backend/package.json'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-root-cause-'));
Object.assign(process.env, {
  DB_PATH: path.join(dir, 'synthetic.db'), CONTENT_PIPELINE: 'enhanced',
  LLM_PROVIDER_ORDER: 'groq', GROQ_API_KEY: 'local-stub-only',
  GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', GROQ_MODELS: 'causal-stub',
  LLM_REQUEST_INTERVAL_MS: '0', LLM_DAILY_REQUEST_BUDGET: '100',
  LLM_DAILY_TOKEN_BUDGET: '1000000', CONTENT_POOL_SIZE: '8',
  CONTENT_REFILL_ATTEMPTS: '1', CONTENT_TEMPLATES: 'false',
});
const { db, initDB } = backend('./src/db/schema');
const { fillPool, publishPool, seedEnhanced } = backend('./src/services/contentPipeline');
const { residentContext } = backend('./src/services/residentContext');
const { generateAICharacters } = backend('./src/services/worldGenerator');
const qualitySource = fs.readFileSync(path.join(root, 'backend/src/services/contentQuality.js'), 'utf8');
const scope = { module: { exports: {} }, Intl };
// Expose the exact private helpers in an isolated copy, without editing application code.
vm.runInNewContext(qualitySource + '\nmodule.exports.explain = (text,input) => [...expand(input)].filter(w => normalize(text).includes(normalize(w)));', scope);
const { evaluate, explain } = scope.module.exports;
const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-results.json'), 'utf8'));
const originalFetch = global.fetch;
let responses = [];
const calls = [];
global.fetch = async (_, options) => {
  const request = JSON.parse(options.body);
  calls.push(request.messages);
  assert.ok(responses.length, 'Unexpected LLM call in the local stub');
  return new Response(JSON.stringify({ model: 'causal-stub', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(responses.shift()) } }], usage: { total_tokens: 100 } }), { headers: { 'content-type': 'application/json' } });
};
const results = { transport: 'Local stub only; no external requests', experiments: [] };
function record(id, evidence) { results.experiments.push({ id, reproduced: true, evidence }); }
const baseContext = (theme, topics = []) => ({ settings: { interests: theme }, profile: { topics, preferences: [] }, history: [] });
async function user(id, theme) {
  await db.execute({ sql: 'INSERT INTO users(id,email,password_hash,username,onboarding_done) VALUES(?,?,?,?,1)', args: [id, `${id}@test.invalid`, 'unused', id] });
  await db.execute({ sql: 'INSERT INTO world_settings VALUES(?,?,?,?,?,?)', args: [id, 'empathy', theme, 'calm', '', 'mid'] });
}
async function resident(userId, id, value) {
  await db.execute({ sql: 'INSERT INTO ai_characters(id,user_id,name,username,avatar_seed,bio,personality,interests,reply_style,reaction_frequency,delay_profile) VALUES(?,?,?,?,?,?,?,?,?,?,?)', args: [id, userId, value.name, value.username, 'audit', value.bio || '', value.personality || '穏やか', value.interests, value.reply_style || '具体的に回答', 'high', 'fast'] });
}
async function main() {
  const unrelated = '天気の良い日に自転車でサイクリング予定です。途中のバプティズムの絵本を見ませんか?';
  const onlyTheme = evaluate(unrelated, baseContext('スターウォーズ'));
  const withHobby = evaluate(unrelated, baseContext('スターウォーズ', ['自転車']));
  assert.equal(onlyTheme.reason, 'off_topic');
  assert.equal(withHobby.accepted, true);
  record('hobby_alone_changes_rejection_to_acceptance_without_any_database', { content: unrelated, themeOnly: onlyTheme.reason, addingOnlyHobby: '自転車', withHobby: withHobby.reason, matchedTerms: explain(unrelated, 'スターウォーズ 自転車') });

  const otherMovie = '昨日観た恋愛映画は、俳優の演技が繊細で最後まで引き込まれた。';
  assert.equal(evaluate(otherMovie, baseContext('スターウォーズ')).accepted, true);
  record('broad_movie_dictionary_accepts_a_different_movie', { content: otherMovie, matchedTerms: explain(otherMovie, 'スターウォーズ'), emptyHistory: true, profileTopics: [] });
  const validProgramming = '今日はクラウド環境にPythonで自動デプロイスクリプトを書いた。リリースがスムーズだったよ🚀';
  assert.equal(evaluate(validProgramming, baseContext('プログラミング, VTUBER')).reason, 'off_topic');
  record('removing_profile_topics_alone_also_rejects_valid_topic_synonyms', { content: validProgramming, themeOnly: 'off_topic', implication: 'A stricter independent theme check needs domain/entity synonyms or semantic assessment; simply removing hobbies is insufficient.' });

  await initDB();
  await user('replay', 'スターウォーズ');
  const world = live.worlds.find(w => w.theme === 'スターウォーズ');
  for (const r of world.residents) await resident('replay', `replay-${r.username}`, r);
  const before = (await db.execute("SELECT COUNT(*) n FROM posts WHERE user_id='replay'")).rows[0].n;
  responses.push(world.candidates.map(c => ({ username: c.author, content: c.content, reply_to_index: null })));
  const generated = await fillPool('replay', { seed: true });
  const published = await publishPool('replay');
  const sent = calls.at(-1);
  const themeSent = sent.find(m => m.role === 'system').content.includes('【テーマ・趣味(必ずこれに関連した内容を投稿する)】\nスターウォーズ');
  const badPublished = (await db.execute({ sql: "SELECT COUNT(*) n FROM posts WHERE user_id='replay' AND content=?", args: [unrelated] })).rows[0].n;
  assert.equal(before, 0); assert.equal(themeSent, true); assert.equal(badPublished, 1);
  record('saved_real_output_replay_in_a_fresh_database', { initialPostCount: before, correctThemeInOutgoingSystemPrompt: themeSent, replayedCandidates: world.candidates.length, accepted: generated, published, unrelatedCyclingPostPublished: badPublished, note: 'Replays previously observed real output; this experiment itself uses no cloud API.' });

  await user('characters', 'スターウォーズ');
  const offThemeCharacters = Array.from({ length: 5 }, (_, i) => ({ name: `検証人物${i}`, username: `hobby_${i}`, bio: '自転車と料理を楽しむ', personality: '穏やか', interests: '自転車,料理', reply_style: '短く返す', reaction_frequency: 'mid', delay_profile: 'normal' }));
  responses.push(offThemeCharacters, offThemeCharacters);
  const generatedResidents = await generateAICharacters({ userId: 'characters', position: 'empathy', interests: 'スターウォーズ', atmosphere: 'calm', exclusions: [] });
  assert.equal(generatedResidents.length, 10);
  assert.ok(generatedResidents.every(r => r.interests === '自転車,料理'));
  record('resident_generation_does_not_validate_theme_alignment', { requestedTheme: 'スターウォーズ', acceptedResidents: generatedResidents.length, allResidentInterests: '自転車,料理', originalSystemPromptRequestsCorrectTheme: calls.at(-1)[0].content.includes('スターウォーズ') });

  await user('switch', 'プログラミング');
  await resident('switch', 'switch-resident', { name: '切替検証', username: 'switch_resident', interests: 'Python,プログラミング' });
  let char = (await db.execute("SELECT * FROM ai_characters WHERE id='switch-resident'")).rows[0];
  const cachedBefore = await residentContext('switch', char);
  const oldPost = 'Pythonでデータを整理するスクリプトを書いた。繰り返しの入力を減らせて助かった。';
  await db.execute({ sql: "INSERT INTO content_candidates(id,user_id,character_id,content,source,scheduled_at,created_at) VALUES('old-candidate','switch','switch-resident',?,'llm',?,?)", args: [oldPost, new Date().toISOString(), new Date().toISOString()] });
  // Simulate a settings-only change; the product currently exposes no theme-switch API.
  await db.execute("UPDATE world_settings SET interests='映画' WHERE user_id='switch'");
  await db.execute("UPDATE ai_characters SET interests='映画' WHERE id='switch-resident'");
  char = (await db.execute("SELECT * FROM ai_characters WHERE id='switch-resident'")).rows[0];
  const cachedAfter = await residentContext('switch', char);
  assert.equal(cachedAfter.profile.topics.join(','), cachedBefore.profile.topics.join(','));
  record('cached_resident_profile_survives_theme_and_character_interests_change', { newWorldTheme: '映画', currentCharacterInterests: char.interests, returnedCachedProfileTopics: cachedAfter.profile.topics });
  const publishedAfterSwitch = await publishPool('switch');
  assert.equal(publishedAfterSwitch, 1);
  record('old_pending_candidate_is_published_without_current_theme_revalidation', { newWorldTheme: '映画', publishedOldContent: oldPost, publishedAfterSwitch });
  const callCount = calls.length;
  const seeded = await seedEnhanced('switch');
  assert.equal(seeded, 0); assert.equal(calls.length, callCount);
  record('existing_ai_post_prevents_seed_after_settings_only_theme_change', { newWorldTheme: '映画', existingAiPosts: 1, newSeedPosts: seeded, newLlmCalls: calls.length - callCount });

  results.reproducedExperiments = results.experiments.length;
  fs.writeFileSync(path.join(__dirname, 'root-cause-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  db.close();
});
