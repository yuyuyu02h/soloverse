const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/schema');
const { callLLM, buildWorldSystemPrompt, safeParseJSON } = require('./llm');
const { serializeWorldTask } = require('./worldTasks');
const { enabled } = require('./contentConfig');
const { generateReply } = require('./contentPipeline');
const { recordContent } = require('./llmRuntime');

function parseDBTimestamp(value) {
  if (!value) return 0;
  const text = String(value);
  const normalized = /[zZ]|[+-]\d\d:\d\d$/.test(text)
    ? text
    : text.replace(' ', 'T') + 'Z';
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

// 時間帯を取得
function getTimeSlot() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: process.env.WORLD_TIME_ZONE || 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  if (h >= 5  && h < 10) return { slot: 'morning',   desc: '朝、起きたばかり・出勤前・朝食中' };
  if (h >= 10 && h < 14) return { slot: 'noon',      desc: '昼、休憩中・ランチ・少し余裕がある時間' };
  if (h >= 14 && h < 18) return { slot: 'afternoon', desc: '午後、作業中・ちょっと一息・眠い時間' };
  if (h >= 18 && h < 22) return { slot: 'evening',   desc: '夜、帰宅後・夕食・リラックスタイム' };
  return { slot: 'night', desc: '深夜〜早朝、夜更かし・寝れない・静かな時間' };
}

// ─────────────────────────────────────────────────────────
// ① 自律タイムライン（メイン）
// キャラ同士のリプライチェーン・ユーザーへのメンションを含む
// ─────────────────────────────────────────────────────────
async function runAutonomousTimeline(userId) {
  if (require('./contentConfig').enabled()) {
    const pipeline = require('./contentPipeline');
    await pipeline.publishPool(userId);
    await pipeline.fillPool(userId);
    return pipeline.publishPool(userId);
  }
  const [charsResult, settingsResult, userResult] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT username FROM users WHERE id = ?', args: [userId] }),
  ]);

  const chars = charsResult.rows;
  const settings = settingsResult.rows[0];
  const userHandle = userResult.rows[0]?.username || 'あなた';
  if (!chars.length || !settings) return 0;

  const { desc: timeDesc } = getTimeSlot();

  // 直近8件の投稿をコンテキストに（ユーザー投稿含む）
  const recentPosts = await db.execute({
    sql: `SELECT p.id, p.content, p.author_type, p.reply_to,
            CASE WHEN p.author_type = 'ai' THEN ac.name ELSE u.username END as author_name,
            CASE WHEN p.author_type = 'ai' THEN ac.username ELSE u.username END as author_handle
          FROM posts p
          LEFT JOIN ai_characters ac ON p.author_type = 'ai' AND p.author_id = ac.id
          LEFT JOIN users u ON p.author_type = 'user' AND p.author_id = u.id
          WHERE p.user_id = ? AND p.reply_to IS NULL
          ORDER BY datetime(p.created_at) DESC LIMIT 8`,
    args: [userId],
  });

  const recentContext = recentPosts.rows.length > 0
    ? recentPosts.rows.map(p =>
        `[id=${p.id} ${p.author_type === 'user' ? '★ユーザー' : 'AI'}] @${p.author_handle}:「${p.content}」`
      ).join('\n')
    : 'まだ投稿なし';

  const activeChars = [...chars].sort(() => Math.random() - 0.5)
    .slice(0, Math.min(5, Math.floor(chars.length * 0.5) + 2));

  const sideChars = chars.filter(c => !activeChars.find(a => a.id === c.id))
    .sort(() => Math.random() - 0.5).slice(0, 3);

  const system = buildWorldSystemPrompt(settings, null, [
    `現在の時間帯: ${timeDesc}。この時間帯らしい話題・テンション・内容にする`,
    'キャラクター同士が自然に会話・反応し合う世界を作る',
    '時々「@ユーザー名」でユーザーに言及する（毎回ではない・自然な流れで）',
    'テーマと無関係な投稿は絶対にしない',
    'SNSらしいリアルな会話（短い相槌・質問・共感・ツッコミ）を意識する',
  ]);

  const raw = await callLLM(
    system,
    `以下のキャラクターたちの自然なSNS投稿と会話を生成してください。

【直近の投稿（★がユーザー投稿）】
${recentContext}

【今回の主役キャラクター】
${activeChars.map(c => `- ${c.name}(@${c.username}): ${c.personality} / 興味: ${c.interests}`).join('\n')}

【脇役（リプライ・反応役）】
${sideChars.map(c => `- ${c.name}(@${c.username}): ${c.personality}`).join('\n') || 'なし'}

【生成ルール】
- 投稿を4〜6件生成する
- うち1〜2件はキャラ同士の会話（例: 「@xxxxそれ最高！」「@yyyy わかるわかる」）
- ユーザー(@${userHandle})への言及は1件まで・自然な流れのときだけ
- 単なる独り言の羅列にしない。会話・リアクション・流れを作る
- 各投稿は原則80字以内。質問へ答える際は具体的な理由も含める
- 既存の投稿への返信は上に示したidをreply_to_idに入れる。投稿者のhandleから返信先を推測しない
- 今回生成する投稿同士の返信は、先に生成する要素のindex（0始まり）をreply_to_indexに入れる
- 直近の投稿と同じ話題・言い回しは繰り返さない

JSON配列のみ出力（説明・\`\`\`不要）:
[
  {"username": "username（@なし）", "content": "投稿内容", "reply_to_id": null, "reply_to_index": null}
]`,
    1800
  );

  const posts = safeParseJSON(raw);
  if (!posts || !Array.isArray(posts)) { console.warn('[Engine] autonomous JSON failed'); return 0; }

  let count = 0;
  const inserted = new Map();
  const seenContent = new Set(recentPosts.rows.map(p => p.content.trim()));

  for (const [index, p] of posts.slice(0, 6).entries()) {
    if (!p || typeof p.username !== 'string' || typeof p.content !== 'string') continue;
    const authorHandle = p.username.replace(/^@/, '');
    const content = p.content.trim().slice(0, 140);
    const char = chars.find(c => c.username === authorHandle);
    if (!char || !content || seenContent.has(content)) continue;

    let replyToId = null;
    if (p.reply_to_index != null) {
      if (!Number.isInteger(p.reply_to_index) || p.reply_to_index < 0 || p.reply_to_index >= index) continue;
      replyToId = inserted.get(p.reply_to_index) || null;
      if (!replyToId) continue;
    } else if (typeof p.reply_to_id === 'string' && p.reply_to_id) {
      if (!recentPosts.rows.some(post => post.id === p.reply_to_id)) continue;
      const targetPost = await db.execute({
        sql: 'SELECT id FROM posts WHERE user_id = ? AND id = ?',
        args: [userId, p.reply_to_id],
      });
      replyToId = targetPost.rows[0]?.id || null;
      if (!replyToId) continue;
    }

    const postId = uuidv4();
    await db.execute({
      sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, reply_to, created_at, ai)
            VALUES (?, ?, ?, 'ai', ?, ?, ?, 1)`,
      args: [
        postId, userId, char.id,
        content,
        replyToId,
        new Date().toISOString()
      ],
    });
    count++;
    inserted.set(index, postId);
    seenContent.add(content);

    if (replyToId && Math.random() < 0.5) {
      const dup = await db.execute({
        sql: 'SELECT id FROM likes WHERE post_id = ? AND liker_id = ?',
        args: [replyToId, char.id],
      });
      if (!dup.rows.length) {
        await db.execute({
          sql: `INSERT INTO likes (id, user_id, post_id, liker_id, liker_type, ai) VALUES (?, ?, ?, ?, 'ai', 1)`,
          args: [uuidv4(), userId, replyToId, char.id],
        });
      }
    }
  }

  await db.execute({
    sql: `INSERT INTO autonomous_log (user_id, last_autonomous_at) VALUES (?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET last_autonomous_at = datetime('now')`,
    args: [userId],
  });

  console.log(`[Engine] Autonomous: ${count} posts (with replies) for user ${userId}`);
  return count;
}

// ─────────────────────────────────────────────────────────
// ② 投稿からトレンド集計（LLM呼び出しなし）
// ─────────────────────────────────────────────────────────
async function runTrendGeneration(userId) {
  // 人気を架空の投稿で作らず、この世界の直近7日間の実投稿から集計する。
  const recent = await db.execute({
    sql: `SELECT content FROM posts WHERE user_id = ?
          AND datetime(created_at) >= datetime('now', '-7 days')
          ORDER BY datetime(created_at) DESC LIMIT 500`,
    args: [userId],
  });
  const counts = new Map();
  for (const post of recent.rows) {
    const tags = new Set([...post.content.matchAll(/[#＃]([\p{L}\p{N}_]{1,30})/gu)].map(match => match[1]));
    for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const trends = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const statements = [{ sql: 'DELETE FROM trends WHERE user_id = ?', args: [userId] }];
  for (const [keyword, count] of trends) {
    statements.push({
      sql: 'INSERT INTO trends (id, user_id, keyword, description, post_count) VALUES (?, ?, ?, ?, ?)',
      args: [uuidv4(), userId, keyword, '最近7日間・直近500投稿に含まれる話題', count],
    });
  }
  statements.push({
    sql: `INSERT INTO autonomous_log (user_id, last_trend_at) VALUES (?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET last_trend_at = datetime('now')`,
    args: [userId],
  });
  await db.batch(statements, 'write');
  console.log(`[Engine] Trends: ${trends.length} topics counted for user ${userId} (LLM calls: 0)`);
  return trends.map(([keyword, post_count]) => ({ keyword, post_count }));
}

// ─────────────────────────────────────────────────────────
// ③ キャラクター増加ロジック（6時間ごと・最大20人）
// autonomous_log で一元管理
// ─────────────────────────────────────────────────────────
async function runCharacterGrowth(userId) {
  const [charsResult, settingsResult, postsResult] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [userId] }),
    db.execute({
      sql: `SELECT content FROM posts WHERE user_id = ? AND author_type = 'user' ORDER BY datetime(created_at) DESC LIMIT 10`,
      args: [userId],
    }),
  ]);

  const chars = charsResult.rows;
  const settings = settingsResult.rows[0];
  if (!settings || chars.length >= 20) return;

  // autonomous_log で6時間チェック（character_growth_log ではなく統一管理）
  const log = await db.execute({
    sql: 'SELECT last_growth_at FROM autonomous_log WHERE user_id = ?',
    args: [userId],
  });
  if (log.rows.length > 0 && log.rows[0].last_growth_at) {
    const elapsed = Date.now() - parseDBTimestamp(log.rows[0].last_growth_at);
    if (elapsed < 6 * 60 * 60 * 1000) return;
  } else {
    await db.execute({
      sql: `INSERT INTO autonomous_log (user_id, last_growth_at) VALUES (?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET last_growth_at = datetime('now')`, args: [userId],
    });
    return 0;
  }

  const userPostContext = postsResult.rows.length > 0
    ? postsResult.rows.map(p => p.content).join(' / ')
    : settings.interests;

  const existingUsernames = chars.map(c => c.username).join(', ');
  const newCount = Math.min(20 - chars.length, Math.random() < 0.5 ? 1 : 2);

  const system = buildWorldSystemPrompt(settings, null, [
    `使用済みユーザー名（絶対に使わない）: ${existingUsernames}`,
    'ユーザーの最近の投稿に共感・興味を持ったという設定で生成する',
  ]);

  const raw = await callLLM(
    system,
    `新しいフォロワーを${newCount}人生成してください。
ユーザーの最近の投稿: 「${userPostContext}」

JSON配列のみ出力（説明・\`\`\`不要）:
[{"name":"表示名","username":"英数字（重複不可）","avatar_seed":"英単語","bio":"30字以内","personality":"一言","interests":"カンマ区切り","reply_style":"具体的な傾向","reaction_frequency":"high/mid/low","delay_profile":"fast/normal/slow"}]`,
    600, { userId, job: 'growth', priority: 'background' }
  );

  const newChars = safeParseJSON(raw);
  if (!newChars || !Array.isArray(newChars)) { console.warn('[Engine] growth JSON failed'); return; }

  let added = 0;
  for (const c of newChars.slice(0, newCount)) {
    if (!c || typeof c !== 'object') continue;
    const username = String(c.username || `new_user_${Date.now()}_${added}`)
      .replace(/^@/, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 24);
    if (!username) continue;
    const dup = await db.execute({
      sql: 'SELECT id FROM ai_characters WHERE user_id = ? AND username = ? COLLATE NOCASE',
      args: [userId, username],
    });
    if (dup.rows.length > 0) continue;

    const charId = uuidv4();
    await db.execute({
      sql: `INSERT INTO ai_characters (id, user_id, name, username, avatar_seed, bio, personality, interests, reply_style, reaction_frequency, delay_profile)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [charId, userId,
        String(c.name || '新しい住人').slice(0, 40), username,
        String(c.avatar_seed || 'new').slice(0, 40), String(c.bio || '').slice(0, 100),
        String(c.personality || '明るい').slice(0, 100), String(c.interests || settings.interests).slice(0, 300),
        String(c.reply_style || '共感').slice(0, 100),
        ['high', 'mid', 'low'].includes(c.reaction_frequency) ? c.reaction_frequency : 'mid',
        ['fast', 'normal', 'slow'].includes(c.delay_profile) ? c.delay_profile : 'normal'],
    });

    await db.execute({
      sql: `INSERT INTO notifications (id, user_id, type, character_id) VALUES (?, ?, 'follow', ?)`,
      args: [uuidv4(), userId, charId],
    });

    // 自己紹介投稿 + 既存キャラからの歓迎リプライ
    try {
      const charInfo = { name: c.name, username, personality: c.personality, interests: c.interests, reply_style: c.reply_style };
      const fullChar = { ...charInfo, id: charId, user_id: userId, bio: c.bio, delay_profile: c.delay_profile };
      const intro = enabled() ? await generateReply(userId, fullChar, settings, String(c.interests || settings.interests), {
        job: 'introduction', priority: 'background', ambient: true,
        instruction: '初めての自己紹介を具体的な趣味とともに20〜100字で書く。投稿本文のみ',
      }) : (await callLLM(
        buildWorldSystemPrompt(settings, charInfo, ['初めての自己紹介投稿を40字以内で1件書く', '投稿文のみ出力する']),
        `「${c.name}」として初めての自己紹介投稿を書いてください。`,
        100, { userId, job: 'introduction', priority: 'background' }
      )).trim().slice(0, 140);

      const introId = uuidv4();
      await db.execute({
        sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, ai) VALUES (?, ?, ?, 'ai', ?, 1)`,
        args: [introId, userId, charId, intro],
      });
      await recordContent(userId, 'introduction', 'published', 'llm');

      if (chars.length > 0 && Math.random() < 0.4) {
        const welcomer = chars[Math.floor(Math.random() * chars.length)];
        const welcomerInfo = { name: welcomer.name, username: welcomer.username, personality: welcomer.personality, interests: welcomer.interests, reply_style: welcomer.reply_style };
        const welcome = enabled() ? await generateReply(userId, welcomer, settings, intro, {
          job: 'welcome', priority: 'background', ambient: true,
          instruction: '新しい住人の自己紹介に、共通する趣味を具体的に挙げて歓迎する。20〜100字の本文のみ',
        }) : (await callLLM(
          buildWorldSystemPrompt(settings, welcomerInfo, ['歓迎・挨拶の返信を30字以内で書く', '返信文のみ出力する']),
          `@${username} の自己紹介「${intro}」に歓迎の返信をしてください。`,
          80, { userId, job: 'welcome', priority: 'background' }
        )).trim().slice(0, 140);

        await db.execute({
          sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, reply_to, ai) VALUES (?, ?, ?, 'ai', ?, ?, 1)`,
          args: [uuidv4(), userId, welcomer.id, welcome, introId],
        });
        await recordContent(userId, 'welcome', 'published', 'llm');
      }
    } catch (_) {}

    added++;
    console.log(`[Engine] New char: ${c.name}(@${username})`);
  }

  if (added > 0) {
    // autonomous_log に last_growth_at を記録（一元管理）
    await db.execute({
      sql: `INSERT INTO autonomous_log (user_id, last_growth_at) VALUES (?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET last_growth_at = datetime('now')`,
      args: [userId],
    });
    // 後方互換のため character_growth_log にも記録
    await db.execute({
      sql: `INSERT INTO character_growth_log (id, user_id, trigger_reason) VALUES (?, ?, ?)`,
      args: [uuidv4(), userId, `auto: ${added} chars added`],
    });
  }

  return added;
}

// ─────────────────────────────────────────────────────────
// ④ 長期不在への「久しぶり」反応（checkAbsenceReactions）
// 24時間以上投稿なし → AI が呼びかけ投稿 + absence 通知
// ─────────────────────────────────────────────────────────
async function checkAbsenceReactions(userId) {
  const lastPost = await db.execute({
    sql: `SELECT created_at FROM posts
          WHERE user_id = ? AND author_type = 'user'
          ORDER BY datetime(created_at) DESC LIMIT 1`,
    args: [userId],
  });

  if (!lastPost.rows[0]) return;

  const lastPostTime = parseDBTimestamp(lastPost.rows[0].created_at);
  if (!lastPostTime) return;
  const hoursSince = (Date.now() - lastPostTime) / (1000 * 60 * 60);

  if (hoursSince < 24) return;

  // 48時間以内に既にabsence通知を送っていれば送らない
  const recentAbsence = await db.execute({
    sql: `SELECT id FROM notifications
          WHERE user_id = ? AND type = 'absence'
          AND datetime(created_at) > datetime('now', '-48 hours')`,
    args: [userId],
  });
  if (recentAbsence.rows.length > 0) return;

  const [settingsResult, charsResult] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT * FROM ai_characters WHERE user_id = ? ORDER BY RANDOM() LIMIT 2', args: [userId] }),
  ]);

  const settings = settingsResult.rows[0];
  const chars = charsResult.rows;
  if (!settings || !chars.length) return;

  const char = chars[0];
  const daysAway = Math.floor(hoursSince / 24);

  const charInfo = {
    name: char.name, username: char.username,
    personality: char.personality, interests: char.interests,
    reply_style: char.reply_style,
  };

  const content = enabled() ? await generateReply(userId, char, settings, `${daysAway}日間ユーザーの投稿がない`, {
    job: 'absence', priority: 'background', ambient: true,
    instruction: 'しばらく投稿していない人をさりげなく気にかける。返信を強要せず20〜100字の投稿本文のみ',
  }) : (await callLLM(
    buildWorldSystemPrompt(settings, charInfo, [
      '投稿文のみ出力する（説明・前置き不要）',
      '35字以内',
    ]),
    `フォローしているユーザーが${daysAway}日間投稿していません。
さりげなく気にかける投稿を1件書いてください。
直接名指しせず「最近静かだな〜」「元気かな」のようなニュアンスで。`,
    100, { userId, job: 'absence', priority: 'background' }
  )).trim().slice(0, 140);

  const postId = uuidv4();
  await db.execute({
    sql: `INSERT INTO posts (id, user_id, author_id, author_type, content, ai)
          VALUES (?, ?, ?, 'ai', ?, 1)`,
    args: [postId, userId, char.id, content],
  });
  await recordContent(userId, 'absence', 'published', 'llm');

  await db.execute({
    sql: `INSERT INTO notifications (id, user_id, type, character_id, post_id)
          VALUES (?, ?, 'absence', ?, ?)`,
    args: [uuidv4(), userId, char.id, postId],
  });

  console.log(`[Engine] Absence reaction for user ${userId} (${daysAway} days away)`);
}

// ─────────────────────────────────────────────────────────
// バッチ: 全ユーザー処理
// ─────────────────────────────────────────────────────────
async function runAllUsers() {
  const users = await db.execute({ sql: `SELECT id FROM users WHERE onboarding_done = 1` });

  for (const user of users.rows) {
    await serializeWorldTask(user.id, async () => { try {
      const log = await db.execute({
        sql: 'SELECT * FROM autonomous_log WHERE user_id = ?', args: [user.id],
      });
      const now = Date.now();
      const lastAuto  = parseDBTimestamp(log.rows[0]?.last_autonomous_at);
      const lastTrend = parseDBTimestamp(log.rows[0]?.last_trend_at);

      const configuredMinutes = Number(process.env.AUTONOMOUS_INTERVAL_MINUTES);
      const intervalMinutes = Number.isFinite(configuredMinutes) && configuredMinutes >= 5 ? configuredMinutes : 15;
      const jobs = [
        ...(now - lastAuto > intervalMinutes * 60000 ? [() => runAutonomousTimeline(user.id)] : []),
        ...(now - lastTrend > 5 * 60000 ? [() => runTrendGeneration(user.id)] : []),
        () => runCharacterGrowth(user.id),
        () => checkAbsenceReactions(user.id),
      ];
      for (const job of jobs) {
        try { await job(); } catch (e) { console.warn(`[Engine] Job failed for user ${user.id}:`, e.message); }
      }
    } catch (e) {
      console.error(`[Engine] Error for user ${user.id}:`, e.message);
    } });
  }
}

module.exports = { runAutonomousTimeline, runTrendGeneration, runCharacterGrowth, checkAbsenceReactions, runAllUsers };
