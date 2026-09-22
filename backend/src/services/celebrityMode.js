const { createHash, randomUUID } = require('node:crypto');
const { db } = require('../db/schema');
const { callLLM, safeParseJSON } = require('./llm');

const COMMENT_CATEGORIES = new Set(['praise', 'empathy', 'question', 'humor', 'analysis']);
const AUDIENCE_IDENTITIES = [
  ['美咲', 'misaki_note', 'Mia'],
  ['レン', 'ren_days', 'Leo'],
  ['ユイ', 'yui_archive', 'Lily'],
  ['蒼', 'ao_logbook', 'Felix'],
  ['ナナ', 'nana_room', 'Zoe'],
  ['ハル', 'haru_scope', 'Finn'],
  ['紗季', 'saki_clip', 'Maya'],
  ['トウマ', 'touma_view', 'Max'],
  ['ミナト', 'minato_wave', 'Jasper'],
  ['凛', 'rin_topic', 'Ruby'],
  ['カナ', 'kana_scene', 'Avery'],
  ['ソラ', 'sora_watch', 'Oscar'],
];

function stableNumber(value, salt = '') {
  return Number.parseInt(createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 8), 16);
}

function currentCount(target, startedAt, timeConstantSeconds, now = Date.now()) {
  const elapsedSeconds = Math.max(0, (now - Date.parse(startedAt)) / 1000);
  const progress = Math.min(1, 0.012 + 0.988 * (1 - Math.exp(-elapsedSeconds / timeConstantSeconds)));
  return Math.max(1, Math.min(target, Math.floor(target * progress)));
}

function sceneCounts(scene, now = Date.now()) {
  return {
    likes: currentCount(Number(scene.target_likes), scene.started_at, 1200, now),
    comments: currentCount(Number(scene.target_comments), scene.started_at, 1800, now),
  };
}

async function experienceMode(userId) {
  const result = await db.execute({
    sql: 'SELECT position FROM world_settings WHERE user_id = ?',
    args: [userId],
  });
  return result.rows[0]?.position === 'admired' ? 'celebrity' : 'community';
}

async function createCelebrityScene(userId, postId, content, startedAt = new Date().toISOString()) {
  const targetLikes = 12000 + stableNumber(postId + content, 'likes') % 88000;
  const targetComments = 420 + stableNumber(content + postId, 'comments') % 5580;
  await db.execute({
    sql: `INSERT OR IGNORE INTO celebrity_scenes
          (post_id,user_id,target_likes,target_comments,started_at)
          VALUES(?,?,?,?,?)`,
    args: [postId, userId, targetLikes, targetComments, startedAt],
  });
  const scene = { target_likes: targetLikes, target_comments: targetComments, started_at: startedAt };
  const counts = sceneCounts(scene);
  return {
    mode: 'celebrity',
    likeCount: counts.likes,
    commentCount: counts.comments,
    directorPending: true,
  };
}

function exclusionsFor(settings) {
  const exclusions = String(settings.exclusions || '').split(',').filter(Boolean);
  const rules = [];
  if (exclusions.includes('no_criticism')) rules.push('否定、批判、皮肉、嫌味を含めない');
  if (exclusions.includes('no_politics')) rules.push('政治、炎上、社会問題へ話題を広げない');
  if (exclusions.includes('no_comparison')) rules.push('他人との比較、マウンティングを含めない');
  return rules;
}

function normalizeDirector(value, postContent) {
  const rawComments = Array.isArray(value?.comments) ? value.comments : [];
  const seen = new Set();
  const comments = [];
  for (const raw of rawComments) {
    const content = String(raw?.content || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (content.length < 6 || seen.has(content)) continue;
    seen.add(content);
    comments.push({
      category: COMMENT_CATEGORIES.has(raw?.category) ? raw.category : 'empathy',
      content,
    });
    if (comments.length === 8) break;
  }

  const excerpt = String(postContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
  const fallback = [
    { category: 'praise', content: `「${excerpt}」って言い切れるの、やっぱり好き。` },
    { category: 'question', content: 'そこに至るまでの話も聞いてみたい！' },
    { category: 'analysis', content: '短いのに本人らしさが出ていて、何度も読み返した。' },
    { category: 'empathy', content: 'この感覚を言葉にしてくれたのがうれしい。' },
    { category: 'humor', content: '通知を見た瞬間に飛んできた人、私だけじゃないはず。' },
    { category: 'question', content: '次にもう少し詳しく話してくれたらうれしいです。' },
    { category: 'praise', content: '言葉の切り取り方にその人らしさがあって、印象に残った。' },
    { category: 'empathy', content: '今日これを読めてちょっと気分が上がった。' },
  ];
  for (const item of fallback) {
    if (comments.length === 8) break;
    if (!seen.has(item.content)) comments.push(item);
  }

  const inputMix = value?.reaction_mix && typeof value.reaction_mix === 'object' ? value.reaction_mix : {};
  const reactionMix = {};
  for (const category of COMMENT_CATEGORIES) {
    const amount = Number(inputMix[category]);
    reactionMix[category] = Number.isFinite(amount) ? Math.max(0, Math.min(100, Math.round(amount))) : 0;
  }
  if (!Object.values(reactionMix).some(Boolean)) {
    Object.assign(reactionMix, { praise: 42, empathy: 22, question: 18, humor: 10, analysis: 8 });
  }

  return {
    mood: String(value?.mood || '好意的な熱狂').replace(/\s+/g, ' ').trim().slice(0, 40),
    reactionMix,
    comments,
  };
}

function commentRows(scene, director) {
  const identityOffset = stableNumber(scene.post_id, 'identity') % AUDIENCE_IDENTITIES.length;
  const baseTime = Date.parse(scene.started_at);
  return director.comments.map((comment, index) => {
    const identity = AUDIENCE_IDENTITIES[(identityOffset + index) % AUDIENCE_IDENTITIES.length];
    const delaySeconds = 15 + index * 21 + stableNumber(`${scene.post_id}:${index}`, 'delay') % 24;
    const share = Math.max(2, 13 - index);
    const likeCount = Math.max(1, Math.floor(Number(scene.target_comments) * share / 30));
    return {
      id: randomUUID(),
      name: identity[0],
      handle: identity[1],
      avatarSeed: identity[2],
      content: comment.content,
      category: comment.category,
      likeCount,
      createdAt: new Date(baseTime + delaySeconds * 1000).toISOString(),
    };
  });
}

async function directScene(scene) {
  const system = `あなたは有名人SNS体験の「観客反応ディレクター」です。
個別アカウントを大量に演じるのではなく、投稿を見た大勢の反応傾向を設計し、画面に出す代表コメントだけを作ります。
投稿に書かれていない事実や出来事を捏造しません。全員を同じ称賛口調にせず、共感、質問、軽いユーモア、具体的な着眼点を混ぜます。
思考過程、説明、コードフェンスは出力せず、指定されたJSONだけを出力してください。`;
  const exclusions = exclusionsFor(scene);
  const raw = await callLLM(system, `投稿:「${scene.content}」
関心テーマ: ${scene.interests}
雰囲気: ${scene.atmosphere}
追加制約: ${exclusions.join('。') || '攻撃、差別、政治的扇動を含めない'}

この投稿に対する観客全体の空気と、代表コメント8件を作ってください。
- 投稿中の具体的な言葉や内容へ触れるコメントを最低2件
- 質問を最低1件
- 共感または軽いユーモアを最低1件
- 「すごい」「さすが」だけの短い称賛は禁止
- 各コメントは6〜100字

JSONのみ:
{"mood":"全体の空気を短く","reaction_mix":{"praise":0,"empathy":0,"question":0,"humor":0,"analysis":0},"comments":[{"category":"praise/empathy/question/humor/analysis","content":"代表コメント"}]}`,
  1800, { userId: scene.user_id, job: 'celebrity_director', priority: 'interactive', expectJSON: true });
  return normalizeDirector(safeParseJSON(raw), scene.content);
}

async function saveDirectorResult(scene, director, status) {
  const rows = commentRows(scene, director);
  const statements = [
    { sql: 'DELETE FROM celebrity_comments WHERE scene_post_id=? AND user_id=?', args: [scene.post_id, scene.user_id] },
    ...rows.map(row => ({
      sql: `INSERT INTO celebrity_comments
            (id,scene_post_id,user_id,author_name,author_handle,avatar_seed,content,category,like_count,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`,
      args: [row.id, scene.post_id, scene.user_id, row.name, row.handle, row.avatarSeed, row.content, row.category, row.likeCount, row.createdAt],
    })),
    {
      sql: `UPDATE celebrity_scenes SET mood=?,reaction_mix=?,status=?,ready_at=?
            WHERE post_id=? AND user_id=? AND status='pending'`,
      args: [director.mood, JSON.stringify(director.reactionMix), status, new Date().toISOString(), scene.post_id, scene.user_id],
    },
  ];
  await db.batch(statements, 'write');
}

async function processPendingCelebrityScenes(limit = 3) {
  const result = await db.execute({
    sql: `SELECT s.*,p.content,w.interests,w.atmosphere,w.exclusions
          FROM celebrity_scenes s
          JOIN posts p ON p.id=s.post_id AND p.user_id=s.user_id
          JOIN world_settings w ON w.user_id=s.user_id
          WHERE s.status='pending' AND w.position='admired'
          ORDER BY datetime(s.started_at) ASC LIMIT ?`,
    args: [Math.max(1, Math.min(10, Number(limit) || 3))],
  });
  let processed = 0;
  for (const scene of result.rows) {
    try {
      const director = await directScene(scene);
      await saveDirectorResult(scene, director, 'ready');
      processed++;
    } catch (error) {
      if (error?.code === 'LLM_DEFERRED') continue;
      console.warn(`[Celebrity] Director fallback for ${scene.post_id}:`, error.message);
      await saveDirectorResult(scene, normalizeDirector(null, scene.content), 'fallback');
      processed++;
    }
  }
  return processed;
}

async function decorateTimelinePosts(userId, posts, now = Date.now()) {
  if (!posts.length) return posts;
  const ids = posts.map(post => post.id);
  const scenes = await db.execute({
    sql: `SELECT * FROM celebrity_scenes WHERE user_id=? AND post_id IN (${ids.map(() => '?').join(',')})`,
    args: [userId, ...ids],
  });
  const byPost = new Map(scenes.rows.map(scene => [scene.post_id, scene]));
  return posts.map(post => {
    const scene = byPost.get(post.id);
    if (!scene) return post;
    const counts = sceneCounts(scene, now);
    return {
      ...post,
      experience_mode: 'celebrity',
      celebrity_mood: scene.mood || null,
      celebrity_status: scene.status,
      like_count: Number(post.like_count || 0) + counts.likes,
      reply_count: Number(post.reply_count || 0) + counts.comments,
    };
  });
}

function toPost(comment) {
  return {
    id: comment.id,
    user_id: comment.user_id,
    author_id: `audience:${comment.id}`,
    author_type: 'ai',
    ai: 1,
    synthetic: true,
    content: comment.content,
    reply_to: comment.scene_post_id,
    created_at: comment.created_at,
    author_name: comment.author_name,
    author_handle: comment.author_handle,
    avatar_seed: comment.avatar_seed,
    like_count: Number(comment.like_count),
    reply_count: 0,
    user_liked: 0,
    depth: 0,
  };
}

async function celebrityComments(userId, postIds, perPost = 8) {
  if (!postIds.length) return new Map();
  const rows = await db.execute({
    sql: `SELECT * FROM celebrity_comments
          WHERE user_id=? AND scene_post_id IN (${postIds.map(() => '?').join(',')})
            AND datetime(created_at)<=datetime('now')
          ORDER BY datetime(created_at) ASC,id ASC`,
    args: [userId, ...postIds],
  });
  const result = new Map();
  for (const row of rows.rows) {
    const list = result.get(row.scene_post_id) || [];
    if (list.length < perPost) list.push(toPost(row));
    result.set(row.scene_post_id, list);
  }
  return result;
}

module.exports = {
  experienceMode,
  createCelebrityScene,
  processPendingCelebrityScenes,
  decorateTimelinePosts,
  celebrityComments,
  sceneCounts,
};
