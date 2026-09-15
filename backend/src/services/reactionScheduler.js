const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { callLLM, buildWorldSystemPrompt, safeParseJSON } = require('./llm');
const { serializeWorldTask } = require('./worldTasks');

function analyzeEngagementIntent(value) {
  const content = String(value || '').normalize('NFKC').trim();
  const hasQuestion = /[?？]/.test(content)
    || /(?:誰|どれ|どっち|どちら|何|なに|どこ|いつ|どう|なぜ|なんで|おすすめ)/.test(content)
    || /(?:教えて|どう思う|意見(?:ある|聞かせて)?|答えて|好き(?:な|なの|ですか)?)/.test(content);
  const hasCallForResponse = /(?:みんな|皆|誰か|無視しないで|反応して|返事して|答えて|教えて|話そ|話そう|構って|かまって)/.test(content);
  return {
    wantsReply: content.length > 0 && (hasQuestion || hasCallForResponse),
    kind: hasQuestion ? 'question' : hasCallForResponse ? 'call' : 'normal',
  };
}

function directReplyMaximumMinutes() {
  const configured = Number(process.env.AI_DIRECT_REPLY_MAX_DELAY_MINUTES);
  return Number.isFinite(configured) ? Math.min(10, Math.max(1, configured)) : 3;
}

function directReplyDelayMinutes() {
  return Math.floor(Math.random() * directReplyMaximumMinutes()) + 1;
}

async function queueReaction({ userId, characterId, postId, type, delayMinutes }) {
  await db.execute({
    sql: `INSERT INTO reaction_queue (id, user_id, character_id, post_id, reaction_type, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [uuidv4(), userId, characterId, postId, type, new Date(Date.now() + delayMinutes * 60000).toISOString()],
  });
}

// 通常投稿へのリアクションをスケジュール
async function scheduleReactions(userId, postId, postContent) {
  const [charsResult, settingsResult] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id = ? ORDER BY RANDOM()', args: [userId] }),
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [userId] }),
  ]);

  const followerScale = settingsResult.rows[0]?.follower_scale || 'mid';
  const config = {
    large: { likeCount: 10, replyProb: 0.85 },
    mid:   { likeCount: 4,  replyProb: 0.60 },
    small: { likeCount: 1,  replyProb: 0.30 },
  };
  const { likeCount, replyProb } = config[followerScale] || config.mid;
  const likers = charsResult.rows.slice(0, Math.min(likeCount, charsResult.rows.length));
  const intent = analyzeEngagementIntent(postContent);
  let replyCount = 0;

  for (const [index, char] of likers.entries()) {
    const delayMinutes = calcDelay(char.delay_profile);

    await queueReaction({ userId, characterId: char.id, postId, type: 'like', delayMinutes });

    // 小規模設定でも、質問・呼びかけを「いいねだけ」で終わらせない。
    const directReply = intent.wantsReply && index === 0;
    const willReply = directReply || char.reaction_frequency === 'high' || Math.random() < replyProb;
    if (willReply) {
      await queueReaction({
        userId, characterId: char.id, postId, type: 'reply',
        delayMinutes: directReply ? directReplyDelayMinutes() : delayMinutes + Math.floor(Math.random() * 3) + 1,
      });
      replyCount++;
    }
  }
  console.log(`[Scheduler] ${followerScale}: ${likers.length} likes, ${replyCount} replies queued${intent.wantsReply ? ` (${intent.kind})` : ''}`);
  return {
    likeCount: likers.length,
    replyCount,
    directReply: intent.wantsReply && replyCount > 0,
    replyWithinMinutes: intent.wantsReply && replyCount > 0
      ? directReplyMaximumMinutes()
      : null,
  };
}

// リプライ投稿へのAI反応をスケジュール（確率低め・1〜2人のみ）
async function scheduleReplyReactions(userId, replyPostId, replyContent, parentPostId) {
  const [charsResult, settingsResult] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id = ? ORDER BY RANDOM() LIMIT 3', args: [userId] }),
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [userId] }),
  ]);

  if (!settingsResult.rows[0] || !charsResult.rows.length) return;

  // リプライへの反応は1〜2人、かつ40%の確率でのみ実施
  for (const char of charsResult.rows.slice(0, 2)) {
    if (Math.random() > 0.4) continue;

    const delayMinutes = calcDelay(char.delay_profile) + Math.floor(Math.random() * 10) + 5;
    await db.execute({
      sql: `INSERT INTO reaction_queue (id, user_id, character_id, post_id, reaction_type, scheduled_at) VALUES (?, ?, ?, ?, 'reply', ?)`,
      args: [uuidv4(), userId, char.id, replyPostId,
        new Date(Date.now() + delayMinutes * 60000).toISOString()],
    });
  }
}

function calcDelay(delayProfile) {
  if (delayProfile === 'fast') return Math.floor(Math.random() * 5) + 1;
  if (delayProfile === 'slow') return Math.floor(Math.random() * 120) + 30;
  return Math.floor(Math.random() * 30) + 3;
}

const MAX_ATTEMPTS = 3;

// 旧バージョンの狭い質問判定で取りこぼした直近投稿も、DB削除なしで救済する。
// 投稿直後の通常スケジューラとの競合を避けるため、2分以上経過した投稿だけを見る。
async function backfillDirectReplies() {
  const candidates = await db.execute({
    sql: `SELECT p.id, p.user_id, p.content
          FROM posts p
          WHERE p.author_type = 'user' AND p.reply_to IS NULL
            AND datetime(p.created_at) <= datetime('now', '-2 minutes')
            AND datetime(p.created_at) >= datetime('now', '-24 hours')
            AND NOT EXISTS (
              SELECT 1 FROM posts reply
              WHERE reply.user_id = p.user_id AND reply.reply_to = p.id AND reply.author_type = 'ai'
            )
            AND NOT EXISTS (
              SELECT 1 FROM reaction_queue rq
              WHERE rq.user_id = p.user_id AND rq.post_id = p.id AND rq.reaction_type = 'reply'
            )
          ORDER BY datetime(p.created_at) DESC LIMIT 20`,
  });

  let queued = 0;
  for (const post of candidates.rows) {
    if (!analyzeEngagementIntent(post.content).wantsReply) continue;
    const character = await db.execute({
      sql: 'SELECT id FROM ai_characters WHERE user_id = ? ORDER BY RANDOM() LIMIT 1',
      args: [post.user_id],
    });
    if (!character.rows[0]) continue;
    await queueReaction({
      userId: post.user_id,
      characterId: character.rows[0].id,
      postId: post.id,
      type: 'reply',
      delayMinutes: directReplyDelayMinutes(),
    });
    queued++;
  }
  if (queued) console.log(`[Scheduler] Backfilled ${queued} unanswered questions/calls`);
  return queued;
}

async function processReactionQueue() {
  await backfillDirectReplies();
  const pending = await db.execute({
    sql: `SELECT rq.*, ac.name, ac.username, ac.personality, ac.reply_style, ac.interests
          FROM reaction_queue rq JOIN ai_characters ac ON rq.character_id = ac.id
          WHERE rq.done = 0 AND datetime(rq.scheduled_at) <= datetime('now')
          ORDER BY datetime(rq.scheduled_at) ASC LIMIT 20`,
  });

  for (const item of pending.rows) {
    try {
      if (item.reaction_type === 'like')  await processLike(item);
      if (item.reaction_type === 'reply') await processReply(item);
      await db.execute({ sql: 'UPDATE reaction_queue SET done = 1 WHERE id = ?', args: [item.id] });
    } catch (e) {
      console.error(`[Queue] ${item.id} failed (attempt ${item.attempts + 1}/${MAX_ATTEMPTS}):`, e.message);

      const attempts = (item.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // 無料枠の日次上限切れ等で恒久的に失敗するアイテムを、
        // 30秒ごとに無限リトライしてさらにクォータを消費するのを防ぐ。
        // 諦めてdone扱いにする（likeはスキップされるだけで実害は小さい）。
        await db.execute({ sql: 'UPDATE reaction_queue SET done = 1, attempts = ? WHERE id = ?', args: [attempts, item.id] });
        console.warn(`[Queue] ${item.id} を${MAX_ATTEMPTS}回失敗のため諦めました`);
      } else {
        // 次回は最低5分は空けてから再試行（次の30秒サイクルで即リトライしない）
        await db.execute({
          sql: `UPDATE reaction_queue SET attempts = ?, scheduled_at = datetime('now', '+5 minutes') WHERE id = ?`,
          args: [attempts, item.id],
        });
      }
    }
  }
  if (pending.rows.length > 0) console.log(`[Queue] Processed ${pending.rows.length} reactions`);
}

async function processLike(item) {
  const dup = await db.execute({
    sql: 'SELECT id FROM likes WHERE post_id = ? AND liker_id = ?',
    args: [item.post_id, item.character_id],
  });
  if (dup.rows.length > 0) return;

  await db.execute({
    sql: `INSERT INTO likes (id, user_id, post_id, liker_id, liker_type, ai) VALUES (?, ?, ?, ?, 'ai', 1)`,
    args: [uuidv4(), item.user_id, item.post_id, item.character_id],
  });
  await db.execute({
    sql: `INSERT INTO notifications (id, user_id, type, character_id, post_id) VALUES (?, ?, 'like', ?, ?)`,
    args: [uuidv4(), item.user_id, item.character_id, item.post_id],
  });
}

async function processReply(item) {
  const [postResult, settingsResult] = await Promise.all([
    db.execute({ sql: 'SELECT content, reply_to FROM posts WHERE id = ?', args: [item.post_id] }),
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [item.user_id] }),
  ]);
  if (!postResult.rows[0]) return;

  const post = postResult.rows[0];
  const settings = settingsResult.rows[0];
  if (!settings) return;
  const charInfo = {
    name: item.name, username: item.username,
    personality: item.personality, interests: item.interests,
    reply_style: item.reply_style,
  };
  const system = buildWorldSystemPrompt(settings, charInfo, [
    '返信文のみ出力する（説明・前置き不要）',
    '原則80字以内。質問には選択や結論と理由を含め、必要なら140字まで使う',
  ]);

  // リプライの場合は親投稿のコンテキストも渡す
  let promptText = `以下の投稿に返信してください。\n\n投稿:「${post.content}」`;
  if (post.reply_to) {
    const parentPost = await db.execute({
      sql: 'SELECT content FROM posts WHERE id = ?',
      args: [post.reply_to],
    });
    if (parentPost.rows[0]) {
      promptText = `スレッドの流れ:「${parentPost.rows[0].content}」\n\nこれへの返信:「${post.content}」\n\nこの返信に対してコメントしてください。`;
    }
  }

  const history = await db.execute({
    sql: `SELECT content FROM posts WHERE user_id = ? AND author_id = ? ORDER BY datetime(created_at) DESC LIMIT 3`,
    args: [item.user_id, item.character_id],
  });
  promptText += `\n\n自分の最近の発言（同じ話を繰り返さず、好みを一貫させる）:\n${history.rows.map(p => p.content).join('\n') || 'まだなし'}`;
  const replyContent = (await callLLM(system, promptText, 350)).trim().slice(0, 140);
  if (!replyContent) throw new Error('空の返信が返されました');

  const replyId = uuidv4();
  await db.execute({
    sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, reply_to, ai) VALUES (?, ?, ?, 'ai', ?, ?, 1)`,
    args: [replyId, item.user_id, item.character_id, replyContent, item.post_id],
  });
  await db.execute({
    sql: `INSERT INTO notifications (id, user_id, type, character_id, post_id) VALUES (?, ?, 'reply', ?, ?)`,
    args: [uuidv4(), item.user_id, item.character_id, replyId],
  });
}

async function seedTimeline(userId) {
  const existing = await db.execute({
    sql: "SELECT id FROM posts WHERE user_id = ? AND author_type = 'ai' LIMIT 1", args: [userId],
  });
  if (existing.rows.length) return 0;
  const [charsResult, settingsResult] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [userId] }),
  ]);
  const chars = charsResult.rows;
  const settings = settingsResult.rows[0];
  if (!chars.length || !settings) return;

  const system = buildWorldSystemPrompt(settings, null, [
    '初期タイムライン用の自然な日常投稿を生成する',
    '作品名がテーマなら、鑑賞・感想・考察・推し・グッズなど現実のファン活動として書く',
    '作品世界の住人、登場人物、能力者になりきった投稿は作らない',
  ]);

  const raw = await callLLM(
    system,
    `以下のキャラクターたちの日常投稿を${Math.min(chars.length, 8)}件生成してください。

キャラクター一覧:
${chars.slice(0, 8).map(c => `- ${c.name}(@${c.username}): ${c.personality} / 興味: ${c.interests}`).join('\n')}

各キャラクターの性格と興味を反映した投稿にしてください。
作品が趣味の場合は「観た」「好き」「あの場面」「グッズ」など、現実にいるファンだと分かる内容にしてください。
悪い例:「砂漠の惑星で賞金稼ぎをしている」「光の剣を磨いて星々を歩く」
良い例:「砂漠の惑星の夕焼けシーン、色づかいが本当に好き」
JSON配列のみ出力（説明・\`\`\`不要）:
[{"username": "username（@なし）", "content": "投稿内容（50字以内）"}]`,
    1000
  );

  const posts = safeParseJSON(raw);
  if (!posts || !Array.isArray(posts)) throw new Error('Seed posts JSON parse failed: ' + raw.slice(0, 200));

  const statements = [];
  const seen = new Set();
  for (const p of posts.slice(0, 8)) {
    if (!p || typeof p.username !== 'string' || typeof p.content !== 'string') continue;
    const handle = p.username.replace(/^@/, '');
    const char = chars.find(c => c.username === handle);
    const content = p.content.trim().slice(0, 140);
    if (!char || !content || seen.has(char.id)) continue;
    seen.add(char.id);
    const hoursAgo = Math.floor(Math.random() * 72) + 1;
    statements.push({
      sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, created_at, ai) VALUES (?, ?, ?, 'ai', ?, ?, 1)`,
      args: [uuidv4(), userId, char.id, content, new Date(Date.now() - hoursAgo * 3600000).toISOString()],
    });
  }
  if (!statements.length) throw new Error('有効な初期投稿を生成できませんでした');
  await db.batch(statements, 'write');
  console.log(`[Seed] Generated posts for user ${userId}`);
  return statements.length;
}

function generateAITimelinePosts(userId) {
  return serializeWorldTask(userId, () => seedTimeline(userId));
}

module.exports = {
  analyzeEngagementIntent,
  scheduleReactions,
  scheduleReplyReactions,
  backfillDirectReplies,
  processReactionQueue,
  generateAITimelinePosts,
};
