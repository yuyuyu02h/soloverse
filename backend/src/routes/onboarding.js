const express = require('express');
const { db } = require('../db/schema');
const { authMiddleware: authenticate } = require('../middleware/auth');
const { generateAICharacters, resolveFollowerScale } = require('../services/worldGenerator');
const { isLLMConfigured } = require('../services/llm');
const { generateAITimelinePosts } = require('../services/reactionScheduler');
const { serializeWorldTask } = require('../services/worldTasks');

const router = express.Router();

router.post('/submit', authenticate, async (req, res) => {
  const { position, interests, atmosphere, exclusions } = req.body;
  const userId = req.userId;

  const validPositions = new Set(['empathy', 'admired', 'observer']);
  const validAtmospheres = new Set(['calm', 'active', 'village', 'vent']);
  const validExclusions = new Set(['no_criticism', 'no_politics', 'no_comparison']);
  const interestsStr = Array.isArray(interests) ? interests.join(', ') : String(interests || '').trim();
  const exclusionsArr = Array.isArray(exclusions)
    ? [...new Set(exclusions.filter(value => validExclusions.has(value)))]
    : [];

  if (!validPositions.has(position) || !interestsStr || !validAtmospheres.has(atmosphere)) {
    return res.status(400).json({ error: '必須項目が不足しています' });
  }
  if (interestsStr.length > 300) return res.status(400).json({ error: '興味・関心は300字以内にしてください' });
  if (!isLLMConfigured()) return res.status(503).json({ error: 'LLM APIが未設定です。管理者に連絡してください' });

  try {
    // ユーザーが実際に存在するか確認（外部キー制約エラーを防ぐ）
    const userResult = await db.execute({
      sql: 'SELECT id, onboarding_done FROM users WHERE id = ?',
      args: [userId],
    });

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'ユーザーが見つかりません。再ログインしてください。' });
    }

    if (userResult.rows[0].onboarding_done) {
      return res.status(409).json({ error: '既にオンボーディングが完了しています' });
    }

    const exclusionsStr = exclusionsArr.join(',');
    const followerScale = resolveFollowerScale(position);

    // 外部APIが失敗したとき中途半端な世界設定を残さないよう、先に生成する。
    const characters = await generateAICharacters({
      position,
      interests: interestsStr,
      atmosphere,
      exclusions: exclusionsArr,
      userId,
    });

    const statements = [{
      sql: `INSERT OR REPLACE INTO world_settings
            (user_id, position, interests, atmosphere, exclusions, follower_scale)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [userId, position, interestsStr, atmosphere, exclusionsStr, followerScale],
    }];
    for (const c of characters) {
      statements.push({
        sql: `INSERT INTO ai_characters
              (id, user_id, name, username, avatar_seed, bio, personality, interests, reply_style, reaction_frequency, delay_profile)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          c.id, c.user_id, c.name, c.username, c.avatar_seed,
          c.bio || '', c.personality, c.interests,
          c.reply_style, c.reaction_frequency, c.delay_profile
        ],
      });
    }
    statements.push({
      sql: 'UPDATE users SET onboarding_done = 1 WHERE id = ?',
      args: [userId],
    });
    statements.push({
      sql: `INSERT INTO autonomous_log (user_id, last_autonomous_at, last_trend_at, last_growth_at)
            VALUES (?, datetime('now'), datetime('now'), datetime('now'))
            ON CONFLICT(user_id) DO NOTHING`, args: [userId],
    });
    await db.batch(statements, 'write');

    res.json({ success: true, characterCount: characters.length });
  } catch (e) {
    console.error('Onboarding error:', e);
    res.status(500).json({
      error: '世界の生成に失敗しました',
      ...(process.env.NODE_ENV === 'development' ? { detail: e.message } : {}),
    });
  }
});

// 世界設定確認
router.get('/world', authenticate, async (req, res) => {
  try {
    const settings = await db.execute({
      sql: 'SELECT * FROM world_settings WHERE user_id = ?',
      args: [req.userId],
    });
    const characters = await db.execute({
      sql: 'SELECT * FROM ai_characters WHERE user_id = ?',
      args: [req.userId],
    });
    res.json({ settings: settings.rows[0], characters: characters.rows });
  } catch (e) {
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// アカウントとユーザー投稿を残し、AI住人とAI生成データだけを作り直す。
router.post('/regenerate', authenticate, async (req, res) => {
  const userId = req.userId;
  if (!isLLMConfigured()) return res.status(503).json({ error: 'LLM APIが未設定です。管理者に連絡してください' });

  try {
    const settingsResult = await db.execute({
      sql: 'SELECT * FROM world_settings WHERE user_id = ?', args: [userId],
    });
    const settings = settingsResult.rows[0];
    if (!settings) return res.status(409).json({ error: '世界設定がまだ作成されていません' });

    // 新しい住人を先に生成し、API失敗時に現在の世界を失わないようにする。
    const characters = await generateAICharacters({
      position: settings.position,
      interests: settings.interests,
      atmosphere: settings.atmosphere,
      exclusions: String(settings.exclusions || '').split(',').filter(Boolean),
      userId,
    });

    await serializeWorldTask(userId, async () => {
      const statements = [
        { sql: 'DELETE FROM content_candidates WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM content_pool_state WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM reaction_queue WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM notifications WHERE user_id = ?', args: [userId] },
        { sql: "DELETE FROM likes WHERE user_id = ? AND liker_type = 'ai'", args: [userId] },
        {
          sql: `WITH RECURSIVE removed(id) AS (
                  SELECT id FROM posts WHERE user_id = ? AND author_type = 'ai'
                  UNION
                  SELECT child.id FROM posts child JOIN removed parent ON child.reply_to = parent.id
                  WHERE child.user_id = ?
                )
                DELETE FROM posts WHERE id IN (SELECT id FROM removed)`,
          args: [userId, userId],
        },
        { sql: 'DELETE FROM trends WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM character_growth_log WHERE user_id = ?', args: [userId] },
        { sql: 'DELETE FROM ai_characters WHERE user_id = ?', args: [userId] },
      ];
      for (const c of characters) {
        statements.push({
          sql: `INSERT INTO ai_characters
                (id, user_id, name, username, avatar_seed, bio, personality, interests, reply_style, reaction_frequency, delay_profile)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            c.id, c.user_id, c.name, c.username, c.avatar_seed,
            c.bio || '', c.personality, c.interests, c.reply_style,
            c.reaction_frequency, c.delay_profile,
          ],
        });
      }
      statements.push({
        sql: `INSERT INTO autonomous_log (user_id, last_autonomous_at, last_trend_at, last_growth_at)
              VALUES (?, datetime('now'), datetime('now'), datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                last_autonomous_at = datetime('now'),
                last_trend_at = datetime('now'),
                last_growth_at = datetime('now')`,
        args: [userId],
      });
      await db.batch(statements, 'write');
    });

    let seedCount = 0;
    let warning = null;
    try {
      seedCount = await generateAITimelinePosts(userId) || 0;
    } catch (e) {
      warning = '住人は更新しましたが、初期投稿の生成に失敗しました。タイムラインを再読み込みすると再試行できます';
      console.warn(`[Regenerate] Seed failed for ${userId}:`, e.message);
    }
    res.json({ success: true, characterCount: characters.length, seedCount, warning });
  } catch (e) {
    console.error('Regenerate error:', e);
    res.status(500).json({
      error: 'AI住人の作り直しに失敗しました。現在の世界は変更されていません',
      ...(process.env.NODE_ENV === 'development' ? { detail: e.message } : {}),
    });
  }
});

module.exports = router;
